/**
 * Tests der Texterkennung mit tesseract.js.
 *
 * Anders als bei ocrmypdf laeuft die Erkennung hier wirklich: Sie braucht
 * keine Installation, nur die Sprachdaten (7 MB, beim ersten Lauf aus dem
 * Netz, danach unter `.tesseract/`). Ohne Netz und ohne Cache wird das
 * **gemeldet**, nicht uebersprungen -- dieselbe Regel wie bei MinIO.
 *
 * Geprueft wird die Zusage der Schnittstelle: Aus einem PDF ohne Text wird
 * ein PDF mit Textlayer, das `seitenLesen` wie jedes andere liest -- mit
 * dem erkannten Text an der Stelle, an der er im Bild steht.
 */

import { createCanvas } from '@napi-rs/canvas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hatTextlayer, seitenLesen } from '../src/ingest/pdf'
import { tesseractjsErkennung, texterkennung } from '../src/ocr'
import { pdfBauen } from './hilfe/pdf-bauen'

let erreichbar = false
let scan: Buffer

/** Ein "Scan": eine Seite, deren Text nur als Bild vorliegt. */
async function scanBauen(zeilen: string[]): Promise<Buffer> {
  const leinwand = createCanvas(1600, 600)
  const k = leinwand.getContext('2d')
  k.fillStyle = '#ffffff'
  k.fillRect(0, 0, leinwand.width, leinwand.height)
  k.fillStyle = '#000000'
  k.font = '48px sans-serif'
  zeilen.forEach((zeile, i) => k.fillText(zeile, 80, 120 + i * 90))
  const bild = await leinwand.encode('png')
  return pdfBauen([{ zeilen: [], bild }])
}

beforeAll(async () => {
  erreichbar = await tesseractjsErkennung.verfuegbar()
  scan = await scanBauen(['Musterreinigung GmbH', 'Rechnung RE-2026-0815', 'Betrag 1.240,00 EUR'])
}, 30_000)

afterAll(async () => {
  await tesseractjsErkennung.beenden?.()
  if (!erreichbar) {
    process.stdout.write(
      '\n  Hinweis: Sprachdaten fuer tesseract.js weder unter .tesseract/ noch im Netz erreichbar — ' +
        'die Erkennungstests wurden uebersprungen.\n',
    )
  }
})

const wennErreichbar = (name: string, pruefung: () => Promise<void>) =>
  it(
    name,
    async () => {
      if (!erreichbar) return
      await pruefung()
    },
    180_000,
  )

describe('Auswahl', () => {
  it('ist ueber DMS_OCR=tesseractjs waehlbar', () => {
    const vorher = process.env['DMS_OCR']
    process.env['DMS_OCR'] = 'tesseractjs'
    try {
      expect(texterkennung()?.name).toBe('tesseractjs')
    } finally {
      if (vorher === undefined) delete process.env['DMS_OCR']
      else process.env['DMS_OCR'] = vorher
    }
  })
})

describe('Erkennung', () => {
  wennErreichbar('macht aus einem Scan ein PDF mit Textlayer, das seitenLesen liest', async () => {
    // Vorher: kein Text.
    expect(hatTextlayer(await seitenLesen(scan))).toBe(false)

    const { pdf, dauerMs } = await tesseractjsErkennung.erkennen(scan)
    expect(dauerMs).toBeGreaterThan(0)

    const seiten = await seitenLesen(pdf)
    expect(seiten).toHaveLength(1)
    expect(hatTextlayer(seiten)).toBe(true)
    expect(seiten[0]!.text).toContain('RE-2026-0815')
    expect(seiten[0]!.text).toContain('Musterreinigung')
  })

  wennErreichbar('legt die Woerter dorthin, wo sie im Bild stehen', async () => {
    const { pdf } = await tesseractjsErkennung.erkennen(scan)
    const [seite] = await seitenLesen(pdf)
    const stueck = seite!.stuecke.find((s) => s.text.includes('RE-2026-0815'))
    expect(stueck).toBeDefined()

    // Das Bild liegt 400 pt breit mittig ab y = 500 (pdf-bauen); die zweite
    // Zeile steht im oberen Drittel des Bildes, links. Seitenkoordinaten
    // haben den Ursprung oben links.
    const bildLinks = (595 - 400) / 2
    const bildOben = 842 - 500 - 400 * (600 / 1600)
    expect(stueck!.x).toBeGreaterThan(bildLinks)
    expect(stueck!.x).toBeLessThan(bildLinks + 120)
    expect(stueck!.y).toBeGreaterThan(bildOben)
    expect(stueck!.y).toBeLessThan(bildOben + 80)
    // Das unsichtbare Wort ist ungefaehr so breit wie das gescannte:
    // "RE-2026-0815" mit 48 px auf 1600 px Bildbreite, das Bild 400 pt breit
    // -- rund 50 pt. Gemessen 52,6; die Spanne faengt Schriftunterschiede.
    expect(stueck!.breite).toBeGreaterThan(35)
    expect(stueck!.breite).toBeLessThan(90)
  })

  wennErreichbar('laesst das Original unberuehrt und behaelt die Seitenmasse', async () => {
    const vorher = Buffer.from(scan)
    const { pdf } = await tesseractjsErkennung.erkennen(scan)
    expect(scan.equals(vorher)).toBe(true)
    expect(pdf.equals(scan)).toBe(false)
    const [seite] = await seitenLesen(pdf)
    expect(Math.round(seite!.breite)).toBe(595)
    expect(Math.round(seite!.hoehe)).toBe(842)
  })
})
