/**
 * Gespeicherte Suchen -- ein Filter der Belegliste mit Namen.
 *
 * Amagnos "eigener Magnet" fuer den Alltag, ohne dass daraus ein Ablauf
 * wird (Migration 20260923120000): Eine Suche zeigt Belege, sie schiebt
 * keine. Persoenlich -- die RLS zeigt jedem nur seine eigenen.
 *
 * **Weissliste.** Gespeichert werden genau die Schluessel, die die Belegliste
 * auswertet. Ein unbekannter Schluessel wird verworfen, nicht mitgeschleppt:
 * Eine Suche, die etwas speichert, was niemand liest, sieht gespeichert aus
 * und filtert nicht.
 */

import { alsBenutzer } from '../db'

export const SUCHSCHLUESSEL = ['q', 'objekt', 'gruppe', 'belegart', 'ampel', 'von', 'bis'] as const
export type Suchschluessel = (typeof SUCHSCHLUESSEL)[number]
export type Suchfilter = Partial<Record<Suchschluessel, string>>

export class SucheAbgelehnt extends Error {}

export interface GespeicherteSuche {
  id: string
  name: string
  filter: Suchfilter
}

/** Aus beliebigen Abfrageparametern das, was die Liste kennt -- leere Werte fallen weg. */
export function suchfilterLesen(params: Record<string, string | undefined>): Suchfilter {
  const filter: Suchfilter = {}
  for (const k of SUCHSCHLUESSEL) {
    const w = params[k]?.trim()
    if (w !== undefined && w !== '') filter[k] = w
  }
  return filter
}

/** Der Filter als Abfragezeichenkette fuer /belege. */
export function alsAbfrage(filter: Suchfilter): string {
  const teile = SUCHSCHLUESSEL.filter((k) => filter[k] !== undefined).map(
    (k) => `${k}=${encodeURIComponent(filter[k] ?? '')}`,
  )
  return teile.length === 0 ? '/belege' : `/belege?${teile.join('&')}`
}

export async function suchenLaden(benutzerId: string): Promise<GespeicherteSuche[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string; name: string; filter: unknown }>(
      'select id, name, filter from gespeicherte_suche order by name',
    )
    return rows.map((z) => ({
      id: z.id,
      name: z.name,
      filter: suchfilterLesen(
        typeof z.filter === 'object' && z.filter !== null ? (z.filter as Record<string, string>) : {},
      ),
    }))
  })
}

/**
 * Speichert -- oder ersetzt eine gleichnamige.
 *
 * Denselben Namen ein zweites Mal zu vergeben heisst fast immer: "so, wie
 * ich jetzt suche". Ein Fehler "Name schon vergeben" waere die Frage, die
 * niemand gestellt hat.
 */
export async function sucheSpeichern(
  benutzerId: string,
  name: string,
  params: Record<string, string | undefined>,
): Promise<void> {
  const bereinigt = name.trim()
  if (bereinigt === '' || bereinigt.length > 80) {
    throw new SucheAbgelehnt('Eine gespeicherte Suche braucht einen Namen (bis 80 Zeichen).')
  }
  const filter = suchfilterLesen(params)
  if (Object.keys(filter).length === 0) {
    throw new SucheAbgelehnt('Ohne Filter gibt es nichts zu speichern -- das waere die ganze Liste.')
  }
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `insert into gespeicherte_suche (mandant_id, benutzer_id, name, filter)
       values (app.mein_mandant(), app.mein_benutzer(), $1, $2::jsonb)
       on conflict (benutzer_id, name) do update set filter = excluded.filter`,
      [bereinigt, JSON.stringify(filter)],
    )
    if (rowCount === 0) throw new SucheAbgelehnt('Die Suche wurde nicht gespeichert.')
  })
}

export async function sucheLoeschen(benutzerId: string, id: string): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    // Eine fremde Kennung trifft unter der RLS nichts -- und das ist kein
    // Fehler, den man dem Aufrufer erklaeren muesste.
    await c.query('delete from gespeicherte_suche where id = $1', [id])
  })
}
