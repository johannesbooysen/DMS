/**
 * Wartecontainer: ein Beleg wartet auf ein externes Ereignis -- mit
 * Wiedervorlage, und er läuft erst weiter, wenn jemand das Ergebnis
 * einträgt.
 *
 * Eigener Beleg RE-2026-0005 (nach der Klärung bei der Buchhaltung); die
 * Datei läuft nach `klaerung.spec.ts` und vor `zahlung.spec.ts`, das D4
 * fährt. Am Ende ist der Container geschlossen, damit nichts liegen bleibt.
 */

import { expect, test } from '@playwright/test'
import { anmelden, belegOeffnen, BENUTZER, navigiere } from './anmeldung'

const BELEG = 'Musterreinigung GmbH · RE-2026-0005'

test('Ein Beleg wartet auf die Versicherung -- und läuft weiter, wenn das Ergebnis da ist', async ({ page }) => {
  await anmelden(page, BENUTZER.bernd)
  await belegOeffnen(page, BELEG)

  await test.step('Warten beginnen, mit Wiedervorlage', async () => {
    const formular = page.locator('form').filter({ has: page.locator('input[name=art]') })
    // Zusammengeklappt, bis jemand es braucht.
    const klappe = page.locator('details').filter({ has: formular })
    if ((await klappe.count()) > 0 && !(await klappe.evaluate((d) => (d as unknown as { open: boolean }).open))) {
      await klappe.locator('summary').click()
    }
    await formular.locator('input[name=art]').fill('zur Erstattung Vers.RE')
    await formular.locator('select[name=ereignis]').selectOption('versicherungszahlung')
    await formular.locator('input[name=erwarteterBetrag]').fill('500,00')
    await formular.locator('input[name=wiedervorlageAm]').fill('2026-11-30')
    await formular.getByRole('button', { name: 'Warten beginnen' }).click()
    await expect(page.getByText('zur Erstattung Vers.RE').first()).toBeVisible()
  })

  await test.step('Die Warteliste führt ihn mit Wiedervorlage', async () => {
    await navigiere(page, 'Warten')
    // Die Warteliste nennt den Kreditor, nicht die Nummer -- die Zeile mit dem Container.
    const zeile = page.getByRole('row', { name: /Musterreinigung GmbH/ }).filter({ hasText: 'zur Erstattung Vers.RE' })
    await expect(zeile).toBeVisible()
    await expect(zeile).toContainText('30.11.2026')
  })

  await test.step('Ergebnis eintragen -- der Beleg wartet nicht mehr', async () => {
    const zeile = page.getByRole('row', { name: /Musterreinigung GmbH/ }).filter({ hasText: 'zur Erstattung Vers.RE' })
    await zeile.locator('input[name=ergebnis]').fill('Versicherung hat 500,00 EUR erstattet')
    await zeile.getByRole('button').click()
    await expect(page.getByText('Kein Beleg wartet.')).toBeVisible()
  })
})

test('Ohne Wiedervorlage beginnt kein Warten', async ({ page }) => {
  await anmelden(page, BENUTZER.bernd)
  await belegOeffnen(page, BELEG)
  const formular = page.locator('form').filter({ has: page.locator('input[name=art]') })
  const klappe = page.locator('details').filter({ has: formular })
  if ((await klappe.count()) > 0 && !(await klappe.evaluate((d) => (d as unknown as { open: boolean }).open))) {
    await klappe.locator('summary').click()
  }
  await formular.evaluate((f) => ((f as unknown as { noValidate: boolean }).noValidate = true))
  await formular.locator('input[name=art]').fill('ohne Datum')
  await formular.getByRole('button', { name: 'Warten beginnen' }).click()
  await expect(page.getByRole('alert').filter({ hasText: /Wiedervorlage/ })).toBeVisible()
})
