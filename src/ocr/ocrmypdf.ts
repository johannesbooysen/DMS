/**
 * Texterkennung über ocrmypdf.
 *
 * Konzept 13 nennt es namentlich. Es ist kein Modell, sondern ein Aufruf:
 * ocrmypdf ruft Tesseract für die Erkennung und Ghostscript für die Ausgabe.
 * Alle drei müssen auf dem Rechner liegen, auf dem der **Worker** läuft —
 * nicht auf dem der Anwendung.
 *
 * Über Dateien und nicht über Standardein-/ausgabe, weil ocrmypdf das PDF
 * mehrfach durchläuft und dafür eine seekbare Datei braucht. Die
 * Zwischendateien tragen Belegtext und werden deshalb **immer** gelöscht,
 * auch wenn der Aufruf scheitert.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ErkennungFehlgeschlagen, type Erkennungsergebnis, type Texterkennung } from './typen'

/** Wie lange ein Beleg höchstens laufen darf. Ein Stapel kann lange dauern. */
const ZEITLIMIT_S = Number(process.env['DMS_OCR_ZEITLIMIT_S'] ?? 300)

/** Sprache für Tesseract. Mehrere mit `+`, etwa `deu+eng`. */
const SPRACHE = process.env['DMS_OCR_SPRACHE'] ?? 'deu'

function programm(): string {
  return process.env['DMS_OCR_PROGRAMM'] ?? 'ocrmypdf'
}

/**
 * Die Aufrufparameter — jeder einzelne mit Grund.
 *
 * `--skip-text` statt `--force-ocr`: Ein Anschreiben mit Textlayer und ein
 * gescanntes Blatt dahinter gehören durch dieselbe Strecke (siehe
 * `hatTextlayer`). `--force-ocr` würde den vorhandenen Text verwerfen und
 * durch erkannten ersetzen — schlechter als das Original.
 *
 * **Kein** `--deskew` und **kein** `--rotate-pages`, so verlockend sie sind:
 * Beide ändern die Seitengeometrie. Die WebP-Vorschauen entstehen aus dem
 * Original, und der Viewer holt zum Zoomen ebenfalls das Original — eine
 * begradigte Fassung daneben hieße, dass Vorschau und PDF nicht mehr
 * übereinanderliegen. Wer sie will, muss zuerst entscheiden, welche Fassung
 * die angezeigte ist.
 *
 * `--output-type pdfa`: ocrmypdfs Vorgabe, und zugleich das PDF/A-Derivat aus
 * Konzept 19. Ein Durchlauf, zwei erfüllte Anforderungen.
 */
function argumente(quelle: string, ziel: string): string[] {
  return [
    '--language', SPRACHE,
    '--output-type', 'pdfa',
    '--skip-text',
    '--quiet',
    quelle,
    ziel,
  ]
}

async function aufrufen(
  args: string[],
  zeitlimitMs: number,
): Promise<{ code: number | null; fehlertext: string }> {
  return new Promise((fertig, abbruch) => {
    const kind = spawn(programm(), args, { windowsHide: true })
    let fehlertext = ''
    let abgelaufen = false

    const uhr = setTimeout(() => {
      abgelaufen = true
      kind.kill('SIGKILL')
    }, zeitlimitMs)

    kind.stderr.on('data', (b: Buffer) => {
      // Nur die letzten Zeilen behalten: ocrmypdf ist gespraechig, und der
      // Grund steht am Ende.
      fehlertext = (fehlertext + b.toString()).slice(-2000)
    })

    kind.on('error', (f: Error) => {
      clearTimeout(uhr)
      abbruch(f)
    })

    kind.on('close', (code) => {
      clearTimeout(uhr)
      if (abgelaufen) {
        abbruch(
          new ErkennungFehlgeschlagen(
            `Texterkennung nach ${Math.round(zeitlimitMs / 1000)} s abgebrochen.`,
          ),
        )
        return
      }
      fertig({ code, fehlertext })
    })
  })
}

export const ocrmypdfErkennung: Texterkennung = {
  name: 'ocrmypdf',

  async verfuegbar(): Promise<boolean> {
    try {
      const { code } = await aufrufen(['--version'], 15_000)
      return code === 0
    } catch {
      // `spawn` wirft, wenn das Programm gar nicht existiert. Genau das ist
      // die haeufigste Antwort auf diese Frage.
      return false
    }
  },

  async erkennen(pdf: Buffer): Promise<Erkennungsergebnis> {
    const verzeichnis = await mkdtemp(join(tmpdir(), 'dms-ocr-'))
    const quelle = join(verzeichnis, 'eingang.pdf')
    const ziel = join(verzeichnis, 'ausgang.pdf')
    const begonnen = Date.now()

    try {
      await writeFile(quelle, pdf)
      const { code, fehlertext } = await aufrufen(argumente(quelle, ziel), ZEITLIMIT_S * 1000)

      /*
       * ocrmypdf unterscheidet mehr als "ging" und "ging nicht":
       *   0  fertig
       *   2  Eingabedatei unbrauchbar
       *   4  Ausgabe geschrieben, aber Text war schon da
       *   6  nichts zu tun -- alle Seiten hatten Text
       * 4 und 6 sind kein Fehler. Sie bedeuten, dass `hatTextlayer` und
       * ocrmypdf verschiedener Meinung waren, und im Zweifel behalten wir
       * das, was herauskam.
       */
      if (code !== 0 && code !== 4 && code !== 6) {
        throw new ErkennungFehlgeschlagen(
          `ocrmypdf endete mit ${code ?? 'Signal'}: ${letzteZeile(fehlertext)}`,
        )
      }

      const ergebnis = await readFile(ziel).catch(() => null)
      if (ergebnis === null || ergebnis.length === 0) {
        throw new ErkennungFehlgeschlagen('ocrmypdf hat keine Ausgabe geschrieben.')
      }

      return { pdf: ergebnis, dauerMs: Date.now() - begonnen }
    } finally {
      // Die Zwischendateien tragen Belegtext. Sie muessen weg, auch und
      // gerade wenn oben etwas geworfen wurde.
      await rm(verzeichnis, { force: true, recursive: true })
    }
  },
}

/** Aus dem Geschwätz die eine Zeile ziehen, die den Grund nennt. */
function letzteZeile(text: string): string {
  const zeilen = text
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter((z) => z !== '')
  return zeilen.at(-1) ?? 'ohne Meldung'
}
