/**
 * Trennblätter erkennen.
 *
 * Konzept 24.1 nennt zwei Wege: „Barcode-Trennblatt oder KI". Gebaut ist der
 * erste — und zwar über den **aufgedruckten Text**, nicht über das
 * Barcodebild.
 *
 * Das ist eine bewusste Verkleinerung: Ein Trennblatt trägt seinen Barcode
 * praktisch immer zusammen mit einer Klarschriftzeile, damit ein Mensch das
 * Blatt erkennt. Diese Zeile liest der vorhandene Textlayer ohnehin mit. Ein
 * Barcodeleser wäre eine weitere Abhängigkeit für dieselbe Auskunft.
 *
 * Was er nicht kann: ein Trennblatt erkennen, das nur einen Barcode trägt und
 * sonst nichts. Dafür gibt es die Korrekturoberfläche — und sie ist ohnehin
 * Pflicht, weil keine automatische Trennung fehlerfrei ist.
 */

/**
 * Was auf einem Trennblatt steht.
 *
 * Bewusst mehrere Schreibweisen: Wer die Blätter druckt, hält sich nicht an
 * eine Vorgabe, die er nicht kennt.
 */
const TRENNWORTE = [
  'trennblatt',
  'trennseite',
  'belegtrennung',
  'separator',
  'separator sheet',
]

/**
 * Wie viele Zeichen eine Seite höchstens haben darf, um noch als Trennblatt
 * durchzugehen.
 *
 * Ein Trennblatt ist fast leer. Steht das Wort „Trennblatt" mitten in einer
 * Rechnung über zweitausend Zeichen — etwa als Position einer
 * Druckereirechnung —, ist es keins. Ohne diese Schranke zerlegte genau eine
 * solche Rechnung den Stapel an der falschen Stelle.
 */
const HOECHSTLAENGE = 400

export interface Seitenbefund {
  seite: number
  trenner: boolean
  /** Woran es erkannt wurde — für die Korrekturoberfläche. */
  grund: string | null
}

export function istTrennblatt(text: string | null): { trenner: boolean; grund: string | null } {
  if (text === null) return { trenner: false, grund: null }

  const knapp = text.replace(/\s+/g, ' ').trim()
  if (knapp.length > HOECHSTLAENGE) return { trenner: false, grund: null }

  const klein = knapp.toLowerCase()
  for (const wort of TRENNWORTE) {
    const stelle = klein.indexOf(wort)
    if (stelle >= 0) {
      // Zitiert wird, was **auf dem Blatt steht** — nicht das kleingeschriebene
      // Suchwort. Der Grund landet in der Korrekturoberfläche, und dort soll
      // jemand wiedererkennen, was er gedruckt hat.
      const gefunden = knapp.slice(stelle, stelle + wort.length)
      return { trenner: true, grund: `Seite enthält „${gefunden}" und ist fast leer` }
    }
  }
  return { trenner: false, grund: null }
}

/**
 * Bewertet alle Seiten eines Stapels.
 *
 * Rein und ohne Datenbank, damit sie sich gegen erfundene Texte prüfen lässt
 * — die interessanten Fälle sind die Grenzfälle, und für die braucht es
 * keinen Scanner.
 */
export function trennungVorschlagen(
  seiten: Array<{ seite: number; text: string | null }>,
): Seitenbefund[] {
  return seiten.map((s) => {
    const befund = istTrennblatt(s.text)
    return { seite: s.seite, trenner: befund.trenner, grund: befund.grund }
  })
}

/**
 * Ordnet Seiten den Belegen zu — dieselbe Rechnung wie `app.stapel_gruppieren`,
 * nur für die Vorschau ohne Datenbank.
 *
 * Der Beleg beginnt **nach** dem Trennblatt. Ein Stapel, der mit einem
 * Trennblatt anfängt, hat deshalb keinen leeren ersten Beleg.
 */
export function belegeGruppieren(
  befunde: Seitenbefund[],
): Array<{ belegNr: number; seiten: number[] }> {
  const belege: Array<{ belegNr: number; seiten: number[] }> = []
  let nr = 1
  let offen: number[] = []

  for (const b of befunde) {
    if (b.trenner) {
      if (offen.length > 0) {
        belege.push({ belegNr: nr, seiten: offen })
        nr += 1
        offen = []
      }
      continue
    }
    offen.push(b.seite)
  }
  if (offen.length > 0) belege.push({ belegNr: nr, seiten: offen })

  return belege
}
