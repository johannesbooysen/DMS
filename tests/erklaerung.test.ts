/**
 * Tests der Zuordnungserklaerung.
 *
 * Der Beleg sagt selbst, warum er ist, wo er ist -- vier Saetze mit Grund.
 * Geprueft wird, dass jeder Grund aus der richtigen Quelle kommt: Ablauf
 * und Bearbeiter abgeleitet aus geltenden Regeln, Objekt und Kategorie
 * gelesen aus dem, was im Moment der Zuordnung aufgeschrieben wurde.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { zuordnungErklaeren } from '../src/belege/erklaerung'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const EVA = '20000000-0000-0000-0000-000000000005'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const BETRIEBSKOSTEN = '40000000-0000-0000-0000-000000000001'
const SEED_ABLAUF = '65000000-0000-0000-0000-000000000001'

const angelegt: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

async function belegAnlegen(mitLauf = true): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, erfasst_von,
                             objekt_begruendung, kategorie_quelle, kategorie_begruendung)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), $4,
               'Kundennummer 4711 ist für Objekt 42 gelernt.',
               'kreditor', '„Betriebskosten“ ist am Kreditor als Standard hinterlegt.')
       returning id`,
      [MANDANT, OBJEKT_42, BETRIEBSKOSTEN, ANNA],
    )
    const dokumentId = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-ERKL', current_date, 1000, 190, 1190)`,
      [dokumentId, KREDITOR],
    )
    if (mitLauf) await laufStarten(c, dokumentId)
    return dokumentId
  })
  angelegt.push(id)
  return id
}

afterEach(async () => {
  for (const id of angelegt) await belegEntfernen(id)
  angelegt.length = 0
  // Als Eva und in einer Transaktion: Der Rechtetrigger an prozessdefinition_id
  // verlangt das Ablaufrecht, und eine sitzungsweite Kennung sickerte ueber
  // die wiederverwendete Verbindung in andere Tests.
  await alsEigentuemer(async (c) => {
    await c.query('begin')
    await c.query('select set_config($1, $2, true)', ['app.benutzer_id', EVA])
    await c.query('update ordnungsgruppe set prozessdefinition_id = null')
    await c.query('commit')
  })
})

afterAll(poolSchliessen)

describe('Gelesene Gruende', () => {
  it('nennt Objekt und Kategorie mit dem aufgeschriebenen Grund', async () => {
    const beleg = await belegAnlegen()
    const e = await zuordnungErklaeren(ANNA, beleg)
    expect(e?.objekt?.was).toBe('Objekt 42')
    expect(e?.objekt?.warum).toContain('Kundennummer 4711')
    expect(e?.kategorie?.was).toBe('Betriebskosten')
    expect(e?.kategorie?.warum).toContain('am Kreditor')
  })

  it('sagt ehrlich, wenn kein Grund aufgezeichnet ist', async () => {
    const beleg = await belegAnlegen()
    await alsEigentuemer((c) =>
      c.query(
        `update dokument set objekt_begruendung = null, kategorie_quelle = null,
                             kategorie_begruendung = null where id = $1`,
        [beleg],
      ),
    )
    const e = await zuordnungErklaeren(ANNA, beleg)
    expect(e?.objekt?.warum).toContain('ohne aufgezeichneten Grund')
    expect(e?.kategorie?.warum).toContain('ohne aufgezeichneten Grund')
  })
})

describe('Abgeleitete Gruende', () => {
  it('erklaert den Standardablauf, wenn die Kategorie keinen benennt', async () => {
    const beleg = await belegAnlegen()
    const e = await zuordnungErklaeren(ANNA, beleg)
    expect(e?.ablauf?.was).toBe('rechnung, Fassung 1')
    expect(e?.ablauf?.warum).toContain('benennt keinen eigenen')
  })

  it('erklaert den Ablauf ueber die Kategorie, wenn sie ihn benennt', async () => {
    await alsBenutzer(EVA, (c) =>
      c.query('update ordnungsgruppe set prozessdefinition_id = $2 where id = $1', [
        BETRIEBSKOSTEN,
        SEED_ABLAUF,
      ]),
    )
    const beleg = await belegAnlegen()
    const e = await zuordnungErklaeren(ANNA, beleg)
    expect(e?.ablauf?.warum).toContain('benennt diesen Ablauf')
  })

  it('nennt die offene Stufe und wer sie bearbeiten kann', async () => {
    const beleg = await belegAnlegen()
    const e = await zuordnungErklaeren(ANNA, beleg)
    // Erste Stufe im Seed: Sachliche Pruefung, objektverantwortlich -- Anna.
    expect(e?.stufe?.was).toBe('Sachliche Pruefung')
    expect(e?.stufe?.warum).toContain('Objekt 42')
    expect(e?.stufe?.personen).toContain('Anna Ahrens')
  })

  it('hat keine Stufe ohne Lauf', async () => {
    const beleg = await belegAnlegen(false)
    const e = await zuordnungErklaeren(ANNA, beleg)
    expect(e?.stufe).toBeNull()
    expect(e?.ablauf).toBeNull()
  })
})

describe('Mandantentrennung', () => {
  it('erklaert einem fremden Mandanten nichts', async () => {
    const beleg = await belegAnlegen()
    expect(await zuordnungErklaeren(DORIS, beleg)).toBeNull()
  })
})
