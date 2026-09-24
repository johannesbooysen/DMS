/**
 * Auswahl der Texterkennung.
 *
 * Vorgabe ist `keine`. Das ist keine Bequemlichkeit, sondern dieselbe
 * Entscheidung wie bei der Extraktion: Ohne Bestellung wird nicht geraten.
 * Ein Beleg ohne Textlayer bleibt dann sichtbar liegen — im Fehlerkorb, mit
 * Grund — statt still ohne Text durchzulaufen.
 *
 * Genau das war vorher der Zustand: `aufbereiten` stellte `ocr_noetig` fest
 * und tat nichts damit. Der Beleg wurde `laufend`, seine Seiten blieben leer,
 * und niemand erfuhr davon. Für eine Hausverwaltung, deren Hauptkanal der
 * Scanner ist, war das die stillste aller Lücken.
 */

import { ocrmypdfErkennung } from './ocrmypdf'
import { tesseractjsErkennung } from './tesseractjs'
import type { Texterkennung } from './typen'

export * from './typen'
export { ocrmypdfErkennung, tesseractjsErkennung }

/**
 * Welche Erkennung eingestellt ist — oder `null`.
 *
 * Wird bei jedem Aufruf neu gelesen, damit ein Test die Umgebung setzen
 * kann, ohne das Modul neu zu laden.
 */
export function texterkennung(): Texterkennung | null {
  switch (process.env['DMS_OCR'] ?? 'keine') {
    case 'ocrmypdf':
      return ocrmypdfErkennung
    case 'tesseractjs':
      // Tesseract als WebAssembly, ohne Installation -- fuer Rechner ohne
      // ocrmypdf. Sprachdaten kommen beim ersten Lauf nach `.tesseract/`.
      return tesseractjsErkennung
    default:
      return null
  }
}

export function ocrEingerichtet(): boolean {
  return texterkennung() !== null
}

/** Beim Herunterfahren: Was die Erkennung an Prozessen haelt, freigeben. */
export async function texterkennungBeenden(): Promise<void> {
  await texterkennung()?.beenden?.()
}
