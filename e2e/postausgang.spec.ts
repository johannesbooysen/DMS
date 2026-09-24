/**
 * Das Ausgangsbuch: Nichts verlässt das Haus daran vorbei -- und ohne
 * eingerichteten Versand bleibt es sichtbar liegen, statt still zu
 * verschwinden.
 *
 * Der Testlauf hat bewusst kein SMTP_URL. Ein Einsichtslink mit Adresse
 * legt einen Eintrag an, der Postausgang zeigt ihn als offen, und die Seite
 * sagt, warum nichts hinausgeht.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test('Ein Einsichtslink mit Adresse steht im Ausgangsbuch -- offen, weil kein Versand eingerichtet ist', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Einsicht')

  await page.getByLabel(/Per Mail an/).fill('beirat@example.invalid')
  await page.getByRole('button', { name: 'Zugang anlegen' }).click()
  await expect(page.getByRole('row', { name: /Meike Meier|Beirat|beirat/ }).first()).toBeVisible()

  await navigiere(page, 'Postausgang')
  await expect(page.getByText(/Kein Mailversand eingerichtet/)).toBeVisible()
  const zeile = page.getByRole('row', { name: /beirat@example.invalid/ }).first()
  await expect(zeile).toBeVisible()
  await expect(zeile).toContainText('offen')
})

test('Anna sieht das Ausgangsbuch ihres Hauses, Doris nicht dessen Einträge', async ({ page }) => {
  await anmelden(page, BENUTZER.doris)
  await navigiere(page, 'Postausgang')
  await expect(page.getByRole('row', { name: /beirat@example.invalid/ })).toHaveCount(0)
})
