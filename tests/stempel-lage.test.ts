/**
 * Der Stempel wird platziert, bevor er gilt (ADR 0009).
 *
 * Zusicherungen:
 *   - Eine mitgegebene Lage landet so im Layer, wie der Mensch sie gewaehlt hat.
 *   - Ohne Lage bleibt es beim errechneten Platz (dms.stempelplatz).
 *   - Eine Lage ueber Text oder unter dem Mindestmass wird abgewiesen -- als
 *     Satz aus stempelSetzen und als Grenze im Trigger, wenn jemand die
 *     Anwendung umgeht.
 *   - platzierungLaden liefert Vorschlag, Masse und Textkaesten; fehlen die
 *     Masse, liefert es null, und die Datenbank waehlt.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { layerLaden, platzierungLaden } from '../src/layer'
import { aufgabeLaden, persoenlichesPostfach, poolPostfach, StempelAbgelehnt, stempelSetzen } from '../src/app/lib/postfach'
import { laufStarten, stempeln } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const STUFE_SACHLICH = '66000000-0000-0000-0000-000000000001'
const STEMPEL_SACHLICH = '60000000-0000-0000-0000-000000000001'

const SEITE = { breite: 595, hoehe: 842 }
const FREIER_PLATZ = { x: 380, y: 40, breite: 190, hoehe: 64 }
const TEXTZEILE = { x: 40, y: 100, breite: 300, hoehe: 12 }
const ZWEITER_PLATZ = { x: 380, y: 120, breite: 190, hoehe: 64 }

let beleg: string
let laufId: string

async function belegAnlegen(mitMassen: boolean): Promise<void> {
  ;({ beleg, laufId } = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen', 1)
       returning id`,
      [MANDANT, OBJEKT_42, ORDNUNGSGRUPPE_BK],
    )
    const id = rows[0]!.id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer, rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-LAGE', current_date, 1000, 190, 1190)`,
      [id, KREDITOR],
    )
    await c.query(
      `insert into dokument_seite (dokument_id, seite, text, breite, hoehe, freie_bloecke, textkaesten)
       values ($1, 1, 'Text', $2, $3, $4::jsonb, $5::jsonb)`,
      [
        id,
        mitMassen ? SEITE.breite : null,
        mitMassen ? SEITE.hoehe : null,
        JSON.stringify([FREIER_PLATZ, ZWEITER_PLATZ]),
        mitMassen ? JSON.stringify([TEXTZEILE]) : null,
      ],
    )
    const lauf = await laufStarten(c, id)
    return { beleg: id, laufId: lauf!.laufId }
  }))
}

async function annasAufgabe(): Promise<{ aufgabeId: string; stempeltypId: string }> {
  const zeile = [...(await persoenlichesPostfach(ANNA)), ...(await poolPostfach(ANNA))].find((z) => z.dokumentId === beleg)
  if (zeile === undefined) throw new Error('Keine Aufgabe fuer Anna')
  const geladen = await aufgabeLaden(ANNA, zeile.aufgabeId)
  const frei = geladen?.stempel.find((s) => s.entscheidung === 'freigabe')
  if (frei === undefined) throw new Error('Kein Freigabestempel')
  return { aufgabeId: zeile.aufgabeId, stempeltypId: frei.stempeltypId }
}

async function stempelLayer() {
  return (await layerLaden(ANNA, beleg)).find((l) => l.typ === 'stempel')
}

beforeEach(() => belegAnlegen(true))
afterEach(() => belegEntfernen(beleg))
afterAll(poolSchliessen)

describe('Die Lage aus der Hand des Menschen', () => {
  it('setzt den Abdruck dorthin, wo er platziert wurde', async () => {
    const { aufgabeId, stempeltypId } = await annasAufgabe()
    await stempelSetzen(ANNA, { aufgabeId, stempeltypId, lage: { seite: 1, x: 300, y: 400, breite: 200, hoehe: 70 } })
    const layer = await stempelLayer()
    expect(layer).toMatchObject({ seite: 1, x: 300, y: 400, breite: 200, hoehe: 70 })
  })

  it('nimmt ohne Lage den errechneten Platz -- wie bisher', async () => {
    const { aufgabeId, stempeltypId } = await annasAufgabe()
    await stempelSetzen(ANNA, { aufgabeId, stempeltypId })
    expect(await stempelLayer()).toMatchObject(FREIER_PLATZ)
  })

  it('weist eine Lage ueber Text mit Grund ab, und die Aufgabe bleibt offen', async () => {
    const { aufgabeId, stempeltypId } = await annasAufgabe()
    await expect(
      stempelSetzen(ANNA, { aufgabeId, stempeltypId, lage: { seite: 1, x: TEXTZEILE.x, y: TEXTZEILE.y - 10, breite: 190, hoehe: 64 } }),
    ).rejects.toBeInstanceOf(StempelAbgelehnt)
    expect(await stempelLayer()).toBeUndefined()
    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query<{ status: string }>('select status from aufgabe where id = $1', [aufgabeId]),
    )
    expect(rows[0]?.status).toBe('offen')
  })

  it('weist zu kleine und ueber den Rand ragende Lagen ab', async () => {
    const { aufgabeId, stempeltypId } = await annasAufgabe()
    await expect(
      stempelSetzen(ANNA, { aufgabeId, stempeltypId, lage: { seite: 1, x: 300, y: 400, breite: 60, hoehe: 20 } }),
    ).rejects.toThrow(/mindestens/)
    await expect(
      stempelSetzen(ANNA, { aufgabeId, stempeltypId, lage: { seite: 1, x: 500, y: 400, breite: 190, hoehe: 64 } }),
    ).rejects.toThrow(/Seitenrand/)
  })

  it('haelt die Grenze auch im Trigger -- an der Anwendung vorbei', async () => {
    await expect(
      alsBenutzer(ANNA, (c) =>
        stempeln(c, {
          laufId,
          stufeId: STUFE_SACHLICH,
          benutzerId: ANNA,
          stempeltypId: STEMPEL_SACHLICH,
          entscheidung: 'freigabe',
          lage: { seite: 1, x: TEXTZEILE.x, y: TEXTZEILE.y, breite: 190, hoehe: 64 },
        }),
      ),
    ).rejects.toThrow(/kann dort nicht stehen/)
    // Nichts ist entstanden: kein Ereignis, kein Layer.
    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query<{ n: string }>('select count(*) as n from stempel_ereignis where lauf_id = $1', [laufId]),
    )
    expect(Number(rows[0]!.n)).toBe(0)
  })

  it('traegt die Lage am Ereignis, nicht in der Hash-Kette', async () => {
    const { aufgabeId, stempeltypId } = await annasAufgabe()
    await stempelSetzen(ANNA, { aufgabeId, stempeltypId, lage: { seite: 1, x: 300, y: 400, breite: 200, hoehe: 70 } })
    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query<{ lage: { x: number }; eintrag_hash: string }>(
        `select e.lage, e.eintrag_hash from stempel_ereignis e where e.lauf_id = $1`,
        [laufId],
      ),
    )
    expect(rows[0]?.lage).toMatchObject({ x: 300, y: 400 })
    // Der Hash ist da und wird von der Kette getragen -- die Lage steht daneben, nicht darin.
    expect(rows[0]?.eintrag_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('Was die Seite zum Platzieren hergibt', () => {
  it('liefert Vorschlag, Masse, Textkaesten und die schon gesetzten Stempel', async () => {
    const vorher = await platzierungLaden(ANNA, beleg)
    expect(vorher).toMatchObject({ seite: 1, vorschlag: FREIER_PLATZ, seitenBreite: 595, seitenHoehe: 842, belegt: [] })
    expect(vorher?.textkaesten).toEqual([TEXTZEILE])

    const { aufgabeId, stempeltypId } = await annasAufgabe()
    await stempelSetzen(ANNA, { aufgabeId, stempeltypId, lage: { seite: 1, x: 300, y: 400, breite: 200, hoehe: 70 } })
    const nachher = await platzierungLaden(ANNA, beleg)
    expect(nachher?.belegt).toEqual([{ x: 300, y: 400, breite: 200, hoehe: 70 }])
  })

  it('schlaegt einen Block vor, auf dem nichts liegt -- auch wenn der abgezaehlte belegt ist', async () => {
    // Der erste Stempel wurde von Hand auf den zweiten Block gezogen; das
    // Abzaehlen (dms.stempelplatz) naehme jetzt genau diesen Block.
    const { aufgabeId, stempeltypId } = await annasAufgabe()
    await stempelSetzen(ANNA, { aufgabeId, stempeltypId, lage: { seite: 1, ...ZWEITER_PLATZ } })
    const danach = await platzierungLaden(ANNA, beleg)
    expect(danach?.vorschlag).toEqual(FREIER_PLATZ)
  })

  it('liefert null ohne Seitenmasse -- dann waehlt die Datenbank', async () => {
    await belegEntfernen(beleg)
    await belegAnlegen(false)
    expect(await platzierungLaden(ANNA, beleg)).toBeNull()
  })
})
