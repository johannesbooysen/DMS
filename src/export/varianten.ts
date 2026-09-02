/**
 * Welche Layer in welchen Export gehören — und wie er gebaut wird.
 *
 * Konzept 16 nennt vier Varianten. Was dort als Tabelle steht, hat eine
 * Folge, die dort nicht steht: **Sobald eine Schwärzung dabei ist, kann der
 * Export kein Textdokument mehr sein.**
 *
 * Der Grund ist derselbe wie bei der externen Einsicht: Ein schwarzes
 * Rechteck in einem PDF liegt nur *darauf*. Der Text darunter bleibt im
 * Dokument und lässt sich markieren, kopieren oder mit jedem Werkzeug
 * auslesen — so sind schon Behörden und Kanzleien aufgefallen. Richtig
 * schwärzen hieße, den Seiteninhalt neu zu schreiben; das leistet pdf-lib
 * nicht, und eine halbe Lösung wäre schlimmer als keine, weil sie *aussieht*
 * wie eine Schwärzung.
 *
 * Deshalb eine einzige Regel, die überall gilt und die man sich merken kann:
 *
 *   **Hat der Beleg Schwärzungen, wird jeder Export außer dem Archivoriginal
 *   aus den Seitenbildern gebaut.**
 *
 * Ein Bild hat keinen Textlayer — was übermalt ist, ist weg. Der Preis ist
 * die Durchsuchbarkeit des ausgegebenen PDF. Für etwas, das aus dem Haus
 * geht, ist das der richtige Tausch; das durchsuchbare Original bleibt im
 * Archiv.
 */

export type Exportvariante = 'archiv' | 'stempel' | 'extern' | 'intern'

export interface Variantenregel {
  /** Welche Layertypen eingezeichnet werden. */
  layer: ReadonlySet<string>
  /** Wasserzeichen mit Empfänger und Datum. */
  wasserzeichen: boolean
  /** Kurz für die Oberfläche und den Dateinamen. */
  bezeichnung: string
}

export const VARIANTEN: Record<Exportvariante, Variantenregel> = {
  /*
   * Das Original, Byte für Byte.
   *
   * Keine Layer, kein Neuschreiben, kein Wasserzeichen -- sonst stimmt der
   * Hash im Archiv nicht mehr, und dann ist das Archiv eine Behauptung
   * (Konzept 19).
   */
  archiv: {
    layer: new Set(),
    wasserzeichen: false,
    bezeichnung: 'Archivoriginal',
  },

  /*
   * Der Beleg, wie ihn die Buchhaltung ablegt: mit den Stempeln, die zeigen,
   * wer was entschieden hat.
   */
  stempel: {
    layer: new Set(['stempel']),
    wasserzeichen: false,
    bezeichnung: 'Beleg mit Stempeln',
  },

  /*
   * Was nach draußen geht. Interne Notizen bleiben drinnen -- die Auswahl
   * trifft zusätzlich `sichtbarkeit` je Layer.
   */
  extern: {
    layer: new Set(['stempel', 'schwaerzung', 'highlight']),
    wasserzeichen: true,
    bezeichnung: 'Belegeinsicht',
  },

  /** Die vollständige Akte, für den eigenen Gebrauch. */
  intern: {
    layer: new Set(['stempel', 'schwaerzung', 'highlight', 'notiz']),
    wasserzeichen: false,
    bezeichnung: 'Interne Akte',
  },
}

export function istVariante(wert: string): wert is Exportvariante {
  return Object.prototype.hasOwnProperty.call(VARIANTEN, wert)
}

/**
 * Muss dieser Export aus Seitenbildern gebaut werden?
 *
 * Die Frage hängt **nicht** daran, ob die Variante Schwärzungen zeigt,
 * sondern ob der Beleg welche hat. Sonst gäbe es einen Weg, über die
 * Variante `stempel` ein PDF zu bekommen, in dem das Geschwärzte im Klartext
 * steht — und der Weg wäre einen Klick entfernt.
 */
export function brauchtSeitenbilder(
  variante: Exportvariante,
  hatSchwaerzung: boolean,
): boolean {
  return variante !== 'archiv' && hatSchwaerzung
}

/**
 * Geht dieser Layer in diese Variante?
 *
 * Zwei Bedingungen, und beide müssen erfüllt sein: Die Variante zeigt den
 * Typ überhaupt, **und** die Sichtbarkeit des einzelnen Layers erlaubt es
 * nach draußen. Eine als intern markierte Notiz gehört auch dann nicht in
 * die externe Einsicht, wenn die Variante Notizen grundsätzlich zeigte.
 */
export function gehoertHinein(
  variante: Exportvariante,
  layer: { typ: string; sichtbarkeit: string },
): boolean {
  if (!VARIANTEN[variante].layer.has(layer.typ)) return false

  // Eine Schwärzung verdeckt -- sie ist nie eine Frage der Sichtbarkeit.
  if (layer.typ === 'schwaerzung') return true

  if (variante === 'extern') {
    return layer.sichtbarkeit === 'extern' || layer.sichtbarkeit === 'alle'
  }
  return true
}
