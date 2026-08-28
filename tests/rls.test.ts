/**
 * Tests der RLS-Policies.
 *
 * Die Policies sind die Sicherheitsgrenze, kein Feature (Konzept 23) --
 * deshalb stehen diese Tests vor dem ersten Anwendungscode.
 *
 * Jeder Test laeuft in einer eigenen Transaktion, die am Ende zurueckgerollt
 * wird. Der Benutzerwechsel geschieht ueber `set local role dms_app` und
 * `set local app.benutzer_id` -- der Eigentuemer der Tabellen umgeht RLS,
 * ein Test als Eigentuemer waere also wertlos.
 *
 * Voraussetzung: `npm run db:start && npm run db:reset` (Migrationen + Seed).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const CLARA = '20000000-0000-0000-0000-000000000003'
const DORIS = '20000000-0000-0000-0000-000000000004'

const D1_OBJEKT42 = '70000000-0000-0000-0000-000000000001'
const D2_VERSICHERUNG_OBJEKT43 = '70000000-0000-0000-0000-000000000002'
const D3_OBJEKT43 = '70000000-0000-0000-0000-000000000003'
const LAUF_D1 = '75000000-0000-0000-0000-000000000001'
const STUFE_SACHLICH = '66000000-0000-0000-0000-000000000001'
const STEMPEL_SACHLICH = '60000000-0000-0000-0000-000000000001'

let client: Client

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
})

afterAll(async () => {
  await client.end()
})

/** Fuehrt `aktion` als der angegebene Benutzer aus und rollt danach zurueck. */
async function alsBenutzer<T>(
  benutzerId: string,
  aktion: (c: Client) => Promise<T>,
): Promise<T> {
  await client.query('begin')
  try {
    await client.query('set local role dms_app')
    await client.query('select set_config($1, $2, true)', ['app.benutzer_id', benutzerId])
    return await aktion(client)
  } finally {
    await client.query('rollback')
  }
}

async function sichtbareDokumente(benutzerId: string): Promise<string[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string }>('select id from dokument order by id')
    return rows.map((r) => r.id)
  })
}

describe('Mandantentrennung', () => {
  it('zeigt einem Benutzer aus einem fremden Mandanten keinen einzigen Beleg des anderen', async () => {
    const sichtbar = await sichtbareDokumente(DORIS)
    expect(sichtbar).not.toContain(D1_OBJEKT42)
    expect(sichtbar).not.toContain(D2_VERSICHERUNG_OBJEKT43)
    expect(sichtbar).not.toContain(D3_OBJEKT43)
  })

  it('zeigt einem Benutzer aus einem fremden Mandanten keine Objekte', async () => {
    const objekte = await alsBenutzer(DORIS, async (c) => {
      const { rows } = await c.query<{ objektnummer: string }>('select objektnummer from objekt')
      return rows.map((r) => r.objektnummer)
    })
    expect(objekte).toEqual(['99'])
  })

  it('liefert auch bei gezieltem Zugriff auf eine bekannte ID nichts', async () => {
    const treffer = await alsBenutzer(DORIS, async (c) => {
      const { rowCount } = await c.query('select 1 from dokument where id = $1', [D1_OBJEKT42])
      return rowCount
    })
    expect(treffer).toBe(0)
  })
})

describe('Objektzustaendigkeit', () => {
  it('zeigt dem Objektbearbeiter nur Belege seiner Objekte', async () => {
    const sichtbar = await sichtbareDokumente(ANNA)
    expect(sichtbar).toEqual([D1_OBJEKT42])
  })

  it('zeigt dem Benutzer mit globalem Objektzugriff alle Belege seines Mandanten', async () => {
    const sichtbar = await sichtbareDokumente(BERND)
    expect(sichtbar).toEqual([D1_OBJEKT42, D2_VERSICHERUNG_OBJEKT43, D3_OBJEKT43])
  })

  it('beendet die Sicht mit dem Ablauf der Zustaendigkeit', async () => {
    const sichtbar = await alsBenutzer(ANNA, async (c) => {
      // Als Eigentuemer setzen, damit die Aenderung nicht selbst an der RLS scheitert.
      await c.query('reset role')
      await c.query(
        `update objekt_zustaendigkeit set gueltig_bis = current_date - 1
          where benutzer_id = $1`,
        [ANNA],
      )
      await c.query('set local role dms_app')
      const { rows } = await c.query<{ id: string }>('select id from dokument')
      return rows.map((r) => r.id)
    })
    expect(sichtbar).toEqual([])
  })
})

describe('Spezialgebiet', () => {
  it('zeigt dem Spezialisten den Beleg seines Gebiets in einem fremden Objekt', async () => {
    const sichtbar = await sichtbareDokumente(CLARA)
    expect(sichtbar).toContain(D2_VERSICHERUNG_OBJEKT43)
  })

  it('zeigt ihm dabei nicht die uebrigen Belege desselben Objekts', async () => {
    const sichtbar = await sichtbareDokumente(CLARA)
    expect(sichtbar).not.toContain(D3_OBJEKT43)
    expect(sichtbar).toEqual([D2_VERSICHERUNG_OBJEKT43])
  })
})

describe('Stempelereignisse', () => {
  it('haengt jeden Eintrag an den vorherigen an', async () => {
    const kette = await alsBenutzer(ANNA, async (c) => {
      for (const entscheidung of ['freigabe', 'freigabe']) {
        await c.query(
          `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, stempeltyp_id, entscheidung)
           values ($1, $2, $3, $4, $5)`,
          [LAUF_D1, STUFE_SACHLICH, ANNA, STEMPEL_SACHLICH, entscheidung],
        )
      }
      const { rows } = await c.query<{ vorheriger_hash: string | null; eintrag_hash: string }>(
        'select vorheriger_hash, eintrag_hash from stempel_ereignis where lauf_id = $1 order by folge',
        [LAUF_D1],
      )
      return rows
    })

    expect(kette).toHaveLength(2)
    expect(kette[0].vorheriger_hash).toBeNull()
    expect(kette[0].eintrag_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(kette[1].vorheriger_hash).toBe(kette[0].eintrag_hash)
  })

  // Der Schutz greift zweifach. Unter der Anwendungsrolle gibt die RLS keine
  // Zeile fuer update oder delete frei -- es gibt fuer beides keine Policy --,
  // die Anweisung trifft also nichts. Wer die RLS umgeht, faellt in den
  // Trigger. Beide Ebenen werden einzeln geprueft, weil die eine die andere
  // sonst verdeckt.
  it('gibt unter der Anwendungsrolle keine Zeile zum Aendern frei', async () => {
    const ergebnis = await alsBenutzer(ANNA, async (c) => {
      await c.query(
        `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung)
         values ($1, $2, $3, 'freigabe')`,
        [LAUF_D1, STUFE_SACHLICH, ANNA],
      )
      const geaendert = await c.query(
        `update stempel_ereignis set kommentar = 'nachtraeglich' where lauf_id = $1`,
        [LAUF_D1],
      )
      const { rows } = await c.query<{ kommentar: string | null }>(
        'select kommentar from stempel_ereignis where lauf_id = $1',
        [LAUF_D1],
      )
      return { betroffen: geaendert.rowCount, kommentare: rows.map((r) => r.kommentar) }
    })
    expect(ergebnis.betroffen).toBe(0)
    expect(ergebnis.kommentare).toEqual([null])
  })

  it('gibt unter der Anwendungsrolle keine Zeile zum Loeschen frei', async () => {
    const ergebnis = await alsBenutzer(ANNA, async (c) => {
      await c.query(
        `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung)
         values ($1, $2, $3, 'freigabe')`,
        [LAUF_D1, STUFE_SACHLICH, ANNA],
      )
      const geloescht = await c.query('delete from stempel_ereignis where lauf_id = $1', [LAUF_D1])
      const { rowCount } = await c.query('select 1 from stempel_ereignis where lauf_id = $1', [
        LAUF_D1,
      ])
      return { betroffen: geloescht.rowCount, verblieben: rowCount }
    })
    expect(ergebnis.betroffen).toBe(0)
    expect(ergebnis.verblieben).toBe(1)
  })

  it('wehrt eine Aenderung auch am Rechtesystem vorbei ab', async () => {
    await expect(
      alsBenutzer(ANNA, async (c) => {
        await c.query(
          `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung)
           values ($1, $2, $3, 'freigabe')`,
          [LAUF_D1, STUFE_SACHLICH, ANNA],
        )
        // Als Tabelleneigentuemer -- die RLS filtert hier nichts mehr weg.
        await c.query('reset role')
        await c.query(`update stempel_ereignis set kommentar = 'nachtraeglich'
                        where lauf_id = $1`, [LAUF_D1])
      }),
    ).rejects.toThrow(/append-only/i)
  })

  it('wehrt ein Loeschen auch am Rechtesystem vorbei ab', async () => {
    await expect(
      alsBenutzer(ANNA, async (c) => {
        await c.query(
          `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung)
           values ($1, $2, $3, 'freigabe')`,
          [LAUF_D1, STUFE_SACHLICH, ANNA],
        )
        await c.query('reset role')
        await c.query('delete from stempel_ereignis where lauf_id = $1', [LAUF_D1])
      }),
    ).rejects.toThrow(/append-only/i)
  })

  it('verhindert das Stempeln im fremden Namen', async () => {
    await expect(
      alsBenutzer(ANNA, async (c) => {
        await c.query(
          `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung)
           values ($1, $2, $3, 'freigabe')`,
          [LAUF_D1, STUFE_SACHLICH, BERND],
        )
      }),
    ).rejects.toThrow(/row-level security/i)
  })
})

describe('Klaerung', () => {
  it('verlangt einen Kommentar', async () => {
    await expect(
      alsBenutzer(ANNA, async (c) => {
        await c.query(
          `insert into klaerung (dokument_id, grund, kommentar, eroeffnet_von,
                                 verantwortlich_benutzer, wiedervorlage_am)
           values ($1, 'Rueckfrage', '   ', $2, $2, current_date + 7)`,
          [D1_OBJEKT42, ANNA],
        )
      }),
    ).rejects.toThrow()
  })

  it('verlangt ein Wiedervorlagedatum', async () => {
    await expect(
      alsBenutzer(ANNA, async (c) => {
        await c.query(
          `insert into klaerung (dokument_id, grund, kommentar, eroeffnet_von,
                                 verantwortlich_benutzer)
           values ($1, 'Rueckfrage', 'Betrag weicht ab', $2, $2)`,
          [D1_OBJEKT42, ANNA],
        )
      }),
    ).rejects.toThrow()
  })
})
