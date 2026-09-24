/**
 * Barcodes auf einer Seite lesen -- fuer Trennblaetter, die nur einen
 * Barcode tragen und keine Klarschrift (Konzept 24.1: "Barcode-Trennblatt").
 *
 * Gelesen wird das **gerenderte Seitenbild**, nicht das PDF: Ein Barcode ist
 * ein Bild, und im PDF steht er als Grafik oder als Scan, nie als Text. Der
 * Leser (zxing-wasm) nimmt eine kodierte Bilddatei entgegen -- WebP versteht
 * er nicht, deshalb der Umweg ueber die Leinwand nach PNG. Ein Umweg nur fuer
 * Kandidaten: Seiten, die fast leer sind. Eine volle Rechnungsseite wird
 * nicht abgesucht, sie ist ohnehin kein Trennblatt.
 *
 * **Welcher Barcode zaehlt:** jeder, solange die Seite fast leer ist -- oder
 * nur der, dessen Inhalt zu `DMS_TRENNBARCODE` passt, wenn das Haus seine
 * Blaetter mit einem festen Text druckt. Ohne die Einstellung waere ein
 * Beleg, der nur aus einer Barcode-Etikettenseite besteht, ein Trennblatt;
 * mit ihr nicht. Die Korrekturoberflaeche bleibt in jedem Fall der Ort, an
 * dem ein Mensch das letzte Wort hat.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readBarcodes } from 'zxing-wasm/reader'

/** Alle Barcodetexte auf einem Seitenbild (WebP oder PNG). Leer, wenn keiner lesbar ist. */
export async function barcodesLesen(bild: Buffer): Promise<string[]> {
  // `loadImage`, nicht `Image.src`: Letzteres dekodiert asynchron, und ein
  // `drawImage` direkt danach zeichnet eine leere Flaeche -- gemessen: null
  // dunkle Pixel, kein Barcode. Beim Bauen so hereingefallen.
  const quelle = await loadImage(bild)
  if (quelle.width === 0 || quelle.height === 0) return []

  const leinwand = createCanvas(quelle.width, quelle.height)
  const kontext = leinwand.getContext('2d')
  kontext.fillStyle = '#ffffff'
  kontext.fillRect(0, 0, leinwand.width, leinwand.height)
  kontext.drawImage(quelle, 0, 0)
  const png = await leinwand.encode('png')
  const puffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer

  const treffer = await readBarcodes(puffer, { tryHarder: true })
  return treffer.filter((t) => t.text.trim() !== '').map((t) => t.text.trim())
}

/**
 * Gilt dieser Barcode als Trennmarke?
 *
 * Ohne `DMS_TRENNBARCODE`: ja. Mit: nur, wenn der Text zum Muster passt
 * (regulaerer Ausdruck, Gross-/Kleinschreibung egal).
 */
export function istTrennbarcode(text: string, muster = process.env['DMS_TRENNBARCODE']): boolean {
  if (muster === undefined || muster.trim() === '') return true
  try {
    return new RegExp(muster, 'i').test(text)
  } catch {
    // Ein kaputtes Muster sperrt nicht alles -- es faellt auf "jeder Barcode"
    // zurueck; die Korrekturansicht zeigt ohnehin, was erkannt wurde.
    return true
  }
}
