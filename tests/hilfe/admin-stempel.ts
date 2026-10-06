/**
 * Dem Admin aus den Testdaten seine Stempelrechte nehmen -- und zurueckgeben.
 *
 * Der Seed hat seit dem 26.09.2026 einen Admin mit jedem Stempel des Hauses
 * (CLAUDE.md: "Die Testdaten haben einen Admin"). Damit kann an keiner Stufe
 * mehr **genau eine** Person entscheiden -- die Warnung "genau einer Person"
 * aus app.prozessbaum_pruefen ist im Seed verschwunden, und das ist richtig
 * so. Tests, die diese Warnung pruefen, brauchen den Seed ohne Admin-Stempel:
 * Sie entziehen sie hier vorher und geben sie nachher zurueck -- mit den
 * urspruenglichen Kennungen, damit nichts anderes davon etwas merkt.
 */

import type { Client, PoolClient } from 'pg'

const ADMIN_ROLLE = '90000000-0000-0000-0000-000000000004'

export interface Stempelrecht {
  id: string
  stempeltyp_id: string
  gruppe_id: string | null
  rolle_id: string | null
}

export async function adminStempelEntziehen(c: Client | PoolClient): Promise<Stempelrecht[]> {
  const { rows } = await c.query<Stempelrecht>(
    'delete from stempel_recht where rolle_id = $1 returning id, stempeltyp_id, gruppe_id, rolle_id',
    [ADMIN_ROLLE],
  )
  return rows
}

export async function adminStempelZurueck(c: Client | PoolClient, rechte: Stempelrecht[]): Promise<void> {
  for (const r of rechte) {
    await c.query(
      `insert into stempel_recht (id, stempeltyp_id, gruppe_id, rolle_id)
       values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [r.id, r.stempeltyp_id, r.gruppe_id, r.rolle_id],
    )
  }
}
