/**
 * Archivierung, Aufbewahrung, Einschränkung.
 *
 * Konzept 19. Die Regeln stehen in SQL — sie sind die Sicherheitsgrenze und
 * müssen auch dann greifen, wenn jemand an dieser Datei vorbeigeht. Hier
 * steht nur, wann sie angewandt werden.
 *
 * Der Object Lock ist der Punkt, an dem Anspruch und Wirklichkeit
 * auseinandergehen: Er wird vom Objektspeicher durchgesetzt, nicht von der
 * Datenbank. Die Dateisystem-Ablage der Entwicklung kann ihn nicht — und
 * bekommt deshalb **kein** Datum eingetragen. Ein Datum, das nichts bewirkt,
 * ist schlechter als eine leere Spalte: Es sieht aus wie ein Schutz.
 */

import type { PoolClient } from 'pg'

export interface Archivstand {
  archiviertAm: string | null
  aufbewahrungBis: string | null
  aufbewahrungsgrund: string | null
  objectLockBis: string | null
  loeschsperre: boolean
  eingeschraenkt: boolean
}

/**
 * Kann die Ablage einen Object Lock?
 *
 * Bewusst eine Eigenschaft der Ablage und keine Einstellung: Wer sie auf
 * `true` stellt, ohne dass der Speicher es kann, hat sich selbst belogen.
 */
export interface Aufbewahrungsfaehig {
  readonly kannObjectLock: boolean
}

export function kannObjectLock(ablage: unknown): boolean {
  return (ablage as Partial<Aufbewahrungsfaehig>)?.kannObjectLock === true
}

/**
 * Archiviert einen Beleg.
 *
 * Danach ist er fest: Kontierung, Rechnungsdaten und Zuordnung lassen sich
 * nicht mehr ändern — das erzwingen Trigger, nicht diese Funktion.
 *
 * **Nimmt bewusst nichts entgegen außer dem Beleg.** Bis 20260902140000 gab
 * es zwei weitere Parameter, und beide waren falsch:
 *
 *   * `objectLockBis` hätte die Objektsperre in derselben Transaktion
 *     gesetzt — genau das, was [ADR 0006](../../docs/adr/0006-objektsperre.md)
 *     ausschließt. Eine Compliance-Sperre für eine zurückgerollte
 *     Archivierung nimmt niemand mehr zurück. Gesetzt wird sie im Durchgang
 *     nach dem Commit.
 *   * `verfahrensdoku` hätte die geltende Fassung vom Aufrufer entgegen-
 *     genommen. Eine mitgegebene Fassung ist eine Behauptung — er könnte
 *     jede Nummer eintragen. Abgeleitet ist sie ein Befund.
 *
 * Beide hat nie jemand benutzt. Ein ungenutzter Weg an einer Regel vorbei ist
 * trotzdem einer.
 */
export async function archivieren(
  c: PoolClient,
  dokumentId: string,
): Promise<string | null> {
  // Über to_char und nicht als `date`: pg macht daraus ein Date-Objekt in der
  // Zeitzone des Servers, und aus dem 31.12. wird der 30.12. — bei einer
  // Aufbewahrungsfrist ist das ein Tag zu früh gelöscht. Ein Test hat es
  // gefunden, der Typ nicht.
  const { rows } = await c.query<{ bis: string | null }>(
    `select to_char(app.dokument_archivieren($1), 'YYYY-MM-DD') as bis`,
    [dokumentId],
  )
  return rows[0]?.bis ?? null
}

/**
 * Storniert einen Beleg.
 *
 * Die Ersatzrechnung ist ein **neues** Dokument. Verkettet wird über
 * `dokument_beziehung` mit der Art `ersetzt` — damit später beantwortbar
 * bleibt, warum es zwei Belege über dieselbe Leistung gibt.
 */
export async function stornieren(
  c: PoolClient,
  dokumentId: string,
  grund: string,
  ersetztDurch?: string | null,
): Promise<boolean> {
  const { rows } = await c.query<{ dokument_stornieren: boolean }>(
    'select app.dokument_stornieren($1, $2)',
    [dokumentId, grund],
  )
  if (rows[0]?.dokument_stornieren !== true) return false

  if (ersetztDurch != null) {
    await c.query(
      `insert into dokument_beziehung (von_dokument, zu_dokument, art)
       values ($1, $2, 'ersetzt') on conflict do nothing`,
      [ersetztDurch, dokumentId],
    )
  }
  return true
}

/**
 * Schränkt die Verarbeitung ein — der Weg für einen Löschanspruch an einem
 * aufbewahrungspflichtigen Beleg.
 *
 * Weder ignorieren noch löschen: Beides wäre ein Verstoß, nur gegen
 * verschiedene Gesetze (Konzept 19).
 */
export async function einschraenken(
  c: PoolClient,
  dokumentId: string,
  grund: string,
  beantragtAm?: string,
): Promise<string | null> {
  const { rows } = await c.query<{ bis: string | null }>(
    `select to_char(
              app.verarbeitung_einschraenken($1, $2, coalesce($3::date, current_date)),
              'YYYY-MM-DD') as bis`,
    [dokumentId, grund, beantragtAm ?? null],
  )
  return rows[0]?.bis ?? null
}

export async function archivstandLaden(
  c: PoolClient,
  dokumentId: string,
): Promise<Archivstand | null> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select to_char(a.archiviert_am, 'YYYY-MM-DD') as archiviert_am,
            to_char(a.aufbewahrung_bis, 'YYYY-MM-DD') as aufbewahrung_bis,
            a.aufbewahrungsgrund,
            to_char(a.storage_object_lock_bis, 'YYYY-MM-DD') as object_lock_bis,
            a.loeschsperre,
            exists (select 1 from einschraenkung e
                     where e.dokument_id = $1
                       and e.aufgehoben_am is null
                       and e.geloescht_am is null) as eingeschraenkt
       from archiv_eintrag a
      where a.dokument_id = $1`,
    [dokumentId],
  )
  const z = rows[0]
  if (z === undefined) return null

  return {
    archiviertAm: z['archiviert_am'] == null ? null : String(z['archiviert_am']),
    aufbewahrungBis: z['aufbewahrung_bis'] == null ? null : String(z['aufbewahrung_bis']),
    aufbewahrungsgrund:
      z['aufbewahrungsgrund'] == null ? null : String(z['aufbewahrungsgrund']),
    objectLockBis: z['object_lock_bis'] == null ? null : String(z['object_lock_bis']),
    loeschsperre: Boolean(z['loeschsperre']),
    eingeschraenkt: Boolean(z['eingeschraenkt']),
  }
}

/**
 * Was gelöscht werden darf.
 *
 * Liefert nur Kandidaten. Das Löschen ist eine eigene Handlung — eine
 * Funktion, die beides täte, würde irgendwann versehentlich aufgerufen.
 */
export async function loeschkandidaten(
  c: PoolClient,
  stichtag?: string,
): Promise<Array<{ dokumentId: string; grund: string; frist: string }>> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select dokument_id, grund, to_char(frist, 'YYYY-MM-DD') as frist
       from app.loeschkandidaten(coalesce($1::date, current_date))`,
    [stichtag ?? null],
  )
  return rows.map((z) => ({
    dokumentId: String(z['dokument_id']),
    grund: String(z['grund']),
    frist: String(z['frist']),
  }))
}

export * from './objektakte'
export * from './objektsperre'
export * from './loeschen'
