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
  lesen(schluessel: string): Promise<Buffer>
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

  async lesen(schluessel: string): Promise<Buffer> {
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
