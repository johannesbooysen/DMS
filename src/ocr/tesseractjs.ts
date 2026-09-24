/**
 * Texterkennung mit tesseract.js -- Tesseract als WebAssembly im Worker.
 *
 * WARUM EIN ZWEITER ANBIETER
 *
 * ocrmypdf ist der richtige Weg auf dem Server: Es liegt im Image, kennt
 * PDF/A und ist seit Jahren erprobt. Auf einem Entwicklungsrechner unter
 * Windows liegt es nicht -- und der erste echte Scan, der dort hereinkam,
 * landete ohne Text im Fehlerkorb. Eine Erkennung, die **ohne Installation**
 * laeuft, schliesst diese Luecke: tesseract.js bringt Tesseract als
 * WebAssembly mit; nur die Sprachdaten (deu: 7 MB) werden beim ersten Lauf
 * geholt und danach unter `.tesseract/` behalten.
 *
 * DASSELBE ERGEBNIS
 *
 * Die Schnittstelle verlangt: PDF hinein, PDF mit Textlayer heraus. Genau
 * das entsteht hier, mit denselben Mitteln wie bei ocrmypdf: Jede Seite
 * wird gerendert, erkannt, und die erkannten Woerter werden **unsichtbar**
 * (Textmodus 3) an ihrer Stelle in eine Kopie des Originals geschrieben.
 * Danach liest `seitenLesen` diese Fassung wie jede andere -- Suche,
 * Textkaesten, Extraktion sehen keinen Unterschied. Kein zweiter Weg fuer
 * Seitentext.
 *
 * Nicht PDF/A: Dafuer braeuchte es Ghostscript. Die Datei liegt trotzdem
 * unter `pdfa_derivat`, weil die Spalte "die erkannte Fassung" meint und
 * nicht "ISO 19005"; das Handbuch sagt das dazu.
 *
 * Das Original bleibt Byte fuer Byte unberuehrt (Projektregel): Der
 * Textlayer geht in die Kopie, die als Derivat abgelegt wird.
 */

import { access, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { OEM, createWorker, type Worker } from 'tesseract.js'
import { seiteFuerErkennung } from '../ingest/pdf'
import { ErkennungFehlgeschlagen, type Erkennungsergebnis, type Texterkennung } from './typen'

/** Wie lange ein Beleg hoechstens laufen darf -- dieselbe Variable wie bei ocrmypdf. */
const ZEITLIMIT_S = Number(process.env['DMS_OCR_ZEITLIMIT_S'] ?? 300)

/** Sprache, mehrere mit `+`. Dieselbe Variable wie bei ocrmypdf. */
const SPRACHE = process.env['DMS_OCR_SPRACHE'] ?? 'deu'

/**
 * Aufloesung fuer die Erkennung. 300 dpi ist die Empfehlung von Tesseract;
 * darunter leidet die Erkennung, darueber nur die Laufzeit.
 */
const DPI = 300

/** Unter dieser Sicherheit wird ein Wort nicht in den Textlayer geschrieben. */
const MINDESTSICHERHEIT = 30

/** Wo die Sprachdaten liegen (oder hinkommen). */
function sprachdatenPfad(): string {
  return resolve(process.env['DMS_OCR_SPRACHDATEN'] ?? '.tesseract')
}

/** Woher fehlende Sprachdaten geholt werden. */
function sprachquelle(): string {
  return process.env['DMS_OCR_SPRACHQUELLE'] ?? 'https://tessdata.projectnaptha.com/4.0.0'
}

function sprachen(): string[] {
  return SPRACHE.split('+')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

let arbeiter: Promise<Worker> | null = null

async function arbeiterHolen(): Promise<Worker> {
  if (arbeiter === null) {
    arbeiter = (async () => {
      await mkdir(sprachdatenPfad(), { recursive: true })
      const w = await createWorker(sprachen(), OEM.LSTM_ONLY, {
        cachePath: sprachdatenPfad(),
        langPath: sprachquelle(),
        gzip: true,
        // Kein Protokoll je Fortschrittsschritt: Der Worker meldet
        // Ergebnisse, nicht Prozente.
        logger: () => {},
      })
      await w.setParameters({ user_defined_dpi: String(DPI) })
      return w
    })().catch((fehler: unknown) => {
      // Ein gescheiterter Start bleibt nicht als kaputter Arbeiter haengen;
      // der naechste Beleg versucht es neu.
      arbeiter = null
      throw fehler
    })
  }
  return arbeiter
}

async function arbeiterBeenden(): Promise<void> {
  const laufend = arbeiter
  arbeiter = null
  if (laufend === null) return
  try {
    await (await laufend).terminate()
  } catch {
    // Beim Herunterfahren gibt es niemanden mehr, dem das etwas sagte.
  }
}

async function dateiDa(pfad: string): Promise<boolean> {
  try {
    await access(pfad)
    return true
  } catch {
    return false
  }
}

/** Sprachdaten fuer eine Sprache: im Cache, oder erreichbar bei der Quelle. */
async function sprachdatenErreichbar(sprache: string): Promise<boolean> {
  if (await dateiDa(resolve(sprachdatenPfad(), `${sprache}.traineddata`))) return true
  try {
    const antwort = await fetch(`${sprachquelle()}/${sprache}.traineddata.gz`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
    return antwort.ok
  } catch {
    return false
  }
}

/** Nur Zeichen, die die eingebettete Schrift kodieren kann. */
function kodierbar(font: PDFFont): (text: string) => string {
  const zeichen = new Set(font.getCharacterSet())
  return (text) =>
    Array.from(text)
      .filter((z) => zeichen.has(z.codePointAt(0) ?? -1))
      .join('')
}

interface Wort {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Schreibt ein erkanntes Wort unsichtbar an seine Stelle.
 *
 * Die vier Ecken des Wortkastens werden ueber die Seitendrehung in den
 * PDF-Raum gerechnet; aus unterer Kante und Hoehe folgen Lage, Groesse und
 * Drehung, die Breite wird ueber die horizontale Skalierung (`Tz`)
 * angepasst, damit das unsichtbare Wort so breit ist wie das gescannte --
 * sonst stuenden Suchtreffer und Textkaesten neben dem Bild.
 */
function wortSchreiben(
  seite: PDFPage,
  schriftKey: PDFName,
  font: PDFFont,
  bereinigen: (t: string) => string,
  wort: Wort,
  zumPdfPunkt: (x: number, y: number) => [number, number],
): boolean {
  const text = bereinigen(wort.text).trim()
  if (text === '') return false

  const [lx, ly] = zumPdfPunkt(wort.bbox.x0, wort.bbox.y1) // unten links
  const [rx, ry] = zumPdfPunkt(wort.bbox.x1, wort.bbox.y1) // unten rechts
  const [ox, oy] = zumPdfPunkt(wort.bbox.x0, wort.bbox.y0) // oben links

  const breite = Math.hypot(rx - lx, ry - ly)
  const hoehe = Math.hypot(ox - lx, oy - ly)
  if (breite <= 0 || hoehe <= 0) return false

  // Der Wortkasten schliesst Unterlaengen ein; die Grundlinie liegt etwas
  // darueber, und die Schriftgroesse ist etwas kleiner als der Kasten.
  const groesse = hoehe / 1.2
  const winkel = Math.atan2(ry - ly, rx - lx)
  const abstieg = groesse * 0.2
  const x = lx - Math.sin(winkel) * abstieg
  const y = ly + Math.cos(winkel) * abstieg

  const natuerlich = font.widthOfTextAtSize(text, groesse)
  if (natuerlich <= 0) return false
  const squeeze = Math.min(500, Math.max(10, (breite / natuerlich) * 100))

  seite.pushOperators(
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(schriftKey, groesse),
    setCharacterSqueeze(squeeze),
    setTextMatrix(Math.cos(winkel), Math.sin(winkel), -Math.sin(winkel), Math.cos(winkel), x, y),
    showText(font.encodeText(text)),
    endText(),
  )
  return true
}

function woerter(blocks: Array<{ paragraphs: Array<{ lines: Array<{ words: Wort[] }> }> }> | null): Wort[] {
  if (blocks === null) return []
  return blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
}

async function erkennenOhneUhr(pdf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bereinigen = kodierbar(font)
  const w = await arbeiterHolen()

  const seiten = doc.getPages()
  for (let nr = 1; nr <= seiten.length; nr++) {
    const seite = seiten[nr - 1]!
    const bild = await seiteFuerErkennung(pdf, nr, DPI)
    const { data } = await w.recognize(bild.png, {}, { text: false, blocks: true })

    // Der Inhalt des Scans wird in q/Q eingeschlossen: Was er an
    // Transformationen hinterlaesst, darf die Lage des Textlayers nicht
    // verschieben.
    const q = doc.context.register(doc.context.flateStream('q\n'))
    const Q = doc.context.register(doc.context.flateStream('Q\n'))
    seite.node.wrapContentStreams(q, Q)

    const schriftKey = seite.node.newFontDictionary(font.name, font.ref)
    for (const wort of woerter(data.blocks)) {
      if (wort.confidence < MINDESTSICHERHEIT) continue
      wortSchreiben(seite, schriftKey, font, bereinigen, wort, bild.zumPdfPunkt)
    }
  }

  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

export const tesseractjsErkennung: Texterkennung = {
  name: 'tesseractjs',

  async verfuegbar(): Promise<boolean> {
    for (const sprache of sprachen()) {
      if (!(await sprachdatenErreichbar(sprache))) return false
    }
    return true
  },

  async erkennen(pdf: Buffer): Promise<Erkennungsergebnis> {
    const begonnen = Date.now()
    let uhr: NodeJS.Timeout | undefined
    const abbruch = new Promise<never>((_, ablehnen) => {
      uhr = setTimeout(() => {
        // Der Arbeiter steckt mitten in einer Seite; ihn zu beenden ist der
        // einzige Weg, die Rechenzeit zurueckzubekommen. Der naechste Beleg
        // startet einen neuen.
        void arbeiterBeenden()
        ablehnen(new ErkennungFehlgeschlagen(`Texterkennung nach ${ZEITLIMIT_S} s abgebrochen.`))
      }, ZEITLIMIT_S * 1000)
    })
    try {
      const ergebnis = await Promise.race([erkennenOhneUhr(pdf), abbruch])
      return { pdf: ergebnis, dauerMs: Date.now() - begonnen }
    } catch (fehler) {
      if (fehler instanceof ErkennungFehlgeschlagen) throw fehler
      throw new ErkennungFehlgeschlagen(
        `tesseract.js: ${fehler instanceof Error ? fehler.message : String(fehler)}`,
      )
    } finally {
      clearTimeout(uhr)
    }
  },

  beenden: arbeiterBeenden,
}
