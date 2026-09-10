/**
 * Tests der gerechneten Belegeinsicht und der Kontierung.
 *
 * Die Mietersicht wird gerechnet, nicht freigegeben: umlagefaehige
 * Kontierungszeile UND Ueberschneidung von Leistungszeitraum und Mietzeit
 * (Konzept 7). Der Mieterwechsel ist der Fall, an dem eine manuelle
 * Freigabe scheitern wuerde -- deshalb steht er hier im Mittelpunkt.
 *
 * Voraussetzung: laufende Datenbank mit Migrationen und Seed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:15322/postgres'

const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const MEIKE_BIS_MAERZ = '85000000-0000-0000-0000-000000000001'
const NICO_AB_APRIL = '85000000-0000-0000-0000-000000000002'

const D1_JAN_BIS_MAERZ = '70000000-0000-0000-0000-000000000001'
const D4_MAI = '70000000-0000-0000-0000-000000000004'
const D5_FEBRUAR_NICHT_UMLAGEFAEHIG = '70000000-0000-0000-0000-000000000005'

const KONTO_HAUSREINIGUNG = '37000000-0000-0000-0000-000000000001'

let client: Client

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
})

afterAll(async () => {
  await client.end()
})

/** Fuehrt `aktion` in einer Transaktion aus, die danach zurueckgerollt wird. */
async function inTransaktion<T>(aktion: (c: Client) => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    return await aktion(client)
  } finally {
    await client.query('rollback')
  }
}

async function belegeFuer(personId: string): Promise<string[]> {
  return inTransaktion(async (c) => {
    const { rows } = await c.query<{ dokument_id: string }>(
      'select dokument_id from app.belege_fuer_mieter($1, $2)',
      [personId, OBJEKT_42],
    )
    return rows.map((r) => r.dokument_id)
  })
}

describe('Mietersicht', () => {
  it('zeigt dem Mieter den Beleg aus seiner Mietzeit', async () => {
    expect(await belegeFuer(MEIKE_BIS_MAERZ)).toContain(D1_JAN_BIS_MAERZ)
  })

  it('zeigt dem Nachmieter denselben Beleg nicht', async () => {
    expect(await belegeFuer(NICO_AB_APRIL)).not.toContain(D1_JAN_BIS_MAERZ)
  })

  it('zeigt dem Nachmieter nur die Belege ab seinem Einzug', async () => {
    expect(await belegeFuer(NICO_AB_APRIL)).toEqual([D4_MAI])
  })

  it('zeigt dem Vormieter den spaeteren Beleg nicht', async () => {
    expect(await belegeFuer(MEIKE_BIS_MAERZ)).not.toContain(D4_MAI)
  })

  it('verbirgt Belege ohne umlagefaehige Zeile, auch im richtigen Zeitraum', async () => {
    // d5 faellt in Meikes Mietzeit, ist aber Verwalterverguetung.
    expect(await belegeFuer(MEIKE_BIS_MAERZ)).not.toContain(D5_FEBRUAR_NICHT_UMLAGEFAEHIG)
    expect(await belegeFuer(MEIKE_BIS_MAERZ)).toEqual([D1_JAN_BIS_MAERZ])
  })

  it('zeigt einer Person ohne Mietverhaeltnis am Objekt nichts', async () => {
    const fremde = await inTransaktion(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into person (mandant_id, art, name)
         values ('10000000-0000-0000-0000-000000000001', 'mieter', 'Ohne Bezug')
         returning id`,
      )
      const { rows: belege } = await c.query(
        'select dokument_id from app.belege_fuer_mieter($1, $2)',
        [rows[0].id, OBJEKT_42],
      )
      return belege
    })
    expect(fremde).toEqual([])
  })

  it('beruecksichtigt eine unterbrochene Mietzeit stueckweise', async () => {
    // Meike zieht spaeter erneut ein: Mai bleibt aussen vor, Juni wird sichtbar.
    const sichtbar = await inTransaktion(async (c) => {
      await c.query(
        `insert into person_bezug (person_id, objekt_id, art, gueltig_von, gueltig_bis)
         values ($1, $2, 'mieter', date '2026-06-01', null)`,
        [MEIKE_BIS_MAERZ, OBJEKT_42],
      )
      await c.query(
        `insert into dokument (id, mandant_id, objekt_id, belegart, eingangskanal,
                               inhalt_hash, storage_praefix, leistung_von, leistung_bis)
         values ('70000000-0000-0000-0000-0000000000f1',
                 '10000000-0000-0000-0000-000000000001', $1, 'rechnung', 'mail',
                 'hash-f1', 'nord/42/2026/f1', date '2026-06-01', date '2026-06-30')`,
        [OBJEKT_42],
      )
      await c.query(
        `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                                 steuersatz, betrag_brutto, umlagefaehig, quelle)
         values ('70000000-0000-0000-0000-0000000000f1', 1, $1, 100.00, 19.00,
                 119.00, true, 'mensch')`,
        [KONTO_HAUSREINIGUNG],
      )
      const { rows } = await c.query<{ dokument_id: string }>(
        'select dokument_id from app.belege_fuer_mieter($1, $2)',
        [MEIKE_BIS_MAERZ, OBJEKT_42],
      )
      return rows.map((r) => r.dokument_id)
    })

    expect(sichtbar).toContain('70000000-0000-0000-0000-0000000000f1')
    expect(sichtbar).toContain(D1_JAN_BIS_MAERZ)
    // Der Mai liegt in der Luecke zwischen beiden Mietzeiten.
    expect(sichtbar).not.toContain(D4_MAI)
  })
})

describe('Umlageflag', () => {
  it('wird beim Anlegen einer umlagefaehigen Zeile gesetzt', async () => {
    const flag = await inTransaktion(async (c) => {
      await c.query(
        `insert into dokument (id, mandant_id, objekt_id, belegart, eingangskanal,
                               inhalt_hash, storage_praefix)
         values ('70000000-0000-0000-0000-0000000000f2',
                 '10000000-0000-0000-0000-000000000001', $1, 'rechnung', 'mail',
                 'hash-f2', 'nord/42/2026/f2')`,
        [OBJEKT_42],
      )
      await c.query(
        `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                                 steuersatz, betrag_brutto, umlagefaehig, quelle)
         values ('70000000-0000-0000-0000-0000000000f2', 1, $1, 100.00, 19.00,
                 119.00, true, 'mensch')`,
        [KONTO_HAUSREINIGUNG],
      )
      const { rows } = await c.query<{ hat_umlagefaehige_zeile: boolean }>(
        `select hat_umlagefaehige_zeile from dokument
          where id = '70000000-0000-0000-0000-0000000000f2'`,
      )
      return rows[0].hat_umlagefaehige_zeile
    })
    expect(flag).toBe(true)
  })

  it('faellt zurueck, wenn die letzte umlagefaehige Zeile entfaellt', async () => {
    const flag = await inTransaktion(async (c) => {
      await c.query(
        `update kontierung set umlagefaehig = false where dokument_id = $1`,
        [D1_JAN_BIS_MAERZ],
      )
      const { rows } = await c.query<{ hat_umlagefaehige_zeile: boolean }>(
        'select hat_umlagefaehige_zeile from dokument where id = $1',
        [D1_JAN_BIS_MAERZ],
      )
      return rows[0].hat_umlagefaehige_zeile
    })
    expect(flag).toBe(false)
  })

  it('faellt zurueck, wenn die Zeile geloescht wird', async () => {
    const flag = await inTransaktion(async (c) => {
      await c.query('delete from kontierung where dokument_id = $1', [D1_JAN_BIS_MAERZ])
      const { rows } = await c.query<{ hat_umlagefaehige_zeile: boolean }>(
        'select hat_umlagefaehige_zeile from dokument where id = $1',
        [D1_JAN_BIS_MAERZ],
      )
      return rows[0].hat_umlagefaehige_zeile
    })
    expect(flag).toBe(false)
  })
})

describe('Summenzwang', () => {
  it('bestaetigt eine vollstaendige Kontierung', async () => {
    const { rows } = await client.query<{ stimmt: boolean }>(
      'select app.kontierung_summe_stimmt($1) as stimmt',
      [D1_JAN_BIS_MAERZ],
    )
    expect(rows[0].stimmt).toBe(true)
  })

  it('erkennt eine zu niedrige Summe', async () => {
    const stimmt = await inTransaktion(async (c) => {
      await c.query('delete from kontierung where dokument_id = $1 and zeile_nr = 2', [
        D1_JAN_BIS_MAERZ,
      ])
      const { rows } = await c.query<{ stimmt: boolean }>(
        'select app.kontierung_summe_stimmt($1) as stimmt',
        [D1_JAN_BIS_MAERZ],
      )
      return rows[0].stimmt
    })
    expect(stimmt).toBe(false)
  })

  it('erkennt eine zu hohe Summe', async () => {
    const stimmt = await inTransaktion(async (c) => {
      await c.query(
        `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                                 steuersatz, betrag_brutto, umlagefaehig, quelle)
         values ($1, 3, $2, 8.40, 19.00, 10.00, false, 'mensch')`,
        [D1_JAN_BIS_MAERZ, KONTO_HAUSREINIGUNG],
      )
      const { rows } = await c.query<{ stimmt: boolean }>(
        'select app.kontierung_summe_stimmt($1) as stimmt',
        [D1_JAN_BIS_MAERZ],
      )
      return rows[0].stimmt
    })
    expect(stimmt).toBe(false)
  })
})
