/**
 * Texterkennung hinter einer Schnittstelle.
 *
 * Dieselbe Bauart wie bei der Extraktion (Konzept 13, [ADR 0003]): Der
 * Anbieter ist austauschbar, und ohne ausdrückliche Einstellung läuft
 * **keiner**. Ein OCR, das niemand bestellt hat, kostet Rechenzeit und
 * schreibt geratenen Text in einen Beleg, der später jemanden in die Irre
 * führt.
 *
 * Die Schnittstelle ist absichtlich schmal: hinein ein PDF, heraus ein PDF
 * mit Textlayer. Der Seitentext wird danach mit `seitenLesen` gewonnen —
 * derselbe Weg wie bei jedem anderen Beleg. Ein Anbieter, der eigenen Text
 * zurückgäbe, hätte eine zweite Wahrheit über den Seiteninhalt eröffnet.
 */

export interface Erkennungsergebnis {
  /** Dasselbe Dokument, mit Textlayer. Das Original bleibt unberührt. */
  pdf: Buffer
  /** Wie lange es gedauert hat — für die Messung, nicht für die Anzeige. */
  dauerMs: number
}

export interface Texterkennung {
  /** Für Protokoll und Fehlermeldung, z. B. `ocrmypdf`. */
  readonly name: string

  /**
   * Ist das Werkzeug da und lauffähig?
   *
   * Getrennt von `erkennen`, weil die Antwort einen anderen Ausgang hat:
   * Ein fehlendes Werkzeug ist keine Panne, die man wiederholen könnte —
   * es muss installiert werden. Deshalb wird der Beleg in diesem Fall
   * gemeldet und nicht dreimal erneut versucht.
   */
  verfuegbar(): Promise<boolean>

  erkennen(pdf: Buffer): Promise<Erkennungsergebnis>
}

export class ErkennungFehlgeschlagen extends Error {}
