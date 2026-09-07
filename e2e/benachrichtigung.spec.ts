/**
 * Benachrichtigungen im Browser (Konzept §24.9).
 *
 * Der Zähler ist die Hälfte, die ständig wirkt — und er lässt sich nur hier
 * prüfen: Er entsteht im Seitenrahmen, unter der Sitzung des Angemeldeten,
 * und muss dieselbe Zahl zeigen wie die Liste darunter.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test('Der Zähler am Postfach zeigt, was in der Liste steht', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Postfächer')

  const ueberschrift = await page
    .getByRole('heading', { name: /^Persönlich \(\d+\)$/ })
    .textContent()
  const ausListe = Number(/\((\d+)\)/.exec(ueberschrift ?? '')?.[1] ?? -1)
  expect(ausListe).toBeGreaterThan(0)

  /*
   * Die Zahl neben „Postfächer" in der Navigation. Zählte sie mehr als die
   * Liste zeigt, schickte sie jemanden suchen — deshalb läuft sie ohne
   * `security definer` unter derselben RLS.
   */
  const zaehler = page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByText(String(ausListe), { exact: true })
  await expect(zaehler).toBeVisible()
})

test('Doris hat nichts offen und sieht deshalb keine Zahl', async ({ page }) => {
  await anmelden(page, BENUTZER.doris)
  await navigiere(page, 'Postfächer')

  // Eine Null neben jedem Eintrag wäre Rauschen, und Rauschen macht die eine
  // Zahl unsichtbar, auf die es ankommt.
  await expect(page.getByRole('heading', { name: 'Persönlich (0)' })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Hauptnavigation' }).getByText('0', { exact: true }),
  ).toHaveCount(0)
})

test('Die Sammelmail lässt sich abschalten', async ({ page }) => {
  await anmelden(page, BENUTZER.clara)
  await navigiere(page, 'Postfächer')

  await expect(page.getByRole('heading', { name: 'Tägliche Übersicht' })).toBeVisible()
  await expect(page.getByText(/Belegdaten stehen nicht darin/)).toBeVisible()

  await page.getByLabel('Sammelmail').selectOption('nein')
  await page.getByLabel('Uhrzeit').selectOption('15')
  await page.getByRole('button', { name: 'Übernehmen' }).click()

  // Nach dem Neuladen steht die Auswahl noch da -- sonst wäre die
  // Einstellung ein Knopf ohne Wirkung.
  await expect(page.getByLabel('Sammelmail')).toHaveValue('nein')
  await expect(page.getByLabel('Uhrzeit')).toHaveValue('15')
})
