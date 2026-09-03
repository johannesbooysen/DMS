/**
 * Schriftverkehr — die zweite Belegart (Konzept §24.3).
 *
 * **Wie klein dieses Modul ist, ist die Aussage.** CLAUDE.md behauptet einen
 * generischen Dokumentenkern: ein Posteingang, ein Rechtemodell, ein
 * Audit-Log, fachliche Daten in Satellitentabellen. Wäre das falsch, stünde
 * hier ein zweiter Eingang, eine zweite Engine, eine zweite Belegliste.
 *
 * Hier steht: Lesen und Schreiben einer Faktentabelle. Alles andere —
 * Aufnahme, Hash, Dublettenprüfung, Aufbereitung, Ablauf, Postfächer,
 * Archivierung, externe Einsicht — trägt der Kern unverändert. Die
 * Stufenfolge steht im Seed und ist Konfiguration.
 *
 * Was der Umbau gefunden hat, steht in der Migration `20260902180000`:
 * `app.freigabe_hash` band über einen inneren Verbund an `rechnung_fakten`
 * und lieferte für jede andere Belegart `null` — Freigaben, die an nichts
 * hängen.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '@/db'

export type Richtung = 'eingehend' | 'ausgehend'

export interface Schriftstueck {
  dokumentId: string
  richtung: Richtung
  korrespondent: string | null
  kreditorId: string | null
  betreff: string | null
  schreibenDatum: string | null
  fristAm: string | null
  aktenzeichen: string | null
}

export interface Schriftstueckdaten {
  richtung: Richtung
  korrespondent?: string | null
  kreditorId?: string | null
  betreff?: string | null
  schreibenDatum?: string | null
  fristAm?: string | null
  aktenzeichen?: string | null
}

/**
 * Legt die Fakten zu einem Schriftstück an oder schreibt sie fort.
 *
 * Nimmt einen `PoolClient` und öffnet keine eigene Transaktion: Die Fakten
 * entstehen zusammen mit dem Dokument, und ein Schriftstück ohne Fakten wäre
 * ein Beleg, den niemand zuordnen kann. Nach der Archivierung weist der
 * Trigger `schriftverkehr_fakten_archiv_schutz` jede Änderung ab.
 */
export async function schriftstueckSchreiben(
  c: PoolClient,
  dokumentId: string,
  daten: Schriftstueckdaten,
): Promise<void> {
  await c.query(
    `insert into schriftverkehr_fakten
       (dokument_id, richtung, korrespondent, kreditor_id, betreff,
        schreiben_datum, frist_am, aktenzeichen)
     values ($1, $2, $3, $4, $5, $6::date, $7::date, $8)
     on conflict (dokument_id) do update set
       richtung        = excluded.richtung,
       korrespondent   = excluded.korrespondent,
       kreditor_id     = excluded.kreditor_id,
       betreff         = excluded.betreff,
       schreiben_datum = excluded.schreiben_datum,
       frist_am        = excluded.frist_am,
       aktenzeichen    = excluded.aktenzeichen`,
    [
      dokumentId,
      daten.richtung,
      daten.korrespondent ?? null,
      daten.kreditorId ?? null,
      daten.betreff ?? null,
      daten.schreibenDatum ?? null,
      daten.fristAm ?? null,
      daten.aktenzeichen ?? null,
    ],
  )
}

export async function schriftstueckLesen(
  c: PoolClient,
  dokumentId: string,
): Promise<Schriftstueck | null> {
  const { rows } = await c.query<Record<string, unknown>>(
    // to_char: Ein `date` wird sonst zum Date-Objekt in Serverzeitzone, und
    // aus dem 31.12. wird der 30.12. -- bei einer Antwortfrist wäre das ein
    // Tag zu früh (Projektregel).
    `select dokument_id, richtung, korrespondent, kreditor_id, betreff,
            to_char(schreiben_datum, 'YYYY-MM-DD') as schreiben_datum,
            to_char(frist_am, 'YYYY-MM-DD') as frist_am,
            aktenzeichen
       from schriftverkehr_fakten where dokument_id = $1`,
    [dokumentId],
  )
  const z = rows[0]
  if (z === undefined) return null

  return {
    dokumentId: String(z['dokument_id']),
    richtung: String(z['richtung']) as Richtung,
    korrespondent: z['korrespondent'] == null ? null : String(z['korrespondent']),
    kreditorId: z['kreditor_id'] == null ? null : String(z['kreditor_id']),
    betreff: z['betreff'] == null ? null : String(z['betreff']),
    schreibenDatum: z['schreiben_datum'] == null ? null : String(z['schreiben_datum']),
    fristAm: z['frist_am'] == null ? null : String(z['frist_am']),
    aktenzeichen: z['aktenzeichen'] == null ? null : String(z['aktenzeichen']),
  }
}

/**
 * Schriftstücke mit ablaufender Antwortfrist.
 *
 * Die einzige Abfrage hier, die über eine Faktentabelle hinausgeht — und die
 * einzige, die es fachlich braucht: Eine versäumte Frist im Schriftverkehr
 * kostet mehr als ein verfallenes Skonto und fällt niemandem von selbst auf.
 *
 * Läuft unter den Rechten des Fragenden, die RLS ist der Mandantenfilter.
 * Nur offene Läufe — ein erledigtes Schreiben braucht keine Antwort mehr.
 */
export async function fristenLaufenAb(
  benutzerId: string,
  inTagen = 14,
): Promise<Array<Schriftstueck & { tageBisFrist: number }>> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select s.dokument_id, s.richtung, s.korrespondent, s.kreditor_id,
              s.betreff,
              to_char(s.schreiben_datum, 'YYYY-MM-DD') as schreiben_datum,
              to_char(s.frist_am, 'YYYY-MM-DD') as frist_am,
              s.aktenzeichen,
              (s.frist_am - current_date)::integer as tage
         from schriftverkehr_fakten s
         join dokument d on d.id = s.dokument_id
         left join dokument_lauf l on l.dokument_id = d.id
        where s.frist_am is not null
          and s.frist_am <= current_date + $1::integer
          -- Erledigte und stornierte Schreiben brauchen keine Antwort mehr.
          and coalesce(l.status, 'laufend') in ('laufend','klaerung')
          and d.status <> 'storniert'
        order by s.frist_am`,
      [inTagen],
    )
    return rows.map((z) => ({
      dokumentId: String(z['dokument_id']),
      richtung: String(z['richtung']) as Richtung,
      korrespondent: z['korrespondent'] == null ? null : String(z['korrespondent']),
      kreditorId: z['kreditor_id'] == null ? null : String(z['kreditor_id']),
      betreff: z['betreff'] == null ? null : String(z['betreff']),
      schreibenDatum: z['schreiben_datum'] == null ? null : String(z['schreiben_datum']),
      fristAm: z['frist_am'] == null ? null : String(z['frist_am']),
      aktenzeichen: z['aktenzeichen'] == null ? null : String(z['aktenzeichen']),
      tageBisFrist: Number(z['tage']),
    }))
  })
}
