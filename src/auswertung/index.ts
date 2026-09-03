/**
 * Auswertungen (Konzept §24.11).
 *
 * Drei Zahlen, die im Betrieb fehlen. Ohne sie merkt niemand, dass ein Beleg
 * seit fünf Wochen in einer Stufe steht — man sieht ihn ja nicht, er liegt in
 * einem fremden Postfach.
 *
 * **Die Abfragen stehen in SQL, nicht hier.** Sie sind Aggregate über
 * Hunderttausende Zeilen; in TypeScript nachgebaut wären sie ein Ladevorgang
 * mit anschließendem Rechnen im Speicher. Hier steht nur, wie sie aufgerufen
 * werden.
 *
 * **Unter den Rechten des Fragenden**, nicht als System. Eine Auswertung ist
 * eine Sicht auf Belege, und wer einen Beleg nicht sehen darf, darf ihn auch
 * nicht in einer Summe wiederfinden — aus einer Kennzahl lässt sich
 * zurückrechnen. Die RLS erledigt damit den Mandantenfilter an einer Stelle
 * statt in vier Abfragen.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '@/db'

export interface Stufenzeit {
  stufeId: string
  bezeichnung: string
  stufentyp: string
  anzahl: number
  mittelStunden: number
  medianStunden: number
  p90Stunden: number
}

export interface Skontoverlust {
  dokumentId: string
  kreditor: string | null
  rechnungsnummer: string | null
  brutto: number
  skontoProzent: number
  skontoBis: string
  gezahltAm: string | null
  lage: 'zu_spaet' | 'verfallen'
  verlust: number
}

export interface Skontosumme {
  lage: 'zu_spaet' | 'verfallen'
  anzahl: number
  verlust: number
}

export interface OffenerBeleg {
  dokumentId: string
  kreditor: string | null
  rechnungsnummer: string | null
  brutto: number | null
  tage: number
  stufe: string | null
  laufStatus: string
}

export interface Zeitraum {
  von?: string | null
  bis?: string | null
}

/**
 * Wie lange die Stufen dauern.
 *
 * Ohne Zeitraum die letzten 90 Tage. Und **auch mit `null`** die letzten 90
 * Tage — von hier aus gibt es die unbegrenzte Abfrage nicht.
 *
 * Das ist Absicht und keine Nachlässigkeit. Der unbegrenzte Lauf war
 * gemessen dreimal so teuer und ging auf die Platte (siehe
 * docs/messungen.md); von einer Weboberfläche aus ist das die Abfrage, die
 * den Server anhält, und sie entsteht aus einem leeren Eingabefeld. Wer sie
 * wirklich will, ruft `app.durchlaufzeiten(null, null)` in SQL auf — dann
 * hat er es entschieden statt vergessen.
 */
export async function durchlaufzeiten(
  benutzerId: string,
  zeitraum: Zeitraum = {},
): Promise<Stufenzeit[]> {
  return alsBenutzer(benutzerId, async (c) => zeitenLesen(c, zeitraum))
}

async function zeitenLesen(c: PoolClient, zeitraum: Zeitraum): Promise<Stufenzeit[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    // coalesce auf die Vorgabe: `null` hiesse hier "gesamte Geschichte", und
    // das soll nur bekommen, wer es ausdruecklich verlangt.
    `select * from app.durchlaufzeiten(
              coalesce($1::date, current_date - 90), $2::date)`,
    [zeitraum.von ?? null, zeitraum.bis ?? null],
  )
  return rows.map((z) => ({
    stufeId: String(z['stufe_id']),
    bezeichnung: String(z['bezeichnung']),
    stufentyp: String(z['stufentyp']),
    anzahl: Number(z['anzahl']),
    mittelStunden: Number(z['mittel_stunden']),
    medianStunden: Number(z['median_stunden']),
    p90Stunden: Number(z['p90_stunden']),
  }))
}

/**
 * Was verfallene Skonti gekostet haben — Summe und größte Einzelfälle.
 *
 * Beides in **einem** Aufruf und aus derselben Definition. Zwei Aufrufe
 * wären zwei Gelegenheiten, sie auseinanderlaufen zu lassen; die Summe
 * passte dann nicht mehr zu den Zeilen darunter, und niemand wüsste, welche
 * der beiden Zahlen stimmt.
 */
export async function skonto(
  benutzerId: string,
  zeitraum: Zeitraum = {},
  grenze = 50,
): Promise<{ summe: Skontosumme[]; faelle: Skontoverlust[] }> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows: summe } = await c.query<Record<string, unknown>>(
      'select * from app.skonto_summe($1::date, $2::date)',
      [zeitraum.von ?? null, zeitraum.bis ?? null],
    )
    const { rows: faelle } = await c.query<Record<string, unknown>>(
      // to_char: Ein `date` wird sonst zum Date-Objekt in Serverzeitzone,
      // und aus dem 31.12. wird der 30.12. -- bei einer Skontofrist waere
      // das ein Tag, den es nie gab (Projektregel).
      `select dokument_id, kreditor, rechnungsnummer, brutto, skonto_prozent,
              to_char(skonto_bis, 'YYYY-MM-DD') as skonto_bis,
              to_char(gezahlt_am, 'YYYY-MM-DD') as gezahlt_am,
              lage, verlust
         from app.skonto_verluste($1::date, $2::date, $3)`,
      [zeitraum.von ?? null, zeitraum.bis ?? null, grenze],
    )

    return {
      summe: summe.map((z) => ({
        lage: String(z['lage']) as Skontosumme['lage'],
        anzahl: Number(z['anzahl']),
        verlust: Number(z['verlust']),
      })),
      faelle: faelle.map((z) => ({
        dokumentId: String(z['dokument_id']),
        kreditor: z['kreditor'] == null ? null : String(z['kreditor']),
        rechnungsnummer:
          z['rechnungsnummer'] == null ? null : String(z['rechnungsnummer']),
        brutto: Number(z['brutto']),
        skontoProzent: Number(z['skonto_prozent']),
        skontoBis: String(z['skonto_bis']),
        gezahltAm: z['gezahlt_am'] == null ? null : String(z['gezahlt_am']),
        lage: String(z['lage']) as Skontoverlust['lage'],
        verlust: Number(z['verlust']),
      })),
    }
  })
}

/** Die ältesten noch laufenden Belege — gerechnet ab Eingang im Haus. */
export async function aeltesteOffene(
  benutzerId: string,
  grenze = 25,
): Promise<OffenerBeleg[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select * from app.aelteste_offene($1)',
      [grenze],
    )
    return rows.map((z) => ({
      dokumentId: String(z['dokument_id']),
      kreditor: z['kreditor'] == null ? null : String(z['kreditor']),
      rechnungsnummer:
        z['rechnungsnummer'] == null ? null : String(z['rechnungsnummer']),
      brutto: z['brutto'] == null ? null : Number(z['brutto']),
      tage: Number(z['tage']),
      stufe: z['stufe'] == null ? null : String(z['stufe']),
      laufStatus: String(z['lauf_status']),
    }))
  })
}
