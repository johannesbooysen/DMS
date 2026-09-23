/**
 * Die Belegsuche: Treffer links, Beleg rechts -- ohne die Liste zu verlassen.
 *
 * Geprüft wird die geteilte Ansicht: dass die Liste die Belege der eigenen
 * Objekte zeigt, dass der erste Treffer rechts offen steht, dass ein Klick
 * den Beleg wechselt und die Liste bleibt, und dass die Pfeiltasten dasselbe
 * tun. Nur lesend -- die Belege gehören anderen Tests.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

const RECHNUNG = 'Musterreinigung GmbH · RE-2026-0004'

test('Anna sieht Treffer und Beleg nebeneinander', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')

  const treffer = page.getByRole('navigation', { name: 'Treffer' })
  await expect(treffer.getByRole('link', { name: new RegExp(RECHNUNG) })).toBeVisible()

  // Der erste Treffer ist offen: markiert in der Liste, rechts mit Kopf und
  // Seitenbild, und mit dem Weg in die volle Belegansicht.
  const offen = treffer.locator('a[aria-current="page"]')
  await expect(offen).toHaveCount(1)
  const vorschau = page.getByRole('region', { name: 'Vorschau' })
  await expect(vorschau.getByRole('heading', { level: 2 })).toContainText(
    (await offen.locator('.trefferliste-titel').innerText()).trim(),
  )
  await expect(vorschau.getByRole('link', { name: 'Belegansicht öffnen' })).toBeVisible()
})

test('Ein Klick wechselt den Beleg, die Liste bleibt', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')

  const treffer = page.getByRole('navigation', { name: 'Treffer' })
  await treffer.getByRole('link', { name: new RegExp(RECHNUNG) }).click()
  await page.waitForURL('**/belege?beleg=*')

  const vorschau = page.getByRole('region', { name: 'Vorschau' })
  await expect(vorschau.getByRole('heading', { name: new RegExp(RECHNUNG) })).toBeVisible()
  await expect(vorschau.getByRole('img', { name: 'Seite 1' })).toBeVisible()
  await expect(treffer.getByRole('link', { name: new RegExp(RECHNUNG) })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('Pfeiltasten wechseln den Treffer', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')

  const treffer = page.getByRole('navigation', { name: 'Treffer' })
  await expect(page.locator('.trefferliste-hinweis')).toHaveAttribute('data-tastatur', 'bereit')
  const aktiv = treffer.locator('a[aria-current="page"]')
  const erste = await aktiv.getAttribute('href')

  await page.keyboard.press('ArrowDown')
  await page.waitForURL('**/belege?beleg=*')
  const zweite = new URL(page.url())
  await expect(aktiv).toHaveAttribute('href', zweite.pathname + zweite.search)
  await expect(aktiv).not.toHaveAttribute('href', erste ?? '')

  await page.keyboard.press('ArrowUp')
  await expect(aktiv).toHaveAttribute('href', erste ?? '')
})
