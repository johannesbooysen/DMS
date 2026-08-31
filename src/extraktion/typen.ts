/**
 * Die Erkennung hinter einem Interface.
 *
 * Grundlage: Konzept 13. Der Anbieter ist austauschbar — strukturierte
 * Rechnung, lokales Modell, später ein Dienst wie Bedrock. Die Fachlogik
 * kennt nur dieses Interface.
 *
 * Der Grund steht im Konzept: Fällt der Anbieter aus, bleibt das Dokument
 * nicht liegen. Der Workflow startet trotzdem, die Erfassung erfolgt
 * manuell. Ein Extraktionsergebnis ist ein Vorschlag, keine Voraussetzung.
 */

/** Felder, die die Erkennung liefern kann. Bewusst eine feste Liste. */
export type Feldname =
  | 'kreditor_name'
  | 'kreditor_ust_id'
  | 'rechnungsnummer'
  | 'rechnungsdatum'
  | 'leistung_von'
  | 'leistung_bis'
  | 'netto'
  | 'steuer'
  | 'brutto'
  | 'iban_im_beleg'
  | 'zahlungsziel'
  | 'skonto_prozent'
  | 'skonto_bis'

export interface ErkanntesFeld {
  feldname: Feldname
  /** Rohtext, wie er im Beleg steht. */
  text?: string | null
  zahl?: number | null
  datum?: string | null
  /** 0 bis 1. Bei strukturierten Rechnungen per Definition 1 (Konzept 14). */
  confidence: number
  /** Fundstelle im Beleg, sofern bekannt. */
  seite?: number | null
  bbox?: number[] | null
}

export interface Extraktionsanfrage {
  dokumentId: string
  /** Die Rohdatei — für den strukturierten Weg. */
  inhalt: Buffer
  /** Seitentext, wie ihn die Aufbereitung gelesen hat. */
  seiten: Array<{ seite: number; text: string }>
  /**
   * Freitext je Ordnungsgruppe aus den Stammdaten, der in den Prompt
   * eingebettet wird (Konzept 4). Damit funktioniert der Vorschlag für eine
   * neu angelegte Gruppe ab dem nächsten Beleg, ohne Eingriff in den Code.
   */
  kiBeschreibung?: string | null
}

export interface Extraktionsergebnis {
  felder: ErkanntesFeld[]
  /** Woher die Werte stammen — landet in extraktion_feld.quelle. */
  quelle: 'zugferd' | 'ki' | 'regel'
  /** Welches Modell in welcher Fassung; ohne das ist nichts nachvollziehbar. */
  modell?: string | null
}

export interface Extraktionsanbieter {
  readonly name: string
  /** Kann dieser Anbieter mit dem Beleg etwas anfangen? */
  zustaendig(anfrage: Extraktionsanfrage): Promise<boolean>
  extrahieren(anfrage: Extraktionsanfrage): Promise<Extraktionsergebnis | null>
}
