/**
 * Wasserzeichen für die externe Ansicht.
 *
 * Konzept 17 nennt es als Eigenschaft der Gewährung. Was es leistet und was
 * nicht, gehört dazugesagt:
 *
 *   * Es verhindert **nichts**. Wer die Seite abfotografiert, hat sie.
 *   * Es macht eine weitergereichte Aufnahme **zuordenbar** — Name des
 *     Empfängers und Datum stehen darauf. Das ändert die Rechnung für den,
 *     der sie weitergibt.
 *
 * Gezeichnet wird auf das vorgerenderte WebP, nicht ins PDF: Das Original
 * bleibt bitgenau (Konzept 16, „alles liegt neben dem PDF, nichts darin").
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'

/** Wie schräg die Zeilen liegen. Flach genug zum Lesen, schräg genug zum Stören. */
const NEIGUNG = -Math.PI / 9

export interface Wasserzeichentext {
  empfaenger: string
  datum: string
}

/**
 * Legt ein gekacheltes Wasserzeichen über ein Bild.
 *
 * Gekachelt und nicht einmal in der Mitte: Ein einzelner Schriftzug lässt
 * sich wegschneiden, ein Raster über die ganze Fläche nicht — ohne den Beleg
 * mit zu beschneiden.
 */
export async function wasserzeichenAuftragen(
  bild: Buffer,
  text: Wasserzeichentext,
): Promise<Buffer> {
  const geladen = await loadImage(bild)
  const leinwand = createCanvas(geladen.width, geladen.height)
  const stift = leinwand.getContext('2d')

  stift.drawImage(geladen, 0, 0)

  const zeile = `${text.empfaenger} · ${text.datum}`
  const groesse = Math.max(14, Math.round(geladen.width / 34))
  stift.font = `${groesse}px sans-serif`
  // Sehr blass: Der Beleg muss lesbar bleiben. Ein Wasserzeichen, das die
  // Zahlen verdeckt, macht die Einsicht wertlos -- und dann schickt jemand
  // stattdessen eine Kopie per Mail.
  stift.fillStyle = 'rgba(0, 0, 0, 0.13)'
  stift.textAlign = 'center'
  stift.textBaseline = 'middle'

  const breite = stift.measureText(zeile).width
  const abstandX = breite + groesse * 3
  const abstandY = groesse * 5

  stift.save()
  stift.rotate(NEIGUNG)

  // Ueber den gedrehten Bereich hinaus zeichnen, sonst bleiben nach der
  // Drehung Ecken frei.
  const rand = Math.max(geladen.width, geladen.height)
  for (let y = -rand; y < rand * 2; y += abstandY) {
    for (let x = -rand; x < rand * 2; x += abstandX) {
      stift.fillText(zeile, x, y)
    }
  }
  stift.restore()

  return Buffer.from(leinwand.toBuffer('image/webp'))
}
