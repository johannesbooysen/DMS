/**
 * Beträge aus Text lesen.
 *
 * Klingt trivial und ist die Stelle, an der eine Messung einen Fehler
 * gefunden hat: Der frühere Auswerter entfernte alle Punkte als deutsche
 * Tausendertrennzeichen — während der Prompt das Modell um den Punkt als
 * Dezimaltrennzeichen bittet. Aus 1023.40 wurde so 102340, in jedem Lauf
 * gleich falsch. Die Ampel stand dabei auf Grün, weil das Modell sich seiner
 * Sache sicher war; falsch war die Umwandlung danach.
 *
 * Deshalb wird hier nicht geraten, welches Format vorliegt, sondern
 * entschieden: **Das letzte Trennzeichen zählt.** Stehen ein oder zwei
 * Ziffern dahinter, ist es das Dezimaltrennzeichen; stehen drei dahinter,
 * war es eine Tausendergruppe.
 *
 *   1.023,40  ->  1023.4    (letztes Zeichen Komma, zwei Stellen)
 *   1023.40   ->  1023.4    (letztes Zeichen Punkt, zwei Stellen)
 *   1023.4    ->  1023.4
 *   1.023     ->  1023      (drei Stellen: Tausendergruppe)
 *   1.234.567 ->  1234567
 *
 * Bekannte Grenze: Ein Betrag mit drei Nachkommastellen — etwa 0.500 für
 * einen halben Euro — wird als Tausendergruppe gelesen. Bei Rechnungsbeträgen
 * kommt das nicht vor; bei Mengen oder Umlageschlüsseln müsste man es prüfen.
 */

export function betragLesen(roh: string | number | null | undefined): number | null {
  if (roh === null || roh === undefined) return null
  if (typeof roh === 'number') return Number.isFinite(roh) ? roh : null

  // Währungszeichen, Leerraum und geschützte Leerzeichen weg.
  const sauber = roh
    .replace(/[€$\s ]/g, '')
    .replace(/EUR/gi, '')
    .trim()
  if (sauber === '') return null

  const vorzeichen = sauber.startsWith('-') ? -1 : 1
  const ziffernUndTrenner = sauber.replace(/^[+-]/, '')
  if (!/^[\d.,]+$/.test(ziffernUndTrenner)) return null

  const letzterPunkt = ziffernUndTrenner.lastIndexOf('.')
  const letztesKomma = ziffernUndTrenner.lastIndexOf(',')
  const letzterTrenner = Math.max(letzterPunkt, letztesKomma)

  if (letzterTrenner < 0) {
    const zahl = Number(ziffernUndTrenner)
    return Number.isFinite(zahl) ? vorzeichen * zahl : null
  }

  const nachkommastellen = ziffernUndTrenner.length - letzterTrenner - 1

  // Drei Stellen dahinter: Das war eine Tausendergruppe, keine Nachkommastelle.
  if (nachkommastellen === 3) {
    const zahl = Number(ziffernUndTrenner.replace(/[.,]/g, ''))
    return Number.isFinite(zahl) ? vorzeichen * zahl : null
  }

  const ganz = ziffernUndTrenner.slice(0, letzterTrenner).replace(/[.,]/g, '')
  const bruch = ziffernUndTrenner.slice(letzterTrenner + 1)
  const zahl = Number(`${ganz === '' ? '0' : ganz}.${bruch}`)
  return Number.isFinite(zahl) ? vorzeichen * zahl : null
}
