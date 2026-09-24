/**
 * Die manuelle Zuordnung: Ein Beleg ohne erkannte Angaben verschwindet
 * nicht, sondern steht unter "Ohne Zuständigkeit" -- und nach dem
 * Nachtragen bei der Objektverantwortlichen.
 *
 * Der Testlauf hat keine Extraktion; jeder Upload kommt ohne Objekt und
 * ohne Kreditor an. Genau der Fall, an dem der erste echte Scan beim
 * Bedienen verschwand.
 */

import { expect, test } from '@playwright/test'
import { pdfBauen } from '../tests/hilfe/pdf-bauen'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

const KENNWORT = 'Aufzugswartung'

test.setTimeout(120_000)

test('Ein Beleg ohne Angaben steht unter "Ohne Zuständigkeit" -- und nach dem Nachtragen bei Anna', async ({ page }) => {
  const pdf = await pdfBauen([
    { zeilen: ['Liftbau Nord GmbH', 'Rechnung RE-2026-0990 vom 12.09.2026', `${KENNWORT} Objekt 42`] },
  ])

  await anmelden(page, BENUTZER.bernd)
  await navigiere(page, 'Posteingang')
  await page.getByLabel('Dateien').setInputFiles({ name: 'aufzug.pdf', mimeType: 'application/pdf', buffer: pdf })
  await page.getByRole('button', { name: 'Aufnehmen' }).click()
  await page.waitForURL('**/beleg/*')

  await test.step('Die Aufgabe hat niemanden -- sie steht unter "Ohne Zuständigkeit"', async () => {
    await expect(async () => {
      await page.goto('/postfach')
      await expect(page.getByRole('heading', { name: /Ohne Zuständigkeit \(\d+\)/ })).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 60_000 })
  })

  await test.step('Am Arbeitsplatz steht das Formular vor der Entscheidung', async () => {
    await page.getByRole('link', { name: 'Angaben nachtragen' }).first().click()
    await page.waitForURL('**/arbeitsplatz/*')
    const formular = page.getByRole('region', { name: 'Angaben nachtragen' })
    await expect(formular).toBeVisible()
    await formular.locator('select[name=objektId]').selectOption('50000000-0000-0000-0000-000000000042')
    await formular.locator('select[name=kreditorId]').selectOption({ label: 'Musterreinigung GmbH' })
    await formular.locator('input[name=rechnungsnummer]').fill('RE-2026-0990')
    await formular.locator('input[name=rechnungsdatum]').fill('2026-09-12')
    await formular.locator('input[name=brutto]').fill('595,00')
    await formular.getByRole('button', { name: 'Angaben übernehmen' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Bearbeiter/ })).toBeVisible()
  })

  await test.step('Anna hat ihn jetzt persönlich', async () => {
    await page.goto('/postfach')
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await anmelden(page, BENUTZER.anna)
    await navigiere(page, 'Postfächer')
    const persoenlich = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Persönlich/ }) })
    await expect(persoenlich.getByRole('link', { name: /Musterreinigung GmbH · RE-2026-0990/ })).toBeVisible()
  })
})
