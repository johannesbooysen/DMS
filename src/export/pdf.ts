/**
 * Layer in ein PDF einbrennen.
 *
 * Zwei Wege, und welcher gilt, entscheidet `brauchtSeitenbilder`:
 *
 *   * **Aus dem Original.** Die Layer werden auf die vorhandenen Seiten
 *     gezeichnet. Der Text bleibt erhalten, das Ergebnis ist durchsuchbar.
 *     Gilt, solange keine Schwärzung im Spiel ist.
 *   * **Aus den Seitenbildern.** Jede Seite wird als Bild eingebettet, die
 *     Layer darüber gezeichnet. Kein Textlayer, also echte Schwärzung — und
 *     keine Durchsuchbarkeit.
 *
 * Beides schreibt **nie** in das Original: `pdf-lib` lädt eine Kopie im
 * Speicher, die Datei in der Ablage bleibt unberührt (Konzept 16).
 *
 * Koordinaten: Die Layer rechnen mit Ursprung **oben links**, PDF mit
 * Ursprung **unten links**. Die Umrechnung steht an einer Stelle — jede
 * zweite wäre eine, die irgendwann abweicht.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  degrees,
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'

export interface Exportlayer {
  typ: string
  seite: number
  x: number
  y: number
  breite: number
  hoehe: number
  text: string | null
}

export interface Seitenbild {
  seite: number
  /** WebP aus der Ablage. */
  bild: Buffer
  breite: number
  hoehe: number
}

export interface Wasserzeichen {
  empfaenger: string
  datum: string
}

/** Wie schräg das Wasserzeichen liegt. Flach genug zum Lesen, schräg genug zum Stören. */
const NEIGUNG_GRAD = -20

/**
 * Zeichnet die Layer auf das Original.
 *
 * Für Belege ohne Schwärzung. Der Text des Belegs bleibt erhalten.
 */
export async function aufOriginal(
  original: Buffer,
  layer: Exportlayer[],
  wasserzeichen: Wasserzeichen | null,
): Promise<Buffer> {
  const doc = await PDFDocument.load(original)
  const schrift = await doc.embedFont(StandardFonts.Helvetica)

  for (const l of layer.filter((x) => x.seite >= 1)) {
    const seite = doc.getPage(l.seite - 1)
    if (seite === undefined) continue
    layerZeichnen(seite, schrift, l)
  }

  await leerseiteAnhaengen(doc, schrift, layer)
  if (wasserzeichen !== null) wasserzeichenZeichnen(doc, schrift, wasserzeichen)

  return Buffer.from(await doc.save())
}

/**
 * Baut ein PDF aus den Seitenbildern und brennt die Layer ein.
 *
 * Für Belege mit Schwärzung. Ein Bild hat keinen Textlayer — was übermalt
 * ist, ist weg.
 */
export async function ausSeitenbildern(
  seiten: Seitenbild[],
  layer: Exportlayer[],
  wasserzeichen: Wasserzeichen | null,
): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const schrift = await doc.embedFont(StandardFonts.Helvetica)

  for (const s of [...seiten].sort((a, b) => a.seite - b.seite)) {
    // pdf-lib bettet PNG und JPEG ein, kein WebP. Der Umweg ueber die
    // Leinwand kostet wenig und spart eine zweite Bildbibliothek.
    const png = await alsPng(s.bild)
    const eingebettet = await doc.embedPng(png)

    const seite = doc.addPage([s.breite, s.hoehe])
    seite.drawImage(eingebettet, { x: 0, y: 0, width: s.breite, height: s.hoehe })

    for (const l of layer.filter((x) => x.seite === s.seite)) {
      layerZeichnen(seite, schrift, l)
    }
  }

  await leerseiteAnhaengen(doc, schrift, layer)
  if (wasserzeichen !== null) wasserzeichenZeichnen(doc, schrift, wasserzeichen)

  return Buffer.from(await doc.save())
}

async function alsPng(webp: Buffer): Promise<Buffer> {
  const geladen = await loadImage(webp)
  const leinwand = createCanvas(geladen.width, geladen.height)
  leinwand.getContext('2d').drawImage(geladen, 0, 0)
  return leinwand.toBuffer('image/png')
}

/**
 * Ein Layer auf einer Seite.
 *
 * Die y-Umrechnung steckt hier und nirgends sonst: Layer rechnen von oben,
 * PDF von unten.
 */
function layerZeichnen(seite: PDFPage, schrift: PDFFont, l: Exportlayer): void {
  const { height } = seite.getSize()
  const y = height - l.y - l.hoehe

  if (l.typ === 'schwaerzung') {
    // Deckend, nicht halbdurchsichtig. Eine Schwaerzung, durch die man etwas
    // ahnen kann, ist keine.
    seite.drawRectangle({
      x: l.x,
      y,
      width: l.breite,
      height: l.hoehe,
      color: rgb(0, 0, 0),
    })
    return
  }

  if (l.typ === 'highlight') {
    seite.drawRectangle({
      x: l.x,
      y,
      width: l.breite,
      height: l.hoehe,
      color: rgb(1, 0.84, 0.32),
      opacity: 0.38,
    })
    return
  }

  // Stempel und Notiz: Rahmen mit Text.
  const farbe = l.typ === 'stempel' ? rgb(0.23, 0.29, 0.5) : rgb(0.42, 0.42, 0.42)
  seite.drawRectangle({
    x: l.x,
    y,
    width: l.breite,
    height: l.hoehe,
    color: rgb(1, 1, 1),
    opacity: 0.86,
    borderColor: farbe,
    borderWidth: 1.2,
  })

  textInKasten(seite, schrift, l.text ?? '', {
    x: l.x + 4,
    y: y + l.hoehe - 4,
    breite: l.breite - 8,
    hoehe: l.hoehe - 8,
    farbe,
  })
}

function textInKasten(
  seite: PDFPage,
  schrift: PDFFont,
  text: string,
  kasten: { x: number; y: number; breite: number; hoehe: number; farbe: ReturnType<typeof rgb> },
): void {
  const groesse = 8
  const zeilenhoehe = groesse * 1.25
  let y = kasten.y - groesse

  for (const zeile of umbrechen(schrift, text, groesse, kasten.breite)) {
    // Was nicht mehr passt, faellt weg statt herauszuragen.
    if (y < kasten.y - kasten.hoehe) break
    seite.drawText(zeile, { x: kasten.x, y, size: groesse, font: schrift, color: kasten.farbe })
    y -= zeilenhoehe
  }
}

function umbrechen(
  schrift: PDFFont,
  text: string,
  groesse: number,
  breite: number,
): string[] {
  const zeilen: string[] = []
  let laufend = ''

  for (const wort of saeubern(text).split(' ').filter((w) => w !== '')) {
    const versuch = laufend === '' ? wort : `${laufend} ${wort}`
    if (schrift.widthOfTextAtSize(versuch, groesse) <= breite) {
      laufend = versuch
    } else {
      if (laufend !== '') zeilen.push(laufend)
      laufend = wort
    }
  }
  if (laufend !== '') zeilen.push(laufend)
  return zeilen
}

/**
 * Zeichen, die die Standardschrift nicht kennt, ersetzen.
 *
 * `WinAnsi` kann kein „·" und kein „—". Ohne diese Zeile wirft `pdf-lib`
 * beim Zeichnen — und zwar erst dann, wenn ein Stempeltext zufällig eines
 * davon enthält. Genau das tut er: „Sachlich richtig · Anna Ahrens".
 */
function saeubern(text: string): string {
  return text
    .replace(/[·•]/g, '-')
    .replace(/[—–]/g, '-')
    .replace(/[„“”]/g, '"')
    .replace(/[‚‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Stempel ohne Platz auf der Seite bekommen eine Leerseite.
 *
 * `seite = 0` heißt genau das (Konzept 16). Ohne diese Seite wären sie im
 * Export unsichtbar — der Beleg zeigte dann weniger, als das Protokoll sagt.
 */
async function leerseiteAnhaengen(
  doc: PDFDocument,
  schrift: PDFFont,
  layer: Exportlayer[],
): Promise<void> {
  const ohnePlatz = layer.filter((l) => l.seite === 0)
  if (ohnePlatz.length === 0) return

  // Maße der letzten Seite übernehmen, sonst wirkt die Anlage wie ein
  // fremdes Blatt.
  const seiten = doc.getPages()
  const letzte = seiten.at(-1)
  const seite = doc.addPage(letzte === undefined ? [595, 842] : [letzte.getWidth(), letzte.getHeight()])

  const { height, width } = seite.getSize()
  seite.drawText('Stempel ohne Platz auf dem Beleg', {
    x: 48,
    y: height - 60,
    size: 11,
    font: schrift,
    color: rgb(0.23, 0.29, 0.5),
  })

  let y = height - 96
  for (const l of ohnePlatz) {
    layerZeichnen(seite, schrift, {
      ...l,
      seite: 1,
      x: 48,
      y: height - y,
      breite: Math.min(l.breite, width - 96),
      hoehe: l.hoehe,
    })
    y -= l.hoehe + 12
  }
}

/**
 * Gekacheltes Wasserzeichen über alle Seiten.
 *
 * Es verhindert nichts. Es macht eine weitergereichte Kopie **zuordenbar** —
 * Name des Empfängers und Datum stehen darauf, und das ändert die Rechnung
 * für den, der sie weitergibt.
 */
function wasserzeichenZeichnen(
  doc: PDFDocument,
  schrift: PDFFont,
  text: Wasserzeichen,
): void {
  const zeile = saeubern(`${text.empfaenger} - ${text.datum}`)

  for (const seite of doc.getPages()) {
    const { width, height } = seite.getSize()
    const groesse = Math.max(10, Math.round(width / 34))
    const breite = schrift.widthOfTextAtSize(zeile, groesse)
    const abstandX = breite + groesse * 3
    const abstandY = groesse * 5

    // Ueber den Rand hinaus, sonst bleiben durch die Drehung Ecken frei.
    for (let y = -height; y < height * 2; y += abstandY) {
      for (let x = -width; x < width * 2; x += abstandX) {
        seite.drawText(zeile, {
          x,
          y,
          size: groesse,
          font: schrift,
          // Sehr blass: Der Beleg muss lesbar bleiben. Ein Wasserzeichen,
          // das die Zahlen verdeckt, macht den Export wertlos.
          color: rgb(0, 0, 0),
          opacity: 0.13,
          rotate: degrees(NEIGUNG_GRAD),
        })
      }
    }
  }
}
