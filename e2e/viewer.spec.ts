/**
 * Der Viewer: Was jemand sieht, der einen Beleg öffnet.
 *
 * Konzept 1 macht dazu eine Zusage, die sich nur im Browser prüfen lässt:
 * **Die erste Seite kommt als fertiges Bild.** Kein Rendern beim Öffnen, kein
 * PDF im Hintergrund — das PDF holt der Browser erst, wenn jemand es
 * ausdrücklich anfordert.
 *
 * Genau das wird hier nachgesehen: Beim Öffnen fließt ein Bild und **kein**
 * PDF über die Leitung. Ein Unit-Test kann das nicht wissen; er sieht die
 * Anfragen nicht, die ein Browser stellt.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER } from './anmeldung'

const BELEG = 'Musterreinigung GmbH · RE-2026-0001'

test('Die Seite kommt als Bild, das PDF bleibt liegen', async ({ page }) => {
  const geholt: string[] = []
  page.on('request', (a) => geholt.push(new URL(a.url()).pathname))

  await anmelden(page, BENUTZER.anna)
  await page.getByRole('link', { name: 'Belege' }).click()
  await page.getByRole('link', { name: BELEG }).first().click()

  await expect(page.getByRole('heading', { name: new RegExp(BELEG.split(' · ')[0]) })).toBeVisible()

  const bild = page.getByRole('img', { name: 'Seite 1' })
  await expect(bild).toBeVisible()

  // Nicht nur "ein img-Element ist da": Ein kaputtes Bild ist auch sichtbar.
  // Die natürliche Breite verrät, ob wirklich etwas geladen wurde.
  await expect
    // `naturalWidth` statt eines DOM-Typs: Die tsconfig kennt bewusst keine
    // Browser-Typen -- der Anwendungscode laeuft auf dem Server.
    .poll(() => bild.evaluate((e) => (e as unknown as { naturalWidth: number }).naturalWidth))
    .toBeGreaterThan(200)

  expect(geholt.some((p) => p.includes('/seite/1'))).toBe(true)
  // Die Zusage aus Konzept 1: kein PDF beim Öffnen.
  expect(geholt.filter((p) => p.endsWith('/pdf'))).toEqual([])
})

test('Das PDF kommt erst, wenn jemand es anfordert', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await page.getByRole('link', { name: 'Belege' }).click()
  await page.getByRole('link', { name: BELEG }).first().click()

  const ziel = await page.getByRole('link', { name: 'Original-PDF öffnen' }).getAttribute('href')
  expect(ziel).not.toBeNull()

  const antwort = await page.request.get(String(ziel))
  expect(antwort.status()).toBe(200)
  expect(antwort.headers()['content-type']).toContain('pdf')

  // Wirklich ein PDF und nicht eine Fehlerseite mit dem richtigen Kopf.
  expect((await antwort.body()).subarray(0, 4).toString()).toBe('%PDF')
})

test('Ein Beleg ohne Datei verschluckt sich nicht', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await page.getByRole('link', { name: 'Belege' }).click()

  // D3 hat bewusst keine Datei bekommen -- so etwas gibt es im Betrieb, etwa
  // aus einer Altübernahme. Die Liste muss trotzdem stehen.
  await expect(page.getByRole('heading', { name: 'Belege' })).toBeVisible()
  const zeilen = page.getByRole('link', { name: /·/ })
  expect(await zeilen.count()).toBeGreaterThan(1)
})

test('Der Seitentext ist durchsuchbar', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await page.getByRole('link', { name: 'Belege' }).click()

  /*
   * „Umsatzsteuer" steht **nur** im PDF — nicht in den Stammdaten und nicht
   * im Seitentext des Seeds. Wer den Beleg darüber findet, hat den Text
   * gefunden, den die Aufbereitung aus dem PDF gewonnen hat.
   *
   * Der erste Entwurf suchte nach „Hausreinigung". Das stand schon im Seed —
   * der Test wäre auch dann grün gewesen, wenn die Aufbereitung gar nicht
   * gelaufen wäre. Genau so ist er einmal grün gewesen.
   */
  await page.getByLabel('Volltext').fill('Umsatzsteuer')
  await page.getByRole('button', { name: 'Suchen' }).click()

  await expect(page.getByRole('link', { name: BELEG }).first()).toBeVisible()
})
