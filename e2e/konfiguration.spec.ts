/**
 * Der Ablaufeditor: eine Stufe als Zeile anlegen, die Simulation zeigt sie.
 *
 * Geprüft wird der Weg, den ein Haus beim Einrichten geht: Entwurf aus der
 * aktiven Fassung, eine Systemaktion als neue Stufe (Vorlage plus feste
 * Adresse), und die Simulation rechts rechnet die Kette neu -- ohne dass
 * jemand die Fassung aktiviert. Aktiviert wird hier nicht: Die übrigen
 * Tests fahren den Seed-Ablauf, und eine sechste Stufe darin wäre ein
 * Fehler dort.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test('Eva legt einen Entwurf an und ergänzt eine Systemaktion -- die Simulation kennt sie', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Abläufe')

  await test.step('Entwurf aus der aktiven Fassung', async () => {
    await page.getByRole('button', { name: 'Entwurf anlegen' }).first().click()
    await page.waitForURL('**/konfiguration/*')
    await expect(page.getByRole('heading', { name: 'Stufe hinzufügen' })).toBeVisible()
  })

  await test.step('Eine Systemaktion als Zeile', async () => {
    const knopf = page.getByRole('button', { name: 'Stufe anlegen' })
    const formular = page.locator('form.stufenformular').filter({ has: knopf })
    await formular.locator('input[name=bezeichnung]').fill('Meldung an die Technik')
    await formular.locator('select[name=stufentyp]').selectOption('systemaktion')
    await formular.locator('select[name=saVorlage]').selectOption({ label: 'Meldung an die Technik-Datenbank' })
    await formular.locator('input[name=saAdresse]').fill('technik@example.invalid')
    await knopf.click()

    await expect(page.getByText('Meldung an die Technik', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Vorlage „technikmeldung“ an technik@example.invalid/)).toBeVisible()
  })

  await test.step('Die Simulation rechnet die Kette mit der neuen Stufe', async () => {
    await page.getByLabel('Rechnung über').fill('3000')
    await page.getByRole('button', { name: 'zeigen' }).click()
    await expect(page.locator('ol').getByRole('listitem').filter({ hasText: 'Meldung an die Technik' })).toBeVisible()
  })

  await test.step('Eine unvollständige Stufe wird abgewiesen -- mit Grund', async () => {
    const knopf = page.getByRole('button', { name: 'Stufe anlegen' })
    const formular = page.locator('form.stufenformular').filter({ has: knopf })
    await formular.locator('input[name=bezeichnung]').fill('Ohne Rolle')
    await formular.locator('select[name=zustaendigkeitTyp]').selectOption('rolle')
    await knopf.click()
    await expect(page.getByRole('alert').filter({ hasText: /braucht eine Auswahl/ })).toBeVisible()
  })
})

test('Anna sieht die Abläufe, aber keinen Entwurf-Knopf', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Abläufe')
  await expect(page.getByRole('heading', { name: 'Abläufe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entwurf anlegen' })).toHaveCount(0)
})
