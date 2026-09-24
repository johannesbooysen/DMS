/**
 * Der Fehlerkorb: Was die Aufbereitung nicht schafft, ist sichtbar -- mit
 * Grund, mit roter Zahl in der Navigation, und mit einem Ausgang, der auf
 * den Beleg wirkt.
 *
 * Der Weg führt durch die Warteschlange: Ein PDF ohne Textlayer (ein
 * Scan, nur ein Bild) wird aufgenommen; der Testlauf hat keine
 * Texterkennung eingerichtet, und der Worker **meldet** das in den Korb,
 * statt zu werfen -- Tesseract installiert sich nicht durch einen zweiten
 * Versuch. Genau diese Kette -- Anwendung, Warteschlange, Worker, Korb --
 * prüft kein Unit-Test.
 */

import { createCanvas } from '@napi-rs/canvas'
import { expect, test } from '@playwright/test'
import { pdfBauen } from '../tests/hilfe/pdf-bauen'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test.setTimeout(180_000)

test('Ein Scan ohne Textlayer landet im Fehlerkorb -- und geht von Hand weiter', async ({ page }) => {
  const leinwand = createCanvas(400, 300)
  const kontext = leinwand.getContext('2d')
  kontext.fillStyle = '#ffffff'
  kontext.fillRect(0, 0, 400, 300)
  kontext.fillStyle = '#333333'
  kontext.fillRect(40, 40, 320, 20)
  const scan = await pdfBauen([{ zeilen: [], bild: await leinwand.encode('png') }])

  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Posteingang')
  await page.getByLabel('Dateien').setInputFiles({ name: 'scan-ohne-text.pdf', mimeType: 'application/pdf', buffer: scan })
  await page.getByRole('button', { name: 'Aufnehmen' }).click()

  await test.step('Der Korb füllt sich, sobald die Warteschlange aufgibt', async () => {
    await expect(async () => {
      await page.goto('/fehlerkorb')
      await expect(page.getByRole('heading', { name: /Aufgegeben \(\d+\)/ })).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 120_000 })
    // Die Zahl in der Navigation -- rot, weil liegengeblieben.
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).locator('.zaehler--ueberfaellig')).toBeVisible()
  })

  await test.step('Von Hand weiter: der Eintrag ist erledigt, der Beleg läuft', async () => {
    await expect(page.getByRole('button', { name: 'von Hand' }).first()).toBeVisible()
    const vorher = await page.getByRole('button', { name: 'von Hand' }).count()
    await page.getByRole('button', { name: 'von Hand' }).first().click()
    await expect(page.getByRole('button', { name: 'von Hand' })).toHaveCount(vorher - 1)
  })
})
