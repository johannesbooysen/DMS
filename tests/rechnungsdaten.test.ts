/**
 * Tests der Rechnungsdaten-Anzeige: Wert und Herkunft je Feld.
 *
 * Die Anzeige behauptet nichts, was nicht in den Fakten und den erkannten
 * Feldern steht -- und sie sagt, wenn ein Mensch den erkannten Wert
 * ueberschrieben hat. Ein fremdes Haus sieht nichts.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { rechnungsdatenLaden } from '../src/belege/rechnungsdaten'
import { belegEntfernen } from './hilfe/aufraeumen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'

let beleg = ''

beforeEach(async () => {
  beleg = await alsBenutzer(BERND, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, belegart, ordnungsgruppe_id, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt, ampel_extraktion)
       values ($1, 'rechnung', $2, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'rot', 'orange')
       returning id`,
      [MANDANT, GRUPPE_BK],
    )
    const id = rows[0]!.id
    await c.query(
      `insert into rechnung_fakten (dokument_id, rechnungsnummer, rechnungsdatum, brutto, netto, wirtschaftsjahr)
       values ($1, 'RE-77', '2026-09-03', 119, 100, 2026)`,
      [id],
    )
    await c.query(
      `insert into extraktion_feld (dokument_id, feldname, wert_text, wert_zahl, wert_datum, confidence, quelle, modell) values
         ($1, 'rechnungsnummer', 'RE-77', null, null, 0.92, 'ki', 'test'),
         ($1, 'brutto', null, 119, null, 0.8, 'ki', 'test'),
         ($1, 'netto', null, 95, null, 0.6, 'ki', 'test')`,
      [id],
    )
    return id
  })
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

describe('Rechnungsdaten', () => {
  it('zeigt Wert und Herkunft je Feld -- erkannt mit Vertrauen, geaendert, eingetragen, fehlt', async () => {
    const daten = await rechnungsdatenLaden(BERND, beleg)
    expect(daten).not.toBeNull()
    const je = new Map(daten!.zeilen.map((z) => [z.feld, z]))

    expect(je.get('rechnungsnummer')).toMatchObject({ wert: 'RE-77', herkunft: 'ki', vertrauen: 0.92, pflicht: true })
    expect(je.get('brutto')).toMatchObject({ wert: '119,00 €', herkunft: 'ki', vertrauen: 0.8 })
    // Erkannt 95, in den Fakten 100: jemand hat es geaendert.
    expect(je.get('netto')).toMatchObject({ wert: '100,00 €', herkunft: 'mensch', vertrauen: null })
    // Datum ohne Erkennung: eingetragen, deutsch formatiert.
    expect(je.get('rechnungsdatum')).toMatchObject({ wert: '03.09.2026', herkunft: null })
    // Pflichtfeld ohne Wert: fehlt, und steht in der Liste.
    expect(je.get('kreditor_name')).toMatchObject({ wert: null, pflicht: true })
    expect(daten!.fehlendePflicht).toEqual(['Kreditor (Rechnungssteller)'])
    expect(daten!.ampelExtraktion).toBe('orange')
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    expect(await rechnungsdatenLaden(DORIS, beleg)).toBeNull()
  })
})
