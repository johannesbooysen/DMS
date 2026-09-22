/**
 * Tests: Stempel-Designer.
 *
 * Drei Zusagen:
 *
 *   * Die Weissliste haelt: unbekannte Felder und Formen werden gemeldet,
 *     verdorbene Werte in der Datenbank durch die Vorgabe ersetzt.
 *   * Der Trigger setzt den Stempeltext aus den gewaehlten Feldern zusammen
 *     -- und ein gesetzter Stempel aendert sich nicht, wenn der Designer
 *     spaeter bedient wird.
 *   * Gestalten darf nur, wer Ablaeufe konfigurieren darf.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { aufgabeLaden, stempelSetzen } from '../src/app/lib/postfach'
import { layerLaden } from '../src/layer'
import {
  beispieltext,
  gestaltungLesen,
  gestaltungPruefen,
  textZusammensetzen,
  VORGABE,
} from '../src/layer/gestaltung'
import { gestaltungSetzen, stempeltypAnlegen, stempeltypenLaden } from '../src/stammdaten/stempel'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'
const EVA = '20000000-0000-0000-0000-000000000005'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const SACHLICH_RICHTIG = '60000000-0000-0000-0000-000000000001'

const belege: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

async function belegAnlegen(): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, ORDNUNGSGRUPPE_BK],
    )
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-DESIGN', current_date, 1000, 190, 1190)`,
      [rows[0].id, KREDITOR],
    )
    await laufStarten(c, rows[0].id)
    return rows[0].id
  })
  belege.push(id)
  return id
}

/** Anna stempelt die sachliche Pruefung des Belegs. */
async function sachlichStempeln(beleg: string): Promise<void> {
  const { rows } = await alsEigentuemer((c) =>
    c.query<{ id: string }>(
      `select a.id from aufgabe a join dokument_lauf l on l.id = a.lauf_id
        where l.dokument_id = $1 and a.status = 'offen' limit 1`,
      [beleg],
    ),
  )
  const geladen = await aufgabeLaden(ANNA, rows[0]!.id)
  await stempelSetzen(ANNA, { aufgabeId: rows[0]!.id, stempeltypId: SACHLICH_RICHTIG })
  void geladen
}

async function stempeltext(beleg: string): Promise<string> {
  const layer = (await layerLaden(ANNA, beleg)).find((l) => l.typ === 'stempel')
  if (layer === undefined) throw new Error('Kein Stempel-Layer')
  return layer.text ?? ''
}

beforeEach(() => {
  belege.length = 0
})

afterEach(async () => {
  for (const b of belege) await belegEntfernen(b)
  await alsEigentuemer(async (c) => {
    await c.query(`update stempeltyp set gestaltung = '{}'::jsonb`)
    await c.query(`delete from stempeltyp where kurzcode = 'TESTDESIGN'`)
  })
})

afterAll(poolSchliessen)

describe('Weissliste', () => {
  it('meldet Unbekanntes beim Einstellen', () => {
    expect(gestaltungPruefen({ felder: ['text', 'iban'], form: 'rechteck', rahmen: 'durchgezogen', drehung: 0, schrift: 'normal' }))
      .toEqual({ fehler: 'Unbekanntes Feld: iban.' })
    expect(gestaltungPruefen({ felder: ['text'], form: 'stern', rahmen: 'durchgezogen', drehung: 0, schrift: 'normal' }))
      .toHaveProperty('fehler')
    expect(gestaltungPruefen({ felder: ['text'], form: 'rechteck', rahmen: 'durchgezogen', drehung: 45, schrift: 'normal' }))
      .toHaveProperty('fehler')
  })

  it('setzt den Stempeltext immer zuerst und ordnet die Felder', () => {
    const g = gestaltungPruefen({ felder: ['uhrzeit', 'mitarbeiter'], form: 'oval', rahmen: 'doppelt', drehung: 5, schrift: 'gross' })
    expect('gestaltung' in g && g.gestaltung.felder).toEqual(['text', 'mitarbeiter', 'uhrzeit'])
  })

  it('ersetzt Verdorbenes aus der Datenbank durch die Vorgabe', () => {
    expect(gestaltungLesen(null)).toEqual(VORGABE)
    expect(gestaltungLesen({ felder: ['iban'], form: 'stern', drehung: 'x' })).toEqual(VORGABE)
    expect(gestaltungLesen({ felder: ['stufe'], drehung: 40 }).drehung).toBe(15)
  })

  it('rueckt Datum und Uhrzeit zusammen', () => {
    expect(
      textZusammensetzen(['text', 'datum', 'uhrzeit', 'mitarbeiter'], {
        text: 'Sachlich richtig', datum: '22.09.2026', uhrzeit: '09:10', mitarbeiter: 'Anna Ahrens',
        kommentar: null, objekt: null, betrag: null, stufe: null,
      }),
    ).toBe('Sachlich richtig · 22.09.2026 09:10 · Anna Ahrens')
    expect(beispieltext('Freigabe', VORGABE)).toBe('Freigabe · Anna Ahrens · 22.09.2026 09:10')
  })
})

describe('Der Trigger', () => {
  it('setzt den Text aus den gewaehlten Feldern zusammen', async () => {
    await alsBenutzer(EVA, () =>
      gestaltungSetzen(EVA, {
        id: SACHLICH_RICHTIG, felder: 'text,stufe,objekt,betrag,datum', form: 'rechteck',
        rahmen: 'durchgezogen', drehung: '0', schrift: 'normal', farbe: '#3B4A80', sichtbar: 'ja',
      }),
    )
    const beleg = await belegAnlegen()
    await sachlichStempeln(beleg)
    const text = await stempeltext(beleg)
    // In der Reihenfolge der Weissliste, nicht der Eingabe: Text zuerst,
    // dann Datum, Objekt, Betrag, Stufe.
    expect(text).toMatch(/^Sachlich richtig · \d{2}\.\d{2}\.\d{4} · Objekt 42 · 1\.190,00 EUR · Sachliche Pruefung$/)
  })

  it('nimmt ohne Einstellung die Vorgabe: Text, Mitarbeiter, Datum mit Uhrzeit', async () => {
    const beleg = await belegAnlegen()
    await sachlichStempeln(beleg)
    expect(await stempeltext(beleg)).toMatch(/^Sachlich richtig · Anna Ahrens · \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/)
  })

  it('aendert einen gesetzten Stempel nicht, wenn der Designer spaeter bedient wird', async () => {
    const beleg = await belegAnlegen()
    await sachlichStempeln(beleg)
    const vorher = await stempeltext(beleg)
    await gestaltungSetzen(EVA, {
      id: SACHLICH_RICHTIG, felder: 'text', form: 'oval', rahmen: 'gestrichelt',
      drehung: '0', schrift: 'klein', farbe: '#B3271E', sichtbar: 'ja',
    })
    expect(await stempeltext(beleg)).toBe(vorher)
  })
})

describe('Recht', () => {
  it('laesst nur gestalten, wer Ablaeufe konfigurieren darf', async () => {
    const eingabe = {
      id: SACHLICH_RICHTIG, felder: 'text', form: 'rechteck', rahmen: 'durchgezogen',
      drehung: '0', schrift: 'normal', farbe: '#3B4A80', sichtbar: 'ja',
    }
    await expect(gestaltungSetzen(BERND, eingabe)).rejects.toThrow(/nicht.*änderbar|Recht/)
    await expect(gestaltungSetzen(DORIS, eingabe)).rejects.toThrow(/nicht.*änderbar|Recht/)
    await gestaltungSetzen(EVA, eingabe)
  })

  it('legt einen Stempeltyp nur mit dem Recht an -- und nie mit Zielfeld', async () => {
    const eingabe = { name: 'Testdesign', kurzcode: 'TESTDESIGN', entscheidung: 'freigabe', farbe: '#2F6F4E' }
    await expect(stempeltypAnlegen(BERND, eingabe)).rejects.toThrow(/Recht/)
    await stempeltypAnlegen(EVA, eingabe)
    const typ = (await stempeltypenLaden(EVA)).find((t) => t.kurzcode === 'TESTDESIGN')
    expect(typ?.entscheidung).toBe('freigabe')
    expect(typ?.stufen).toBe(0)
    expect(typ?.gestaltung).toEqual(VORGABE)
  })

  it('weist eine Farbe ab, die keine ist', async () => {
    await expect(
      stempeltypAnlegen(EVA, { name: 'X', kurzcode: 'TESTDESIGN', entscheidung: 'freigabe', farbe: 'rot' }),
    ).rejects.toThrow(/#rrggbb/)
  })
})
