/**
 * Tests: Stempel verschieben.
 *
 * Die Herkunft bleibt das Ereignis, die Lage wird frei -- unter Bedingungen,
 * die der Trigger selbst nachprueft (Migration 20260922120000, ADR 0008):
 *
 *   * nur, wer den Stempel gesetzt hat,
 *   * nur bis zur naechsten Stufe,
 *   * nie ueber Text, nie ueber den Rand, nie zu klein,
 *   * jede Verschiebung hinterlaesst eine Spur.
 *
 * Geprueft wird ueber die Fachschicht, wo es sie gibt, und direkt gegen die
 * Tabelle, wo es um den Riegel selbst geht.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { LayerAbgelehnt, layerLaden, stempelVerschieben, verschiebbareStempel } from '../src/layer'
import {
  aufgabeLaden,
  persoenlichesPostfach,
  poolPostfach,
  stempelSetzen,
} from '../src/app/lib/postfach'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'

/** Eine A4-Seite: ein freier Stempelplatz rechts oben, eine Textzeile weiter unten. */
const SEITE = { breite: 595, hoehe: 842 }
const FREIER_PLATZ = { x: 380, y: 40, breite: 190, hoehe: 64 }
const TEXTZEILE = { x: 40, y: 100, breite: 300, hoehe: 12 }

let beleg = ''
let layerId = ''

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

/** Stempelt die offene Aufgabe des Testbelegs als `wer` mit dessen Freigabestempel. */
async function freigeben(wer: string): Promise<void> {
  // Persoenlich oder Pool: Die rechnerische Pruefung haengt an einer Rolle
  // und liegt bei Bernd im Pool, nicht im persoenlichen Postfach.
  const zeile = [...(await persoenlichesPostfach(wer)), ...(await poolPostfach(wer))].find(
    (z) => z.dokumentId === beleg,
  )
  if (zeile === undefined) throw new Error(`Keine Aufgabe fuer ${wer}`)
  const geladen = await aufgabeLaden(wer, zeile.aufgabeId)
  const frei = geladen?.stempel.find((s) => s.entscheidung === 'freigabe')
  if (frei === undefined) throw new Error('Kein Freigabestempel')
  await stempelSetzen(wer, { aufgabeId: zeile.aufgabeId, stempeltypId: frei.stempeltypId })
}

beforeEach(async () => {
  beleg = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen', 2)
       returning id`,
      [MANDANT, OBJEKT_42, ORDNUNGSGRUPPE_BK],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-VERSCHIEBEN', current_date, 1000, 190, 1190)`,
      [id, KREDITOR],
    )
    for (const seite of [1, 2]) {
      await c.query(
        `insert into dokument_seite (dokument_id, seite, text, breite, hoehe, freie_bloecke, textkaesten)
         values ($1, $2, 'Text', $3, $4, $5::jsonb, $6::jsonb)`,
        [
          id,
          seite,
          SEITE.breite,
          SEITE.hoehe,
          seite === 1 ? JSON.stringify([FREIER_PLATZ]) : null,
          JSON.stringify(seite === 1 ? [TEXTZEILE] : []),
        ],
      )
    }
    await laufStarten(c, id)
    return id
  })
  await freigeben(ANNA)
  const layer = await layerLaden(ANNA, beleg)
  const stempel = layer.find((l) => l.typ === 'stempel')
  if (stempel === undefined) throw new Error('Kein Stempel-Layer entstanden')
  layerId = stempel.id
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

describe('Wer und bis wann', () => {
  it('laesst den Setzer verschieben und schreibt es ins Protokoll', async () => {
    await stempelVerschieben(ANNA, { layerId, seite: 1, x: 300, y: 400, breite: 190, hoehe: 64 })

    const layer = (await layerLaden(ANNA, beleg)).find((l) => l.id === layerId)
    expect(layer?.x).toBe(300)
    expect(layer?.y).toBe(400)

    const protokoll = await alsEigentuemer(async (c) => {
      const { rows } = await c.query<{ benutzer_id: string; von: { x: number }; nach: { x: number } }>(
        'select benutzer_id, von, nach from layer_position_ereignis where layer_id = $1',
        [layerId],
      )
      return rows
    })
    expect(protokoll).toHaveLength(1)
    expect(protokoll[0]?.benutzer_id).toBe(ANNA)
    expect(Number(protokoll[0]?.von.x)).toBe(FREIER_PLATZ.x)
    expect(Number(protokoll[0]?.nach.x)).toBe(300)
  })

  it('weist jeden anderen ab -- auch einen, der den Beleg bearbeiten darf', async () => {
    await expect(
      stempelVerschieben(BERND, { layerId, seite: 1, x: 300, y: 400, breite: 190, hoehe: 64 }),
    ).rejects.toThrow(/wer den Stempel gesetzt hat/)
    expect((await verschiebbareStempel(BERND, beleg)).has(layerId)).toBe(false)
    expect((await verschiebbareStempel(ANNA, beleg)).has(layerId)).toBe(true)
  })

  it('liegt fest, sobald die naechste Stufe gestempelt ist', async () => {
    await freigeben(BERND) // Rechnerische Pruefung
    await expect(
      stempelVerschieben(ANNA, { layerId, seite: 1, x: 300, y: 400, breite: 190, hoehe: 64 }),
    ).rejects.toThrow(/naechste Stufe/)
    expect((await verschiebbareStempel(ANNA, beleg)).has(layerId)).toBe(false)
  })

  it('ist fuer einen fremden Mandanten nicht da', async () => {
    await expect(
      stempelVerschieben(DORIS, { layerId, seite: 1, x: 300, y: 400, breite: 190, hoehe: 64 }),
    ).rejects.toThrow(/nicht gefunden/)
  })
})

describe('Wohin', () => {
  it('nie ueber Text', async () => {
    await expect(
      stempelVerschieben(ANNA, { layerId, seite: 1, x: 40, y: 95, breite: 190, hoehe: 64 }),
    ).rejects.toThrow(/Text/)
  })

  it('nie ueber den Rand', async () => {
    await expect(
      stempelVerschieben(ANNA, { layerId, seite: 1, x: 500, y: 400, breite: 190, hoehe: 64 }),
    ).rejects.toThrow(/Seitenrand/)
  })

  it('nie kleiner als lesbar', async () => {
    await expect(
      stempelVerschieben(ANNA, { layerId, seite: 1, x: 300, y: 400, breite: 60, hoehe: 20 }),
    ).rejects.toThrow(/mindestens/)
  })

  it('darf groesser werden', async () => {
    await stempelVerschieben(ANNA, { layerId, seite: 1, x: 200, y: 400, breite: 300, hoehe: 120 })
    const layer = (await layerLaden(ANNA, beleg)).find((l) => l.id === layerId)
    expect(layer?.breite).toBe(300)
  })

  it('darf auf eine andere Seite -- und auf die Leerseite', async () => {
    await stempelVerschieben(ANNA, { layerId, seite: 2, x: 100, y: 100, breite: 190, hoehe: 64 })
    expect((await layerLaden(ANNA, beleg)).find((l) => l.id === layerId)?.seite).toBe(2)

    await stempelVerschieben(ANNA, { layerId, seite: 0, x: 40, y: 40, breite: 190, hoehe: 64 })
    expect((await layerLaden(ANNA, beleg)).find((l) => l.id === layerId)?.seite).toBe(0)
  })

  it('nicht auf eine Seite, die es nicht gibt', async () => {
    await expect(
      stempelVerschieben(ANNA, { layerId, seite: 3, x: 100, y: 100, breite: 190, hoehe: 64 }),
    ).rejects.toThrow(/gibt es nicht/)
  })

  it('nicht auf eine Seite ohne Textkaesten', async () => {
    await alsEigentuemer((c) =>
      c.query('update dokument_seite set textkaesten = null where dokument_id = $1 and seite = 2', [beleg]),
    )
    await expect(
      stempelVerschieben(ANNA, { layerId, seite: 2, x: 100, y: 100, breite: 190, hoehe: 64 }),
    ).rejects.toThrow(/erneuten Aufbereitung/)
  })
})

describe('Der Riegel selbst', () => {
  it('haelt jede andere Aenderung weiterhin ab', async () => {
    await expect(
      alsBenutzer(ANNA, (c) =>
        c.query(`update dokument_layer set inhalt_text = 'anders' where id = $1`, [layerId]),
      ),
    ).rejects.toThrow(/nicht geaendert/)
  })

  it('prueft auch ein direktes Update der Lage', async () => {
    // Nicht nur ueber die Funktion: Wer die Tabelle direkt anfasst, laeuft
    // in dieselbe Pruefung -- die Grenze ist der Trigger, nicht der Aufrufer.
    await expect(
      alsBenutzer(ANNA, (c) =>
        c.query(`update dokument_layer set x = 40, y = 95 where id = $1`, [layerId]),
      ),
    ).rejects.toThrow(/Text/)
  })

  it('schreibt Datum mit Uhrzeit auf den Stempel', async () => {
    const layer = (await layerLaden(ANNA, beleg)).find((l) => l.id === layerId)
    expect(layer?.text).toMatch(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/)
    expect(layer?.text).toContain('Anna Ahrens')
  })
})

it('LayerAbgelehnt traegt den Grund der Datenbank', async () => {
  try {
    await stempelVerschieben(BERND, { layerId, seite: 1, x: 300, y: 400, breite: 190, hoehe: 64 })
    expect.unreachable()
  } catch (fehler) {
    expect(fehler).toBeInstanceOf(LayerAbgelehnt)
  }
})
