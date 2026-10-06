/**
 * Die Belegübersicht mit Daten versorgen.
 *
 * Ohne Filter zeigt sie den Feed — das Neueste über alle eigenen Objekte, als
 * Top-N je Objekt. Sobald irgendein Filter gesetzt ist, wird gesucht: Wer
 * nach „alle roten Ampeln" fragt, will alle, nicht die neuesten je Objekt.
 */

import { alsBenutzer } from '@/db'
import { feed, suchen, zaehlen, type Belegfilter, type Belegzeile } from '@/belege/liste'

export interface Uebersicht {
  zeilen: Belegzeile[]
  /** `null`, solange nur der Feed gezeigt wird — dort gibt es nichts zu zählen. */
  treffer: number | null
  gefiltert: boolean
  objekte: Array<{ id: string; objektnummer: string; bezeichnung: string }>
  gruppen: Array<{ id: string; name: string; farbe: string | null }>
  /** Die Ablagen, die der Fragende sieht -- aus der RLS auf `ablage`. */
  ablagen: Array<{ id: string; name: string }>
}

export function istGefiltert(filter: Belegfilter): boolean {
  return Boolean(
    filter.objektId ||
      filter.ordnungsgruppeId ||
      filter.ablageId ||
      filter.belegart ||
      filter.ampel ||
      filter.status ||
      filter.von ||
      filter.bis ||
      filter.volltext?.trim(),
  )
}

export async function uebersichtLaden(
  benutzerId: string,
  filter: Belegfilter,
): Promise<Uebersicht> {
  return alsBenutzer(benutzerId, async (c) => {
    const gefiltert = istGefiltert(filter)

    const { rows: objekte } = await c.query<{
      id: string
      objektnummer: string
      bezeichnung: string
    }>('select id, objektnummer, bezeichnung from objekt order by objektnummer')

    const { rows: gruppen } = await c.query<{
      id: string
      name: string
      farbe: string | null
    }>('select id, name, farbe from ordnungsgruppe where aktiv order by sortierung, name')

    // Nur die Ablagen, die der Fragende auch sehen darf: Eine Ablage im
    // Filter, deren Belege alle unsichtbar sind, waere eine leere Liste ohne
    // Erklaerung.
    const { rows: ablagen } = await c.query<{ id: string; name: string }>(
      `select a.id, a.name from ablage a
        where a.aktiv and a.id = any ((select dms.meine_ablagen())::uuid[])
        order by a.sortierung, a.name`,
    )

    if (!gefiltert) {
      return {
        zeilen: await feed(c, { limit: filter.limit ?? 50 }),
        treffer: null,
        gefiltert: false,
        objekte,
        gruppen,
        ablagen,
      }
    }

    return {
      zeilen: await suchen(c, filter),
      treffer: await zaehlen(c, filter),
      gefiltert: true,
      objekte,
      gruppen,
      ablagen,
    }
  })
}
