/**
 * Layer: was neben dem Beleg liegt.
 *
 * Konzept 16. Stempel, Notizen, Hervorhebungen und Schwärzungen liegen
 * **neben** dem PDF, nie darin. Das Original bleibt bitgenau — sein Hash im
 * Archiv gilt weiter, auch nachdem vier Menschen gestempelt und zwei
 * kommentiert haben.
 *
 * Zwei Sachen entstehen nicht hier:
 *
 *   * **Stempel** entstehen aus ihrem Ereignis, per Trigger. Ein Stempel, den
 *     die Anwendung setzen könnte, wäre ein Stempel ohne Ereignis.
 *   * **Die Platzierung** rechnet der Worker bei der Aufbereitung
 *     (`freieBloecke`), weil PDF-Arbeit nicht in einen Request gehört.
 *
 * Was hier passiert, ist Notiz, Hervorhebung, Schwärzung — und das Laden für
 * die Anzeige.
 */

import { alsBenutzer } from '@/db'
import { alsZeitpunkt } from '@/datum'

export * from './platzierung'

export class LayerAbgelehnt extends Error {}

export type Layertyp = 'stempel' | 'notiz' | 'highlight' | 'schwaerzung'
export type Sichtbarkeit = 'intern' | 'extern' | 'alle'

export interface Layerzeile {
  id: string
  typ: Layertyp
  seite: number
  x: number
  y: number
  breite: number
  hoehe: number
  text: string | null
  sichtbarkeit: Sichtbarkeit
  /** Farbe des Stempeltyps, falls es einer ist. */
  farbe: string | null
  erstelltVon: string | null
  erstelltAm: string
}

/**
 * Alle sichtbaren Layer eines Belegs.
 *
 * Ausgeblendete kommen **nicht** mit: Sie bleiben in der Tabelle, damit der
 * Vorgang nachvollziehbar ist, aber sie gehören nicht mehr auf den Beleg.
 */
export async function layerLaden(
  benutzerId: string,
  dokumentId: string,
): Promise<Layerzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select l.id, l.typ, l.seite, l.x, l.y, l.breite, l.hoehe,
              l.inhalt_text, l.sichtbarkeit, l.erstellt_am,
              t.farbe, b.name as erstellt_von
         from dokument_layer l
         left join stempel_ereignis e on e.id = l.stempel_ereignis_id
         left join stempeltyp t on t.id = e.stempeltyp_id
         left join benutzer b on b.id = l.erstellt_von
        where l.dokument_id = $1 and l.geloescht_am is null
        order by l.seite, l.erstellt_am`,
      [dokumentId],
    )
    return rows.map(zeile)
  })
}

function zeile(z: Record<string, unknown>): Layerzeile {
  return {
    id: String(z['id']),
    typ: String(z['typ']) as Layertyp,
    seite: Number(z['seite']),
    x: Number(z['x']),
    y: Number(z['y']),
    breite: Number(z['breite']),
    hoehe: Number(z['hoehe']),
    text: z['inhalt_text'] == null ? null : String(z['inhalt_text']),
    sichtbarkeit: String(z['sichtbarkeit']) as Sichtbarkeit,
    farbe: z['farbe'] == null ? null : String(z['farbe']),
    erstelltVon: z['erstellt_von'] == null ? null : String(z['erstellt_von']),
    erstelltAm: alsZeitpunkt(z['erstellt_am']) ?? '',
  }
}

export interface Layerwunsch {
  dokumentId: string
  typ: Exclude<Layertyp, 'stempel'>
  seite: number
  x: number
  y: number
  breite: number
  hoehe: number
  text?: string | null
  sichtbarkeit?: Sichtbarkeit
}

export async function layerAnlegen(
  benutzerId: string,
  wunsch: Layerwunsch,
): Promise<string | null> {
  if (wunsch.breite <= 0 || wunsch.hoehe <= 0) {
    throw new LayerAbgelehnt('Ein Layer ohne Fläche wäre unsichtbar.')
  }
  if (wunsch.seite < 1) {
    throw new LayerAbgelehnt('Seitenzahlen beginnen bei 1.')
  }
  if (wunsch.typ === 'notiz' && (wunsch.text ?? '').trim() === '') {
    // Eine leere Notiz ist ein Kasten ohne Aussage. Sie faellt spaeter
    // niemandem als Fehler auf, sondern nur als Unordnung.
    throw new LayerAbgelehnt('Eine Notiz ohne Text ist keine Notiz.')
  }

  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ layer_anlegen: string | null }>(
      'select app.layer_anlegen($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        wunsch.dokumentId,
        wunsch.typ,
        wunsch.seite,
        wunsch.x,
        wunsch.y,
        wunsch.breite,
        wunsch.hoehe,
        wunsch.text ?? null,
        wunsch.sichtbarkeit ?? 'intern',
      ],
    )
    return rows[0]?.layer_anlegen ?? null
  })
}

/** Ausblenden, nicht löschen — die Zeile bleibt. */
export async function layerAusblenden(
  benutzerId: string,
  layerId: string,
): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ layer_ausblenden: boolean }>(
      'select app.layer_ausblenden($1)',
      [layerId],
    )
    return rows[0]?.layer_ausblenden === true
  })
}

/**
 * Was nach draußen darf.
 *
 * Die Regel ist knapp und absichtlich nicht verhandelbar: Schwärzungen immer
 * (sie verdecken), Stempel und ausdrücklich freigegebene Notizen ja, alles
 * andere nein. Sie steht hier **und** in `app.einsicht_*`; wer sie ändert,
 * ändert sie an beiden Stellen.
 */
export function gehtNachDraussen(l: Layerzeile): boolean {
  if (l.typ === 'schwaerzung') return true
  return l.sichtbarkeit === 'extern' || l.sichtbarkeit === 'alle'
}
