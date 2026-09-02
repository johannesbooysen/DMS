/**
 * Ablage der Originaldateien.
 *
 * Hinter dem Interface steckt spaeter S3 mit Object Lock im Compliance-Modus
 * (Konzept 19). Fuer die Entwicklung genuegt das Dateisystem. Die Fachlogik
 * kennt nur `Ablage` -- der Wechsel ist eine Zeile in der Zusammenstellung,
 * keine Aenderung im Ingest.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface Ablage {
  schreiben(schluessel: string, inhalt: Buffer): Promise<void>

  /**
   * Liest eine Datei.
   *
   * `fassung` pinnt eine bestimmte Fassung des Schluessels, sofern die Ablage
   * Fassungen kennt. Der Parameter steht hier und nicht erst in der
   * S3-Ablage, weil sonst jeder Aufrufer erst pruefen muesste, welche Ablage
   * er gerade hat -- und wer es vergaesse, bekaeme still die falschen Bytes.
   *
   * **Warum es das ueberhaupt gibt.** Object Lock schuetzt Fassungen, nicht
   * Schluessel. Wer eine gesperrte Datei ueberschreibt, wird *nicht*
   * abgewiesen: Es entsteht eine zweite Fassung, die gesperrte bleibt
   * unzerstoerbar liegen -- aber ein gewoehnliches Lesen liefert ab dann die
   * neue. Ohne die festgehaltene Fassung waere die Sperre ein Schutz, den
   * niemand einloest. Gemessen gegen MinIO, siehe `tests/ablage-s3.test.ts`.
   */
  lesen(schluessel: string, fassung?: string | null): Promise<Buffer>
}

export class DateisystemAblage implements Ablage {
  constructor(private readonly wurzel: string) {}

  private pfad(schluessel: string): string {
    // Schluessel sind anwendungsintern vergeben (storage_praefix + Variante).
    // Trotzdem nicht ungeprueft in einen Pfad haengen.
    if (schluessel.includes('..')) {
      throw new Error('Unzulaessiger Ablageschluessel')
    }
    return join(this.wurzel, schluessel)
  }

  async schreiben(schluessel: string, inhalt: Buffer): Promise<void> {
    const ziel = this.pfad(schluessel)
    await mkdir(dirname(ziel), { recursive: true })
    await writeFile(ziel, inhalt)
  }

  async lesen(schluessel: string, _fassung?: string | null): Promise<Buffer> {
    /*
     * Die Fassung wird ignoriert und nicht als Fehler abgewiesen.
     *
     * Ein Verzeichnis kennt keine Fassungen; es gibt hier nur die eine Datei.
     * Wer eine mitgibt, bekommt also, was da ist -- und die Entwicklung laeuft
     * ohne S3 weiter. Was fehlt, ist der Schutz, nicht die Funktion, und das
     * steht an einer einzigen Stelle: `archiv_eintrag.storage_fassung` bleibt
     * leer, so wie `storage_object_lock_bis` es schon tut.
     */
    return readFile(this.pfad(schluessel))
  }
}

/**
 * Inhaltshash ueber die Rohdatei. Grundlage der ersten Dublettenstufe und
 * spaeter des Archivnachweises -- deshalb ueber die Bytes, nicht ueber den
 * extrahierten Text.
 */
export function inhaltHash(inhalt: Buffer): string {
  return createHash('sha256').update(inhalt).digest('hex')
}
