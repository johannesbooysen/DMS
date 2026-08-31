/**
 * Ein `date` aus PostgreSQL als `YYYY-MM-DD`.
 *
 * Diese Datei gibt es, weil dieselbe Falle inzwischen viermal zugeschlagen
 * hat — jedes Mal in anderer Gestalt, jedes Mal mit einem falschen Datum als
 * Ergebnis:
 *
 *   1. Zahlungsziel: `Date`-Objekt in eine Zeichenkettenfunktion gegeben.
 *   2. Aufbewahrungsfrist: aus dem 31.12. wurde der 30.12. — ein Tag zu früh
 *      gelöscht.
 *   3. Rechnungsdatum in der Objektakte: `2026-03-13T23:00Z` für den 14. März.
 *   4. Gültigkeit einer Einsicht: `String(date).slice(0, 10)` ergibt
 *      `"Mon Sep 07"`, und daraus macht `new Date(…)` das Jahr **2001**.
 *
 * Der Grund ist immer derselbe: `node-postgres` macht aus einem `date` ein
 * `Date` in der Zeitzone des Servers — Mitternacht **lokal**. Wer daraus über
 * `toISOString()` oder über die Zeichenkettenform ein Datum gewinnt, greift
 * an der falschen Stelle zu.
 *
 * Erste Wahl bleibt `to_char(spalte, 'YYYY-MM-DD')` in der Abfrage. Wo das
 * nicht geht — etwa weil eine SQL-Funktion `date` zurückgibt und ihre
 * Signatur nicht dafür geändert werden soll —, steht diese Datei.
 */

/**
 * Liest ein Datum aus dem, was pg geliefert hat.
 *
 * Bei einem `Date` werden **lokale** Feldwerte genommen, nicht `toISOString`:
 * pg hat Mitternacht lokal gemeint, und in jeder Zeitzone östlich von
 * Greenwich läge der UTC-Zeitpunkt am Vortag.
 */
export function alsDatum(wert: unknown): string | null {
  if (wert === null || wert === undefined) return null

  if (wert instanceof Date) {
    const jahr = wert.getFullYear()
    const monat = String(wert.getMonth() + 1).padStart(2, '0')
    const tag = String(wert.getDate()).padStart(2, '0')
    return `${jahr}-${monat}-${tag}`
  }

  const text = String(wert)
  // Schon in der richtigen Form (etwa aus `to_char`): unverändert lassen.
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text
}

/** Ein Zeitstempel als ISO-8601, oder `null`. */
export function alsZeitpunkt(wert: unknown): string | null {
  if (wert === null || wert === undefined) return null
  return wert instanceof Date ? wert.toISOString() : String(wert)
}
