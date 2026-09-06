/**
 * Eingangsquellen und Vorlagen pflegen.
 *
 * Beide sind Stammdaten, aber keine gewöhnlichen — sie haben je eine
 * Besonderheit, die eine reine Eingabemaske falsch machen würde:
 *
 *   * **Eine Eingangsquelle enthält kein Passwort.** In den Einstellungen
 *     steht der *Name* einer Umgebungsvariablen; ein Datenbankauszug gibt
 *     damit keinen Postfachzugang her. Die Maske darf also gar kein
 *     Passwortfeld haben — und muss stattdessen sagen, ob die genannte
 *     Variable auf dem Server überhaupt gesetzt ist.
 *
 *   * **Eine Vorlage bestimmt, was das Haus verlässt.** Ein Tippfehler in
 *     einem Platzhalter fällt sonst erst dem Empfänger auf. Deshalb wird
 *     jede Vorlage vor dem Speichern gegen die Weißliste geprüft und mit
 *     Beispielwerten vorgeführt.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '@/db'
import { PLATZHALTER, vorlageFuellen, vorlagePruefen } from '@/postausgang/vorlagen'
import { NichtErlaubt, NichtMoeglich, type Eingaben } from './index'

const text = (w: string | null | undefined): string | null => {
  const s = String(w ?? '').trim()
  return s === '' ? null : s
}

const pflicht = (w: string | null | undefined, feld: string): string => {
  const s = text(w)
  if (s === null) throw new NichtMoeglich(`${feld} darf nicht leer sein.`)
  return s
}

async function schreiben<T>(
  benutzerId: string,
  aktion: (c: PoolClient) => Promise<T>,
): Promise<T> {
  try {
    return await alsBenutzer(benutzerId, aktion)
  } catch (fehler) {
    const meldung = fehler instanceof Error ? fehler.message : String(fehler)
    if (meldung.includes('row-level security')) {
      throw new NichtErlaubt('Dafür fehlt das Recht.')
    }
    if (meldung.includes('duplicate key')) {
      throw new NichtMoeglich('Diesen Eintrag gibt es bereits.')
    }
    throw fehler
  }
}

// ---------------------------------------------------------------------------
// Eingangsquellen
// ---------------------------------------------------------------------------

export interface Quelleneinrichtung {
  id: string
  art: string
  bezeichnung: string
  aktiv: boolean
  taktSekunden: number
  belegart: string
  objektId: string | null
  ordnungsgruppeId: string | null
  traeger: string | null
  traegerAktiv: boolean
  einstellungen: Record<string, unknown>
  /** Name der Umgebungsvariablen für das Passwort — nur bei Mailpostfächern. */
  passwortVariable: string | null
  /** Ist sie auf diesem Server gesetzt? */
  passwortVorhanden: boolean
}

/**
 * Die Quellen mit allem, was zum Einrichten nötig ist.
 *
 * **Warum der Träger dabeisteht.** Eine Quelle arbeitet unter den Rechten
 * ihres Einrichters, nicht unter einem technischen Konto. Scheidet die
 * Person aus und wird ihr Zugang gesperrt, steht die Quelle still — richtig
 * so, aber nur, wenn man es sieht. Sonst sucht jemand tagelang den Fehler
 * im Postfach.
 */
export async function quelleneinrichtungLaden(
  benutzerId: string,
): Promise<Quelleneinrichtung[]> {
  const zeilen = await alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select q.id, q.art, q.bezeichnung, q.aktiv, q.takt_sekunden, q.belegart,
              q.objekt_id, q.ordnungsgruppe_id, q.einstellungen,
              b.name as traeger, coalesce(b.aktiv, false) as traeger_aktiv
         from eingangsquelle q
         left join benutzer b on b.id = q.angelegt_von
        order by q.bezeichnung`,
    )
    return rows
  })

  return zeilen.map((z) => {
    const einstellungen = (z['einstellungen'] as Record<string, unknown>) ?? {}
    const variable =
      typeof einstellungen['passwort_variable'] === 'string'
        ? einstellungen['passwort_variable']
        : null

    return {
      id: String(z['id']),
      art: String(z['art']),
      bezeichnung: String(z['bezeichnung']),
      aktiv: z['aktiv'] === true,
      taktSekunden: Number(z['takt_sekunden']),
      belegart: String(z['belegart']),
      objektId: z['objekt_id'] == null ? null : String(z['objekt_id']),
      ordnungsgruppeId:
        z['ordnungsgruppe_id'] == null ? null : String(z['ordnungsgruppe_id']),
      traeger: z['traeger'] == null ? null : String(z['traeger']),
      traegerAktiv: z['traeger_aktiv'] === true,
      einstellungen,
      passwortVariable: variable,
      /*
       * Die eigentliche Auskunft dieser Seite.
       *
       * Eine Quelle mit einer Variablen, die auf diesem Server nicht gesetzt
       * ist, scheitert beim nächsten Lauf — und der Fehler landet in einer
       * Spalte, die niemand liest, bis eine Rechnung vermisst wird. Hier
       * steht es vorher.
       *
       * Geprüft wird nur das Vorhandensein, nie der Wert: Ein Passwort
       * gehört auch nicht in eine Oberfläche, die es nur anzeigen soll.
       */
      passwortVorhanden:
        variable !== null && (process.env[variable] ?? '') !== '',
    }
  })
}

export async function quelleAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const art = pflicht(f['art'], 'Die Art')
  const bezeichnung = pflicht(f['bezeichnung'], 'Die Bezeichnung')
  const takt = Number(text(f['taktSekunden']) ?? '300')

  if (!Number.isFinite(takt) || takt < 30) {
    throw new NichtMoeglich('Der Takt muss mindestens 30 Sekunden betragen.')
  }

  const einstellungen: Record<string, string> =
    art === 'ordner'
      ? { pfad: pflicht(f['pfad'], 'Der Pfad') }
      : {
          host: pflicht(f['host'], 'Der Server'),
          benutzer: pflicht(f['postfach'], 'Das Postfach'),
          /*
           * Der **Name** der Variablen, nicht ihr Wert. Es gibt in dieser
           * Maske bewusst kein Passwortfeld: Was nicht eingegeben werden
           * kann, kann auch nicht in der Datenbank landen.
           */
          passwort_variable: pflicht(f['passwortVariable'], 'Die Umgebungsvariable'),
        }

  const erledigt = text(f['erledigtPfad'])
  if (art === 'ordner' && erledigt !== null) einstellungen['erledigt_pfad'] = erledigt
  const ordner = text(f['ordner'])
  if (art === 'mail' && ordner !== null) einstellungen['ordner'] = ordner

  await schreiben(benutzerId, async (c) => {
    await c.query(
      `insert into eingangsquelle (mandant_id, art, bezeichnung, einstellungen,
                                   objekt_id, ordnungsgruppe_id, belegart,
                                   takt_sekunden, angelegt_von)
       values (app.mein_mandant(), $1, $2, $3::jsonb, $4, $5, $6, $7,
               app.mein_benutzer())`,
      [
        art,
        bezeichnung,
        JSON.stringify(einstellungen),
        text(f['objektId']),
        text(f['ordnungsgruppeId']),
        text(f['belegart']) ?? 'rechnung',
        takt,
      ],
    )
  })
}

export async function quelleUmschalten(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflicht(f['id'], 'Die Quelle')
  await schreiben(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      // Beim Einschalten den alten Fehler löschen: Er beschreibt einen Lauf,
      // den es nicht mehr gibt, und stünde sonst als Warnung an einer
      // Quelle, die gerade neu eingerichtet wurde.
      `update eingangsquelle
          set aktiv = not aktiv,
              letzter_fehler = case when aktiv then letzter_fehler else null end
        where id = $1`,
      [id],
    )
    if (rowCount === 0) {
      throw new NichtErlaubt(
        'Die Änderung hat nichts bewirkt — Eingangsquellen einzurichten ist ' +
          'Teil der Ablaufkonfiguration.',
      )
    }
  })
}

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------

export interface Vorlagenpflege {
  id: string
  schluessel: string
  name: string
  betreff: string
  text: string
  aktiv: boolean
  geaendertAm: string | null
  geaendertVon: string | null
  /** Platzhalter, die nicht in der Weißliste stehen. */
  unbekannt: string[]
  /** Wie die Mail mit Beispielwerten aussieht. */
  vorschauBetreff: string
  vorschauText: string
}

/**
 * Beispielwerte für die Vorschau.
 *
 * Erfundene Namen und Beträge — keine echten Personendaten in Beispielen
 * (Projektregel), und eine Vorschau, die den zuletzt versandten Beleg
 * zeigte, wäre ein zweiter Weg, ihn zu lesen.
 */
const BEISPIEL: Record<string, string> = {
  kreditor: 'Musterreinigung GmbH',
  rechnungsnummer: 'RE-2026-0001',
  betrag: '1.240,00 €',
  objekt: '42 · Beispielweg 3',
  faellig: '30.09.2026',
  empfaenger: 'Frau Beispiel',
  link: 'https://dms.example/einsicht/abc123',
  gueltig_bis: '31.10.2026',
  heute: '03.09.2026',
}

export async function vorlagenpflegeLaden(benutzerId: string): Promise<Vorlagenpflege[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select v.id, v.schluessel, v.name, v.betreff, v.text, v.aktiv,
              to_char(v.geaendert_am, 'YYYY-MM-DD') as geaendert_am,
              b.name as geaendert_von
         from vorlage v
         left join benutzer b on b.id = v.geaendert_von
        order by v.name`,
    )
    return rows.map((z) => {
      const betreff = String(z['betreff'])
      const inhalt = String(z['text'])
      return {
        id: String(z['id']),
        schluessel: String(z['schluessel']),
        name: String(z['name']),
        betreff,
        text: inhalt,
        aktiv: z['aktiv'] === true,
        geaendertAm: z['geaendert_am'] == null ? null : String(z['geaendert_am']),
        geaendertVon: z['geaendert_von'] == null ? null : String(z['geaendert_von']),
        unbekannt: vorlagePruefen(betreff, inhalt),
        vorschauBetreff: vorlageFuellen(betreff, BEISPIEL).text,
        vorschauText: vorlageFuellen(inhalt, BEISPIEL).text,
      }
    })
  })
}

/**
 * Speichert eine Vorlage — nach der Prüfung gegen die Weißliste.
 *
 * **Ein unbekannter Platzhalter wird abgewiesen, nicht stillschweigend
 * entfernt.** Beim Füllen bleibt er stehen (damit er auffällt); beim
 * Speichern wird er gar nicht erst angenommen. Das ist die frühere von zwei
 * Gelegenheiten, und die spätere ist eine Mail, die schon draußen ist.
 */
export async function vorlageSpeichern(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflicht(f['id'], 'Die Vorlage')
  const betreff = pflicht(f['betreff'], 'Der Betreff')
  const inhalt = pflicht(f['text'], 'Der Text')

  const unbekannt = vorlagePruefen(betreff, inhalt)
  if (unbekannt.length > 0) {
    throw new NichtMoeglich(
      `Unbekannte Platzhalter: ${unbekannt.map((n) => `{{${n}}}`).join(', ')}. ` +
        `Erlaubt sind: ${Object.keys(PLATZHALTER).join(', ')}.`,
    )
  }

  await schreiben(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      // `geaendert_von` setzt der Trigger, nicht diese Abfrage -- sonst
      // haenge der Nachweis daran, welchen Weg jemand nimmt.
      'update vorlage set betreff = $2, text = $3 where id = $1',
      [id, betreff, inhalt],
    )
    if (rowCount === 0) {
      throw new NichtErlaubt(
        'Die Änderung hat nichts bewirkt — dafür fehlt das Recht zur ' +
          'Stammdatenpflege.',
      )
    }
  })
}

/** Die Weißliste, für die Oberfläche. */
export function platzhalterListe(): Array<{ name: string; anzeige: string; hinweis: string }> {
  return Object.entries(PLATZHALTER).map(([name, f]) => ({
    name,
    anzeige: f.anzeige,
    hinweis: f.hinweis,
  }))
}
