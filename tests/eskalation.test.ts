/**
 * Tests der Eskalation.
 *
 * Die Stufe traegt seit dem Kernschema `eskalation_nach_stunden` und
 * `eskalation_an`; gelesen hat sie bis Migration 20260926130000 niemand.
 * Geprueft wird die eine Regel, die der Durchgang umsetzt: Eine Aufgabe
 * ueber der Frist geht **einmal** an die hinterlegte Person, mit Protokoll --
 * und eine Aufgabe in der Frist bleibt, wo sie ist.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { VERWALTER } from './hilfe/kennungen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { eskalationDurchgang } from '../src/workflow/eskalation'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const EVA = '20000000-0000-0000-0000-000000000005'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'

/* Eigener Ablauf mit einer Stufe, die nach zwei Stunden an Eva eskaliert. */
const GRUPPE = '40000000-0000-0000-0000-0000000000e5'
const DEFINITION = '65000000-0000-0000-0000-0000000000e5'
const STUFE = '66000000-0000-0000-0000-0000000000e5'
const WURZEL = '67000000-0000-0000-0000-0000000000e5'
const BLATT = '67000000-0000-0000-0000-0000000000e6'

let beleg = ''

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

beforeAll(async () => {
  await alsBenutzer(VERWALTER, async (c) => {
    await c.query(
      `insert into ordnungsgruppe (id, mandant_id, name, kurzcode, sortierung)
       values ($1, $2, 'Eskalationstest', 'ESK', 910)
       on conflict (id) do update set aktiv = true`,
      [GRUPPE, MANDANT],
    )
    await c.query(
      `insert into prozessdefinition (id, mandant_id, belegart, ordnungsgruppe_id, version, status, aktiv_ab)
       values ($1, $2, 'rechnung', $3, 1, 'aktiv', now())
       on conflict (id) do update set status = 'aktiv'`,
      [DEFINITION, MANDANT, GRUPPE],
    )
    await c.query(
      `insert into prozessstufe (id, definition_id, reihenfolge, stufentyp, bezeichnung,
                                 zustaendigkeit_typ, sla_stunden, eskalation_nach_stunden, eskalation_an)
       values ($1, $2, 1, 'sachlich', 'Sachlich mit Eskalation', 'objektverantwortlich', 24, 2, $3)
       on conflict (id) do nothing`,
      [STUFE, DEFINITION, EVA],
    )
    await c.query(
      `insert into prozessknoten (id, definition_id, eltern_id, reihenfolge, knotentyp, stufe_id)
       values ($1, $2, null, 0, 'nacheinander', null), ($3, $2, $1, 0, 'stufe', $4)
       on conflict (id) do nothing`,
      [WURZEL, DEFINITION, BLATT, STUFE],
    )
  })
})

afterAll(async () => {
  await alsBenutzer(VERWALTER, async (c) => {
    await c.query(`update prozessdefinition set status = 'abgeloest' where id = $1`, [DEFINITION])
    await c.query('update ordnungsgruppe set aktiv = false where id = $1', [GRUPPE])
  })
  await poolSchliessen()
})

beforeEach(async () => {
  beleg = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text), 'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, GRUPPE],
    )
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer, rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-ESKALATION', current_date, 1000, 190, 1190)`,
      [rows[0].id, KREDITOR],
    )
    await laufStarten(c, rows[0].id)
    return rows[0].id
  })
})

afterEach(async () => {
  // Das Protokoll haengt am Beleg und geht mit ihm -- belegEntfernen nimmt
  // die Append-only-Trigger dafuer kurz ab.
  await belegEntfernen(beleg)
})

async function aufgabe(): Promise<{ zugewiesen: string | null; stufe: number }> {
  const [z] = await direkt<{ zugewiesen_benutzer: string | null; eskalationsstufe: number }>(
    `select a.zugewiesen_benutzer, a.eskalationsstufe from aufgabe a
       join dokument_lauf l on l.id = a.lauf_id where l.dokument_id = $1`,
    [beleg],
  )
  return { zugewiesen: z.zugewiesen_benutzer, stufe: z.eskalationsstufe }
}

/** Die Aufgabe um Stunden zurueckdatieren -- die Zeit vergeht im Test nicht von selbst. */
async function ueberfaelligSeit(stunden: number): Promise<void> {
  await direkt(
    `update aufgabe a set faellig_am = now() - ($2 * interval '1 hour')
       from dokument_lauf l where l.id = a.lauf_id and l.dokument_id = $1`,
    [beleg, stunden],
  )
}

describe('Eskalation', () => {
  it('laesst eine Aufgabe in der Frist, wo sie ist', async () => {
    expect((await aufgabe()).zugewiesen).toBe(ANNA)
    await eskalationDurchgang()
    expect(await aufgabe()).toEqual({ zugewiesen: ANNA, stufe: 0 })
  })

  it('laesst sie auch kurz nach der Frist -- die Spanne ist noch nicht um', async () => {
    await ueberfaelligSeit(1)
    await eskalationDurchgang()
    expect(await aufgabe()).toEqual({ zugewiesen: ANNA, stufe: 0 })
  })

  it('gibt sie nach der Spanne der hinterlegten Person -- mit Protokoll', async () => {
    await ueberfaelligSeit(3)
    const bilanz = await eskalationDurchgang()
    expect(bilanz.eskaliert).toBeGreaterThanOrEqual(1)
    expect(await aufgabe()).toEqual({ zugewiesen: EVA, stufe: 1 })

    const ereignisse = await direkt<{ von_benutzer: string; an_benutzer: string; grund: string }>(
      'select von_benutzer, an_benutzer, grund from zuweisung_ereignis where dokument_id = $1',
      [beleg],
    )
    expect(ereignisse).toEqual([{ von_benutzer: ANNA, an_benutzer: EVA, grund: 'eskalation' }])
  })

  it('eskaliert genau einmal, nie im Kreis', async () => {
    await ueberfaelligSeit(3)
    await eskalationDurchgang()
    await eskalationDurchgang()
    expect(await aufgabe()).toEqual({ zugewiesen: EVA, stufe: 1 })
    const [z] = await direkt<{ n: string }>(
      'select count(*)::text as n from zuweisung_ereignis where dokument_id = $1',
      [beleg],
    )
    expect(Number(z.n)).toBe(1)
  })

  it('sieht Eva die Aufgabe danach persoenlich', async () => {
    await ueberfaelligSeit(3)
    await eskalationDurchgang()
    const { persoenlichesPostfach } = await import('../src/app/lib/postfach')
    const eigene = await persoenlichesPostfach(EVA)
    expect(eigene.some((a) => a.dokumentId === beleg)).toBe(true)
  })
})
