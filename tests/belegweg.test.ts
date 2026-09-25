/**
 * Tests des Belegwegs -- die Kette eines Belegs mit dem, was darin geschah.
 *
 * Geprueft wird, dass die Grafik nichts behauptet: Die Stufen kommen aus
 * der Simulation des Laufs, die Zustaende aus den Aufgaben, die Stempel aus
 * den Ereignissen. Und dass ein fremdes Haus nichts davon sieht.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { belegwegLaden } from '../src/belege/belegweg'
import { laufStarten, stempeln } from '../src/workflow/engine'
import { belegEntfernen } from './hilfe/aufraeumen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const STEMPEL_SACHLICH = '60000000-0000-0000-0000-000000000001'

let beleg = ''
let laufId = ''

beforeEach(async () => {
  ;({ beleg, laufId } = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, GRUPPE_BK],
    )
    const id = rows[0]!.id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer, rechnungsdatum, brutto, wirtschaftsjahr)
       values ($1, $2, 'WEG-1', '2026-09-01', 1190, 2026)`,
      [id, KREDITOR],
    )
    const lauf = await laufStarten(c, id)
    return { beleg: id, laufId: lauf!.laufId }
  }))
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

describe('Belegweg', () => {
  it('zeigt die Kette des Laufs -- die erste Stufe offen, der Rest ausstehend', async () => {
    const weg = await belegwegLaden(ANNA, beleg)
    expect(weg).not.toBeNull()
    expect(weg!.schritte.length).toBeGreaterThanOrEqual(4)
    const erste = weg!.schritte[0]!.stufen[0]!
    expect(erste.bezeichnung).toBe('Sachliche Pruefung')
    expect(erste.zustand).toBe('aktuell')
    expect(erste.bei).toBe('Anna Ahrens')
    expect(weg!.schritte.slice(1).flatMap((s) => s.stufen).every((s) => s.zustand === 'ausstehend')).toBe(true)
    expect(weg!.ereignisse).toEqual([])
    expect(weg!.archiviertAm).toBeNull()
  })

  it('traegt nach dem Stempel Erledigt mit Namen und Zeit ein, und die naechste Stufe wird aktuell', async () => {
    await alsBenutzer(ANNA, (c) =>
      stempeln(c, {
        laufId,
        stufeId: '66000000-0000-0000-0000-000000000001',
        benutzerId: ANNA,
        stempeltypId: STEMPEL_SACHLICH,
        entscheidung: 'freigabe',
        kommentar: 'passt',
      }),
    )
    const weg = await belegwegLaden(ANNA, beleg)
    const [erste, zweite] = weg!.schritte.map((s) => s.stufen[0]!)
    expect(erste!.zustand).toBe('erledigt')
    expect(erste!.stempel).toHaveLength(1)
    expect(erste!.stempel[0]).toMatchObject({ name: 'Sachlich richtig', von: 'Anna Ahrens', kommentar: 'passt' })
    expect(zweite!.zustand).toBe('aktuell')
    expect(weg!.ereignisse).toHaveLength(1)
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    expect(await belegwegLaden(DORIS, beleg)).toBeNull()
  })
})
