/**
 * Tests der Seitenverarbeitung: Text mit Fundstelle, Textlayer-Erkennung,
 * Vorrendern und das Zusammenspiel in der Aufbereitung.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { DateisystemAblage } from '../src/ablage'
import { dokumentAufnehmen, type Eingang } from '../src/ingest/aufnehmen'
import { hatTextlayer, seitenLesen, seiteRendern } from '../src/ingest/pdf'
import { aufbereiten, BREITE_LESEN } from '../src/worker/aufbereitung'
import { istXmlRechnung } from '../src/extraktion/zugferd'
import { pdfBauen, rechnungsvorlage, scanvorlage } from './hilfe/pdf-bauen'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:15322/postgres'

const MANDANT_NORD = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

let client: Client
let wurzel: string
let ablage: DateisystemAblage
let rechnung: Buffer
let scan: Buffer

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
  wurzel = await mkdtemp(join(tmpdir(), 'dms-aufbereitung-'))
  ablage = new DateisystemAblage(wurzel)
  rechnung = await pdfBauen(rechnungsvorlage())
  scan = await pdfBauen(scanvorlage())
})

afterAll(async () => {
  await client.end()
  await rm(wurzel, { recursive: true, force: true })
})

async function alsAnna<T>(aktion: (c: Client) => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    await client.query('set local role dms_app')
    await client.query('select set_config($1, $2, true)', ['app.benutzer_id', ANNA])
    return await aktion(client)
  } finally {
    await client.query('rollback')
  }
}

function eingang(inhalt: Buffer): Eingang {
  return {
    mandantId: MANDANT_NORD,
    objektId: OBJEKT_42,
    belegart: 'rechnung',
    eingangskanal: 'scan',
    dateiname: 'beleg.pdf',
    mime: 'application/pdf',
    inhalt,
  }
}

describe('Seitentext', () => {
  it('liest jede Seite einzeln', async () => {
    const seiten = await seitenLesen(rechnung)
    expect(seiten).toHaveLength(2)
    expect(seiten[0].seite).toBe(1)
    expect(seiten[1].seite).toBe(2)
  })

  it('liefert den Text der Seite', async () => {
    const seiten = await seitenLesen(rechnung)
    expect(seiten[0].text).toContain('RE-2026-0001')
    expect(seiten[1].text).toContain('14 Tagen')
    // Der Text der zweiten Seite darf nicht in die erste geraten.
    expect(seiten[0].text).not.toContain('14 Tagen')
  })

  it('haelt die Seitenmasse fest', async () => {
    const seiten = await seitenLesen(rechnung)
    expect(seiten[0].breite).toBe(595)
    expect(seiten[0].hoehe).toBe(842)
  })

  it('gibt zu jedem Textstueck eine Fundstelle mit Ursprung oben links', async () => {
    const seiten = await seitenLesen(rechnung)
    const erstes = seiten[0].stuecke[0]
    expect(erstes.text).toContain('Musterreinigung')
    expect(erstes.x).toBeCloseTo(60, 0)
    // Gezeichnet auf y = 780 von unten, Schriftgroesse 12, Seite 842 hoch.
    expect(erstes.y).toBeCloseTo(842 - 780 - 12, 0)
    expect(erstes.breite).toBeGreaterThan(0)
  })
})

describe('Textlayer-Erkennung', () => {
  it('erkennt einen Beleg mit Textlayer', async () => {
    expect(hatTextlayer(await seitenLesen(rechnung))).toBe(true)
  })

  it('schickt einen Scan mit fast keinem Text in die OCR-Strecke', async () => {
    expect(hatTextlayer(await seitenLesen(scan))).toBe(false)
  })

  it('haelt ein Dokument ohne Seiten nicht fuer lesbar', () => {
    expect(hatTextlayer([])).toBe(false)
  })
})

describe('Vorrendern', () => {
  it('erzeugt eine WebP-Datei in der gewuenschten Breite', async () => {
    const bild = await seiteRendern(rechnung, 1, 400)
    expect(bild.subarray(0, 4).toString('latin1')).toBe('RIFF')
    expect(bild.subarray(8, 12).toString('latin1')).toBe('WEBP')
    expect(bild.byteLength).toBeGreaterThan(0)
  })

  it('liefert bei groesserer Zielbreite auch mehr Daten', async () => {
    const klein = await seiteRendern(rechnung, 1, 240)
    const gross = await seiteRendern(rechnung, 1, BREITE_LESEN)
    expect(gross.byteLength).toBeGreaterThan(klein.byteLength)
  })
})

describe('Formaterkennung', () => {
  // Ob ein PDF eine strukturierte Rechnung ist, entscheidet nicht mehr eine
  // Suche in den Bytes, sondern das Auslesen der Anhaenge -- siehe den
  // Hinweis in worker/aufbereitung.ts. Hier bleibt die reine XML-Rechnung.
  it('erkennt eine reine XRechnung', () => {
    const xml = Buffer.from(
      '<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece">',
      'utf8',
    )
    expect(istXmlRechnung(xml)).toBe(true)
  })

  it('haelt ein PDF nicht dafuer', () => {
    expect(istXmlRechnung(rechnung)).toBe(false)
  })
})

describe('Aufbereitung', () => {
  it('schreibt Seitentext, Derivate und Seitenzahl', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      const bericht = await aufbereiten(c as never, ablage, auf.dokumentId)

      const { rows: seiten } = await c.query<{ seite: number; text: string }>(
        'select seite, text from dokument_seite where dokument_id = $1 order by seite',
        [auf.dokumentId],
      )
      const { rows: derivate } = await c.query<{ variante: string; seite: number | null }>(
        `select variante, seite from dokument_datei
          where dokument_id = $1 and variante = 'ansicht_webp' order by groesse`,
        [auf.dokumentId],
      )
      const { rows: dokument } = await c.query<{ seitenzahl: number; status: string }>(
        'select seitenzahl, status from dokument where id = $1',
        [auf.dokumentId],
      )
      return { bericht, seiten, derivate, dokument: dokument[0] }
    })

    expect(ergebnis.bericht.seiten).toBe(2)
    expect(ergebnis.bericht.weg).toBe('textlayer')
    expect(ergebnis.seiten).toHaveLength(2)
    expect(ergebnis.seiten[0].text).toContain('RE-2026-0001')
    // Zwei Leseansichten und eine Miniatur.
    expect(ergebnis.derivate).toHaveLength(3)
    expect(ergebnis.dokument.seitenzahl).toBe(2)
    expect(ergebnis.dokument.status).toBe('laufend')
  })

  it('macht den Seitentext volltextdurchsuchbar', async () => {
    const treffer = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      await aufbereiten(c as never, ablage, auf.dokumentId)
      const { rows } = await c.query<{ seite: number }>(
        `select seite from dokument_seite
          where dokument_id = $1 and text_tsv @@ plainto_tsquery('german', 'Hausreinigung')`,
        [auf.dokumentId],
      )
      return rows
    })
    expect(treffer).toEqual([{ seite: 1 }])
  })

  it('meldet bei einem Scan ohne Textlayer, dass OCR noetig ist', async () => {
    const bericht = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(scan), ANNA)
      return aufbereiten(c as never, ablage, auf.dokumentId)
    })
    expect(bericht.weg).toBe('ocr_noetig')
  })

  it('legt die Derivate in der Ablage ab', async () => {
    const bild = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      await aufbereiten(c as never, ablage, auf.dokumentId)
      const { rows } = await c.query<{ storage_key: string }>(
        `select storage_key from dokument_datei
          where dokument_id = $1 and variante = 'ansicht_webp' order by seite limit 1`,
        [auf.dokumentId],
      )
      return ablage.lesen(rows[0].storage_key)
    })
    expect(bild.subarray(8, 12).toString('latin1')).toBe('WEBP')
  })
})
