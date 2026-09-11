/**
 * Tests der Stufenuebersicht.
 *
 * Die eine Zusage, an der alles haengt: **Der Zaehler zaehlt genau das, was
 * die Liste zeigt.** Eine Kennzahl wird geglaubt -- ein Zaehler, der mehr
 * zaehlt als die Liste darunter, schickt jemanden suchen; einer, der weniger
 * zaehlt, laesst einen Beleg liegen.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { stufenpostfach, stufenuebersicht } from '../src/app/lib/postfach'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const EVA = '20000000-0000-0000-0000-000000000005'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'

let beleg = ''

beforeEach(async () => {
  beleg = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, ORDNUNGSGRUPPE_BK],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-STUFEN', current_date, 1000, 190, 1190)`,
      [id, KREDITOR],
    )
    await laufStarten(c, id)
    return id
  })
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

/** Die Stufe, in der der Testbeleg gerade steht. */
async function stufeDesBelegs(): Promise<{ belegart: string; stufe: string }> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query<{ belegart: string; stufe: string }>(
      `select d.belegart, s.bezeichnung as stufe
         from aufgabe a
         join dokument_lauf l on l.id = a.lauf_id
         join dokument d on d.id = l.dokument_id
         join prozessstufe s on s.id = a.stufe_id
        where d.id = $1 and a.status in ('offen','in_arbeit')
        limit 1`,
      [beleg],
    )
    const z = rows[0]
    if (z === undefined) throw new Error('Testbeleg hat keine offene Aufgabe')
    return z
  } finally {
    c.release()
  }
}

describe('Zaehler und Liste', () => {
  it('zaehlt genau das, was die Liste zeigt -- fuer jede Stufe', async () => {
    const zaehler = await stufenuebersicht(EVA)
    expect(zaehler.length).toBeGreaterThan(0)

    for (const z of zaehler) {
      const liste = await stufenpostfach(EVA, z.belegart, z.stufe)
      expect(liste.length, `${z.belegart} / ${z.stufe}`).toBe(z.offen)
    }
  })

  it('fuehrt den neuen Beleg in seiner Stufe', async () => {
    const { belegart, stufe } = await stufeDesBelegs()
    const liste = await stufenpostfach(EVA, belegart, stufe)
    expect(liste.some((z) => z.dokumentId === beleg)).toBe(true)
  })

  it('zaehlt ueberfaellig, was faellig war', async () => {
    const c = await verbindungspool().connect()
    try {
      await c.query(
        `update aufgabe set faellig_am = now() - interval '3 days'
          where lauf_id = (select id from dokument_lauf where dokument_id = $1)`,
        [beleg],
      )
    } finally {
      c.release()
    }
    const { belegart, stufe } = await stufeDesBelegs()
    const z = (await stufenuebersicht(EVA)).find(
      (x) => x.belegart === belegart && x.stufe === stufe,
    )
    expect(z?.ueberfaellig).toBeGreaterThanOrEqual(1)
    expect(z?.aeltesteFaelligkeit).not.toBeNull()
  })
})

describe('Mandantentrennung', () => {
  it('zeigt einem fremden Mandanten nichts -- weder Zahl noch Zeile', async () => {
    const { belegart, stufe } = await stufeDesBelegs()

    const zaehler = await stufenuebersicht(DORIS)
    expect(zaehler.find((z) => z.belegart === belegart && z.stufe === stufe)).toBeUndefined()

    const liste = await stufenpostfach(DORIS, belegart, stufe)
    expect(liste.some((z) => z.dokumentId === beleg)).toBe(false)
  })

  it('zaehlt fuer den Objektverantwortlichen nur seine Objekte', async () => {
    // Anna sieht Objekt 42 -- und damit den Beleg. Aber nicht mehr als Eva.
    const { belegart, stufe } = await stufeDesBelegs()
    const anna = (await stufenuebersicht(ANNA)).find(
      (z) => z.belegart === belegart && z.stufe === stufe,
    )
    const eva = (await stufenuebersicht(EVA)).find(
      (z) => z.belegart === belegart && z.stufe === stufe,
    )
    expect(anna?.offen ?? 0).toBeGreaterThanOrEqual(1)
    expect(anna?.offen ?? 0).toBeLessThanOrEqual(eva?.offen ?? 0)
  })
})
