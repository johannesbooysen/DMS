/**
 * Der Arbeitsplatz: Liste, Beleg, Entscheidung -- nebeneinander.
 *
 * Geprüft wird die geteilte Ansicht als Ganzes: dass die Liste links die
 * eigenen Aufgaben zeigt, die Mitte den Beleg, die rechte Spalte die
 * Entscheidung -- und dass die Tastatur zwischen Aufgaben wechselt, ohne
 * dass die Liste verschwindet.
 *
 * **Bewusst ohne Stempel.** Jeder Seed-Beleg, den Anna hier sieht, gehört
 * einem anderen Test: RE-2026-0001 dem Stempeltest, RE-2026-0004 der
 * Zahlung, das Schreiben dem Schriftverkehr. Die Dateien teilen sich eine
 * Datenbank; ein Stempel hier wäre ein Fehler dort. Dass der Stempel vom
 * Arbeitsplatz aus dieselbe Aktion nimmt wie von der Aufgabenseite, steht
 * im Quelltext (`herkunft`), nicht in einem zweiten Browsertest.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

const RECHNUNG = 'Musterreinigung GmbH · RE-2026-0004'
const SCHREIBEN = 'Bauordnungsamt Musterstadt · Anhoerung zur Nutzungsaenderung'

test('Anna sieht Liste, Beleg und Entscheidung nebeneinander', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Arbeitsplatz')

  const liste = page.getByRole('navigation', { name: 'Aufgaben' })
  await expect(liste.getByRole('link', { name: new RegExp(RECHNUNG) })).toBeVisible()
  await expect(liste.getByRole('link', { name: new RegExp(SCHREIBEN) })).toBeVisible()

  // Die erste persönliche Aufgabe ist aufgeschlagen: Beleg in der Mitte,
  // Entscheidung rechts -- als Entscheidung benannt, ohne Zielfeld.
  const entscheidung = page.getByRole('complementary', { name: 'Entscheidung' })
  await expect(entscheidung.getByRole('heading', { level: 2 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Beleg' }).getByRole('img').first()).toBeVisible()
  await expect(page.getByLabel(/weiter an|empfänger|zuständig/i)).toHaveCount(0)
})

test('Die Rechnung öffnet sich in derselben Ansicht, die Liste bleibt', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Arbeitsplatz')

  const liste = page.getByRole('navigation', { name: 'Aufgaben' })
  await liste.getByRole('link', { name: new RegExp(RECHNUNG) }).click()

  const entscheidung = page.getByRole('complementary', { name: 'Entscheidung' })
  await expect(entscheidung.getByRole('heading', { name: 'Sachliche Pruefung' })).toBeVisible()
  await expect(entscheidung.getByRole('button', { name: 'Sachlich richtig' })).toBeVisible()
  await expect(entscheidung.getByRole('button', { name: 'Zur Klaerung' })).toBeVisible()
  await expect(entscheidung.getByRole('button', { name: 'Abgelehnt' })).toBeVisible()

  // Die Liste steht noch, und der geöffnete Eintrag ist markiert.
  await expect(liste.getByRole('link', { name: new RegExp(RECHNUNG) })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('Pfeiltasten wechseln die Aufgabe', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Arbeitsplatz')

  const liste = page.getByRole('navigation', { name: 'Aufgaben' })
  // Erst steht die erste Aufgabe (der Einstieg leitet dorthin um), dann
  // haengt der Zuhoerer -- vorher ginge der Tastendruck ins Leere.
  await page.waitForURL('**/arbeitsplatz/*')
  await expect(liste).toHaveAttribute('data-tastatur', 'bereit')
  const vorher = page.url()
  // Welche Aufgabe zuerst steht, entscheidet die Datenbank, nicht der Test:
  // Gezaehlt wird, dass die Markierung mit der Adresse wandert -- hin und
  // wieder zurueck.
  const aktiv = liste.locator('a[aria-current="page"]')
  const erste = await aktiv.getAttribute('href')

  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.url()).not.toBe(vorher)
  await expect(aktiv).toHaveAttribute('href', new URL(page.url()).pathname)
  await expect(aktiv).not.toHaveAttribute('href', erste ?? '')

  await page.keyboard.press('ArrowUp')
  await expect.poll(() => page.url()).toBe(vorher)
  await expect(aktiv).toHaveAttribute('href', erste ?? '')
})
