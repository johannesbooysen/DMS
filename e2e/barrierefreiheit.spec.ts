/**
 * Barrierefreiheit, gemessen statt beurteilt.
 *
 * Über Gestaltung lässt sich streiten; über einen Kontrast von 3,1:1 nicht.
 * `axe-core` prüft, was sich prüfen lässt — Kontraste, fehlende
 * Beschriftungen, Formularfelder ohne Label, Landmarken, unzulässige
 * ARIA-Attribute — und liefert dafür Zahlen statt Meinung.
 *
 * **Warum das hier steht und nicht in einem einmaligen Bericht:** Ein
 * Befund, den einmal jemand aufgeschrieben hat, ist nach dem nächsten
 * Formular wieder da. In der Suite bleibt er weg.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER } from './anmeldung'

/** Die Seiten, die die Tagesarbeit tragen. */
const SEITEN: Array<[pfad: string, name: string]> = [
  ['/postfach', 'Postfächer'],
  ['/posteingang', 'Posteingang'],
  ['/belege', 'Belege'],
  ['/auswertung', 'Auswertungen'],
  ['/archiv', 'Archiv'],
  ['/stammdaten', 'Stammdaten'],
  ['/stammdaten/benutzer', 'Benutzer und Rollen'],
  ['/notfall', 'Notfallzugriff'],
  ['/eingang', 'Eingangsquellen'],
  ['/postausgang', 'Postausgang'],
  ['/fehlerkorb', 'Fehlerkorb'],
  ['/konfiguration', 'Abläufe'],
]

const BERICHT = 'test-results/barrierefreiheit.txt'

for (const [pfad, name] of SEITEN) {
  test(`${name} (${pfad}) hat keine schweren Befunde`, async ({ page }) => {
    await anmelden(page, BENUTZER.eva)
    await page.goto(pfad)

    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    /*
     * Nur `serious` und `critical`. `minor` und `moderate` sind oft
     * Geschmacksfragen — eine Schwelle, die alles einschließt, wird nach
     * zwei Wochen hochgesetzt und ist dann keine mehr.
     */
    const schwer = ergebnis.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )

    /*
     * Die Befunde in eine Datei, nicht nach `console.log`: Playwright
     * schluckt die Ausgabe je nach Reporter, und ein Befund, den niemand
     * liest, ist keiner. Ein roter Test, der nur „1 ist nicht 0" sagt,
     * kostet den nächsten Leser eine halbe Stunde.
     */
    if (schwer.length > 0) {
      mkdirSync('test-results', { recursive: true })
      const zeilen: string[] = []
      for (const v of schwer) {
        zeilen.push(`== ${name} (${pfad}) [${v.impact}] ${v.id}`)
        zeilen.push(`   ${v.help}`)
        for (const k of v.nodes.slice(0, 4)) {
          zeilen.push(`   -> ${k.target.join(' ')}`)
          zeilen.push(`      ${(k.failureSummary ?? '').replace(/\s+/g, ' ')}`)
        }
      }
      appendFileSync(BERICHT, zeilen.join('\n') + '\n')
    }

    expect(schwer.map((v) => `${v.impact}: ${v.id}`)).toEqual([])
  })
}
