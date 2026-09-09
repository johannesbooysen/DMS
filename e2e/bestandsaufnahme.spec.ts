/**
 * Bestandsaufnahme: jede Seite als Bild.
 *
 * **Kein Test, sondern ein Werkzeug.** Er behauptet nichts und schlägt nicht
 * fehl; er nimmt auf. Deshalb trägt er die Marke `@bilder` und läuft bei
 * `npm run e2e` **nicht** mit — sondern nur über `npm run bilder`.
 *
 * Der Grund für seine Existenz: 25 Seiten, und niemand hat sie je
 * nebeneinander gesehen. Eine Bestandsaufnahme findet erfahrungsgemäß die
 * Hälfte der Probleme, ohne dass jemand urteilen muss — leere Zustände,
 * überlaufende Tabellen, Spalten, die bei 1280 Pixeln abgeschnitten werden.
 *
 * Zwei Breiten, weil eine Verwaltung beides hat: das Notebook unterwegs und
 * den Bildschirm am Platz.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER } from './anmeldung'

const BREITEN = [
  { name: '1280', breite: 1280, hoehe: 900 },
  { name: '1920', breite: 1920, hoehe: 1080 },
]

/**
 * Wer welche Seite sieht, ist Teil der Aufnahme.
 *
 * Eva sieht am meisten — deshalb steht sie überall, wo es um den Bestand
 * geht. Anna zeigt, wie dieselbe Seite für jemanden ohne Verwaltungsrechte
 * aussieht; das ist der Zustand, in dem die meisten Menschen die Anwendung
 * benutzen.
 */
const SEITEN: Array<[pfad: string, name: string, wer: string]> = [
  ['/postfach', 'postfach', BENUTZER.anna],
  ['/posteingang', 'posteingang', BENUTZER.anna],
  ['/belege', 'belege', BENUTZER.anna],
  ['/warten', 'warten', BENUTZER.anna],
  ['/vertretung', 'vertretung', BENUTZER.anna],
  ['/stammdaten', 'stammdaten-annasicht', BENUTZER.anna],
  ['/auswertung', 'auswertung', BENUTZER.eva],
  ['/archiv', 'archiv', BENUTZER.eva],
  ['/stammdaten', 'stammdaten', BENUTZER.eva],
  ['/stammdaten/benutzer', 'stammdaten-benutzer', BENUTZER.eva],
  ['/stammdaten/vorlagen', 'stammdaten-vorlagen', BENUTZER.eva],
  ['/notfall', 'notfall', BENUTZER.eva],
  ['/eingang', 'eingangsquellen', BENUTZER.eva],
  ['/postausgang', 'postausgang', BENUTZER.eva],
  ['/fehlerkorb', 'fehlerkorb', BENUTZER.eva],
  ['/konfiguration', 'ablaeufe', BENUTZER.eva],
  ['/einsicht', 'einsicht', BENUTZER.eva],
]

test.describe('Bestandsaufnahme', { tag: '@bilder' }, () => {
  for (const { name: breiteName, breite, hoehe } of BREITEN) {
    for (const [pfad, name, wer] of SEITEN) {
      test(`${name} bei ${breiteName}`, async ({ page }) => {
        await page.setViewportSize({ width: breite, height: hoehe })
        await anmelden(page, wer)
        await page.goto(pfad)
        // Auf die Überschrift warten, sonst entsteht das Bild mitten im
        // Aufbau und zeigt eine halbe Seite.
        await expect(page.getByRole('heading').first()).toBeVisible()
        await page.screenshot({
          path: `bilder/${breiteName}/${name}.png`,
          fullPage: true,
        })
      })
    }
  }

  /*
   * Die Belegansicht getrennt: Sie ist die einzige Seite mit zwei Spalten
   * (Bild neben Formular) und damit die, bei der Breite wirklich weh tut.
   */
  for (const { name: breiteName, breite, hoehe } of BREITEN) {
    test(`beleg bei ${breiteName}`, async ({ page }) => {
      await page.setViewportSize({ width: breite, height: hoehe })
      await anmelden(page, BENUTZER.anna)
      await page.goto('/belege')
      await page.getByRole('link', { name: /RE-2026/ }).first().click()
      await page.waitForURL(/\/beleg\//)
      await expect(page.getByRole('heading').first()).toBeVisible()
      await page.screenshot({ path: `bilder/${breiteName}/beleg.png`, fullPage: true })
    })
  }
})
