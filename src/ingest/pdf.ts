/**
 * PDF: Seitentext mit Koordinaten und Vorrendern.
 *
 * Warum nicht pdfium, wie im Konzept genannt: fuer Node gibt es pdfium nur
 * als WASM-Bindung, die im Wesentlichen das Rendern abdeckt. Text mit
 * Fundstelle braeuchte zusaetzlich pdfjs -- zwei Bibliotheken fuer eine
 * Aufgabe. Die Anforderung dahinter ist erfuellt: Text mit Koordinaten und
 * ein vorgerendertes Bild beim Eingang, nicht bei der Anzeige.
 *
 * Beides passiert im Worker, nie in einem Request.
 */

import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Fundstelle eines Textstuecks in Seitenkoordinaten (Ursprung oben links). */
export interface Textstueck {
  text: string
  x: number
  y: number
  breite: number
  hoehe: number
}

export interface Seiteninhalt {
  seite: number
  text: string
  breite: number
  hoehe: number
  stuecke: Textstueck[]
}

/**
 * Ab wie vielen Zeichen je Seite ein Textlayer als vorhanden gilt.
 * Gescannte Belege liefern oft ein paar Zeichen aus Kopfzeilen oder
 * Stempeln -- null Zeichen als Grenze waere zu optimistisch.
 */
const TEXTLAYER_MINDESTZEICHEN = 40

/**
 * Gibt den Ladeauftrag zurueck, nicht das Dokument: freigegeben wird ueber
 * `ladeauftrag.destroy()`. Ohne das bleibt je Aufruf ein Transport offen.
 */
function dokumentOeffnen(inhalt: Buffer) {
  return getDocument({
    data: new Uint8Array(inhalt),
    // Kein eigener Worker-Prozess: der Worker ist bereits einer.
    useSystemFonts: true,
  })
}

export async function seitenLesen(inhalt: Buffer): Promise<Seiteninhalt[]> {
  const ladeauftrag = dokumentOeffnen(inhalt)
  const doc = await ladeauftrag.promise
  try {
    const seiten: Seiteninhalt[] = []

    for (let nr = 1; nr <= doc.numPages; nr++) {
      const seite = await doc.getPage(nr)
      const sicht = seite.getViewport({ scale: 1 })
      const inhaltDerSeite = await seite.getTextContent()

      const stuecke: Textstueck[] = []
      for (const eintrag of inhaltDerSeite.items) {
        if (!('str' in eintrag) || eintrag.str === '') continue
        const [, , , , x, y] = eintrag.transform as number[]
        stuecke.push({
          text: eintrag.str,
          x: x ?? 0,
          // PDF zaehlt von unten, die Anzeige von oben.
          y: sicht.height - (y ?? 0) - eintrag.height,
          breite: eintrag.width,
          hoehe: eintrag.height,
        })
      }

      seiten.push({
        seite: nr,
        text: stuecke.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
        breite: Math.round(sicht.width),
        hoehe: Math.round(sicht.height),
        stuecke,
      })
      seite.cleanup()
    }

    return seiten
  } finally {
    await ladeauftrag.destroy()
  }
}

/**
 * Hat das Dokument einen brauchbaren Textlayer? Wenn nein, muss OCR laufen
 * (Konzept 13). Die Entscheidung faellt je Dokument, nicht je Seite: ein
 * Anschreiben mit Text und ein gescanntes Blatt dahinter gehoeren zusammen
 * durch dieselbe Strecke.
 */
export function hatTextlayer(seiten: Seiteninhalt[]): boolean {
  if (seiten.length === 0) return false
  const zeichen = seiten.reduce((summe, s) => summe + s.text.length, 0)
  return zeichen / seiten.length >= TEXTLAYER_MINDESTZEICHEN
}

/**
 * Rendert eine Seite als WebP. `zielbreite` bestimmt die Aufloesung:
 * klein fuer die Trefferliste, gross fuer die Anzeige. Beides entsteht
 * beim Eingang -- der Viewer soll nur noch ein fertiges Bild ausliefern.
 */
export async function seiteRendern(
  inhalt: Buffer,
  seitennummer: number,
  zielbreite: number,
  qualitaet = 82,
): Promise<Buffer> {
  const ladeauftrag = dokumentOeffnen(inhalt)
  const doc = await ladeauftrag.promise
  try {
    const seite = await doc.getPage(seitennummer)
    const grundmass = seite.getViewport({ scale: 1 })
    const sicht = seite.getViewport({ scale: zielbreite / grundmass.width })

    const leinwand = createCanvas(Math.round(sicht.width), Math.round(sicht.height))
    const kontext = leinwand.getContext('2d')
    kontext.fillStyle = '#ffffff'
    kontext.fillRect(0, 0, leinwand.width, leinwand.height)

    // Die Typen von pdfjs beschreiben den Browser-Kontext; @napi-rs/canvas
    // erfuellt dieselbe Schnittstelle, traegt aber keine DOM-Typen. Die
    // Umdeutung bleibt auf diese eine Stelle beschraenkt.
    const auftrag = {
      canvasContext: kontext,
      canvas: leinwand,
      viewport: sicht,
    } as unknown as Parameters<typeof seite.render>[0]

    await seite.render(auftrag).promise

    seite.cleanup()
    return leinwand.encode('webp', qualitaet)
  } finally {
    await ladeauftrag.destroy()
  }
}
