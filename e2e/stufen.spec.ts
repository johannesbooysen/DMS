/**
 * „Wo steht was": Amagnos Ordnerbaum mit Zählern, ohne Ordner.
 *
 * Die Zahlen sind das, was jemand aus Amagno zuerst sucht: wie viele Belege
 * in welcher Stufe stehen. Geprüft wird, dass die Zahl zur Liste passt, die
 * ein Klick darunter zeigt -- und dass ein fremder Mandant weder Zahl noch
 * Zeile sieht. Nur lesend.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test('Eva sieht die Stufen mit Zahlen, und ein Klick zeigt die Belege dahinter', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Wo steht was')

  const unterwegs = page.locator('.kennzahl').filter({ hasText: 'Belege unterwegs' }).locator('strong')
  await expect(unterwegs).not.toHaveText('0')

  const stufen = page.getByRole('navigation', { name: 'Stufen' })
  const erste = stufen.getByRole('link').first()
  const zahl = Number((await erste.innerText()).match(/(\d+)\s*$/)?.[1] ?? '0')
  await erste.click()

  // Die Überschrift nennt die Stufe, die Liste hat so viele Zeilen wie die Zahl sagt.
  await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /Pruefung|Kontierung|Zahlung|Kenntnis/ }).first()).toBeVisible()
  if (zahl > 0) {
    await expect(page.getByRole('table').getByRole('link')).toHaveCount(zahl)
  }
})

test('Doris sieht aus Nord weder Zahl noch Zeile', async ({ page }) => {
  await anmelden(page, BENUTZER.doris)
  await navigiere(page, 'Wo steht was')
  await expect(page.getByText(/Musterreinigung|Bauordnungsamt/)).toHaveCount(0)
})
