/**
 * Tests der Ausfuehrbarkeitspruefung.
 *
 * Die drei rot markierten Befunde aus dem Diagramm des abzuloesenden Systems
 * -- ein Stempel, den niemand setzen darf; eine Zustaendigkeit ohne Menschen;
 * eine Stelle, die an einer Person haengt -- muessen beim Aktivieren
 * auffallen, nicht nach einem Diagramm.
 *
 * Jeder Test baut den Zustand her, den er prueft, und raeumt ihn weg: Die
 * Rechte des Seeds sind fuer die uebrigen Tests die Wahrheit.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { poolSchliessen, verbindungspool } from '../src/db'
import { entwurfAnlegen, entwurfPruefung } from '../src/workflow/konfiguration'

const EVA = '20000000-0000-0000-0000-000000000005'
const DEFINITION_AKTIV = '65000000-0000-0000-0000-000000000001'
const SEED_DEFINITIONEN = [DEFINITION_AKTIV, '65000000-0000-0000-0000-000000000002']

interface Sicherung {
  rechte: Array<Record<string, unknown>>
}
const sicherung: Sicherung = { rechte: [] }

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

/** Stufe einer Fassung nach Typ. */
async function stufe(definitionId: string, stufentyp: string): Promise<{ id: string; bezeichnung: string }> {
  return alsEigentuemer(async (c) => {
    const { rows } = await c.query<{ id: string; bezeichnung: string }>(
      'select id, bezeichnung from prozessstufe where definition_id = $1 and stufentyp = $2 limit 1',
      [definitionId, stufentyp],
    )
    if (rows[0] === undefined) throw new Error(`Seed ohne Stufe vom Typ ${stufentyp}`)
    return rows[0]
  })
}

/** Nimmt allen die Rechte auf die Stempel einer Stufe -- und merkt sie sich. */
async function rechteEntziehen(stufeId: string): Promise<void> {
  await alsEigentuemer(async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `delete from stempel_recht
        where stempeltyp_id in (select stempeltyp_id from prozessstufe_stempeltyp where stufe_id = $1)
        returning id, stempeltyp_id, gruppe_id, rolle_id`,
      [stufeId],
    )
    sicherung.rechte.push(...rows)
  })
}

afterEach(async () => {
  await alsEigentuemer(async (c) => {
    for (const r of sicherung.rechte) {
      await c.query(
        `insert into stempel_recht (id, stempeltyp_id, gruppe_id, rolle_id)
         values ($1, $2, $3, $4) on conflict (id) do nothing`,
        [r['id'], r['stempeltyp_id'], r['gruppe_id'], r['rolle_id']],
      )
    }
    sicherung.rechte.length = 0
    await c.query(`delete from gruppe where name = 'Leere Testgruppe'`)
    await c.query(
      `update prozessdefinition
          set status = 'abgeloest', entwurf_von = null, entwurf_seit = null, aktiv_bis = now()
        where id <> all($1::uuid[]) and status in ('entwurf', 'aktiv')`,
      [SEED_DEFINITIONEN],
    )
    await c.query(`update prozessdefinition set status = 'aktiv', aktiv_bis = null where id = any($1::uuid[])`, [
      SEED_DEFINITIONEN,
    ])
  })
})

afterAll(poolSchliessen)

describe('Niemand darf stempeln', () => {
  it('meldet eine Stufe, deren Stempel kein aktiver Benutzer setzen darf', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const sachlich = await stufe(entwurf, 'sachlich')
    await rechteEntziehen(sachlich.id)

    const befunde = await entwurfPruefung(EVA, entwurf)
    const treffer = befunde.filter((b) => b.befund.includes('darf niemand stempeln'))
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.schwere).toBe('fehler')
    expect(treffer[0]?.befund).toContain(sachlich.bezeichnung)
  })

  it('meldet nichts, solange jemand darf', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const befunde = await entwurfPruefung(EVA, entwurf)
    expect(befunde.filter((b) => b.befund.includes('darf niemand stempeln'))).toEqual([])
  })
})

describe('Zustaendigkeit ohne Menschen', () => {
  it('meldet eine Gruppe ohne Mitglieder', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const sachlich = await stufe(entwurf, 'sachlich')
    await alsEigentuemer(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into gruppe (mandant_id, name) values ('10000000-0000-0000-0000-000000000001', 'Leere Testgruppe') returning id`,
      )
      await c.query(
        `update prozessstufe set zustaendigkeit_typ = 'gruppe', zustaendigkeit_ref = $2 where id = $1`,
        [sachlich.id, rows[0].id],
      )
    })

    const befunde = await entwurfPruefung(EVA, entwurf)
    const treffer = befunde.filter((b) => b.befund.includes('loest auf keine aktive Person'))
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.schwere).toBe('fehler')
  })

  it('laesst objektverantwortlich ungeprueft -- das haengt am Beleg', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const befunde = await entwurfPruefung(EVA, entwurf)
    expect(befunde.filter((b) => b.befund.includes('loest auf keine aktive Person'))).toEqual([])
  })
})

describe('Genau eine Person', () => {
  it('warnt, wenn eine Stufe an einer Person haengt', async () => {
    // Im Seed traegt allein die Geschaeftsleitung (Eva) den Freigabestempel.
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const freigabe = await stufe(entwurf, 'freigabe')

    const befunde = await entwurfPruefung(EVA, entwurf)
    const treffer = befunde.filter(
      (b) => b.befund.includes('genau einer Person') && b.befund.includes(freigabe.bezeichnung),
    )
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.schwere).toBe('warnung')
  })

  it('ist eine Warnung, kein Hindernis -- aktivieren geht trotzdem', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const befunde = await entwurfPruefung(EVA, entwurf)
    expect(befunde.filter((b) => b.schwere === 'fehler')).toEqual([])
  })
})
