/**
 * Berechtigungs-Presets in der Oberfläche (Konzept §24.13).
 *
 * Der Unit-Test belegt, dass ein Preset ergänzt und nichts wegnimmt. Hier
 * zeigt sich, ob Anmeldung, Sitzung, RLS, Serveraktion und Umleitung
 * zusammen tragen — und ob die Rückmeldung brauchbar ist. Sie ist der
 * eigentliche Ertrag der Maske: Ohne die Meldung, welche Stempelkurzcodes
 * ohne Typ geblieben sind, stünden Rollen da, mit denen niemand stempeln
 * kann.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test('Eva sieht die Presets und bekommt eine Bilanz zurück', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Stammdaten')
  await page.getByRole('link', { name: 'Benutzer und Rollen' }).click()
  await page.waitForURL(/\/stammdaten\/benutzer/)

  await expect(page.getByRole('heading', { name: 'Berechtigungs-Presets' })).toBeVisible()
  // Genau, sonst trifft der Selektor auch die Beschreibung der
  // Mietverwaltung ('Wie die WEG-Verwaltung, aber ...').
  await expect(page.getByText('WEG-Verwaltung', { exact: true })).toBeVisible()

  // Das Haus im Seed ist bereits nach dem WEG-Zuschnitt eingerichtet --
  // also darf nichts hinzukommen. Genau das soll die Bilanz sagen.
  await page
    .locator('form')
    .filter({ has: page.locator('input[value="weg"]') })
    .getByRole('button', { name: 'Anwenden' })
    .click()

  await expect(page.getByRole('status')).toContainText('Keine neue Rolle nötig')
})

test('Anna sieht die Presets gar nicht erst', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await page.goto('/stammdaten/benutzer')

  /*
   * Der ausgeblendete Abschnitt ist Bequemlichkeit, keine Sicherheit -- die
   * Grenze zieht die Policy, und das belegen die Unit-Tests. Hier wird
   * geprueft, dass die Maske nicht anbietet, was sie nicht kann.
   */
  await expect(page.getByRole('heading', { name: 'Berechtigungs-Presets' })).toHaveCount(0)
})
