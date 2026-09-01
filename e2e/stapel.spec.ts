/**
 * Stapelscan mit Belegtrennung.
 *
 * Konzept 24.1 nennt den Grund für die ganze Bauart: „Nachträglich unangenehm,
 * weil Seiten und Hashes dann schon geschrieben sind." Und den Grund für die
 * Korrekturoberfläche gleich mit: **Ein falsch getrennter Stapel erzeugt
 * zwanzig falsche Belege auf einmal.**
 *
 * Deshalb prüft dieser Test drei Dinge, die zusammen die Zusage ergeben:
 *
 *   1. Bis zur Übernahme entsteht **kein** Dokument.
 *   2. Die vorgeschlagene Trennung lässt sich von Hand ändern — und die
 *      Anzahl der Belege ändert sich sichtbar mit.
 *   3. Erst beim Übernehmen entstehen die Belege, und zwar so viele wie
 *      angezeigt.
 */

import { expect, test } from '@playwright/test'
import { pdfBauen } from '../tests/hilfe/pdf-bauen'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test.setTimeout(120_000)
test.describe.configure({ mode: 'serial' })

/** Drei Belege, getrennt durch zwei Trennblätter. */
const STAPEL = [
  { zeilen: ['Bedachungen Nord GmbH', 'Rechnung RS-2026-0001', 'Stapelprobe Alpha'] },
  { zeilen: ['Trennblatt'] },
  { zeilen: ['Gartenbau Sued', 'Rechnung RS-2026-0002', 'Stapelprobe Beta'] },
  { zeilen: ['Trennblatt'] },
  { zeilen: ['Elektro Mitte', 'Rechnung RS-2026-0003', 'Stapelprobe Gamma'] },
]

test('Ein Stapel wird getrennt, korrigiert und übernommen', async ({ page }) => {
  const pdf = await pdfBauen(STAPEL)

  await anmelden(page, BENUTZER.anna)

  await test.step('Als Stapelscan hochladen', async () => {
    await navigiere(page, 'Posteingang')
    await page.getByLabel('Datei').setInputFiles({
      name: 'scan-2026-09-01.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    })
    await page.getByLabel(/Stapelscan/).check()
    await page.getByRole('button', { name: 'Aufnehmen' }).click()
  })

  await test.step('Der Worker bereitet ihn auf — bis dahin steht es auf der Seite', async () => {
    await expect(async () => {
      await navigiere(page, 'Posteingang')
      await page.getByRole('link', { name: /scan-2026-09-01/ }).click()
      await expect(page.getByRole('button', { name: /Belege übernehmen/ })).toBeVisible({
        timeout: 3_000,
      })
    }).toPass({ timeout: 90_000 })
  })

  await test.step('Zwei Trennblätter erkannt, also drei Belege', async () => {
    await expect(page.getByRole('button', { name: '3 Belege übernehmen' })).toBeVisible()
  })

  await test.step('Eine Trennung von Hand aufheben — es werden zwei', async () => {
    /*
     * **Der eigentliche Grund für die Oberfläche.** Ein Trennblatt, das der
     * Scanner nicht erkannt hat, oder eines zu viel: Ohne diesen Griff
     * entstünden aus einem Stapel falsche Belege, und danach sind Seiten und
     * Hashes geschrieben.
     */
    await page.getByRole('button', { name: 'Trennung aufheben' }).first().click()
    await expect(page.getByRole('button', { name: '2 Belege übernehmen' })).toBeVisible()
  })

  await test.step('Bis hierher gibt es keinen einzigen Beleg', async () => {
    await navigiere(page, 'Belege')
    await page.getByLabel('Volltext').fill('Stapelprobe')
    await page.getByRole('button', { name: 'Suchen' }).click()

    // Konzept 24.1: Erst beim Übernehmen entstehen Dokumente.
    await expect(page.getByText(/Stapelprobe/)).toHaveCount(0)
  })

  await test.step('Übernehmen — jetzt entstehen sie', async () => {
    await navigiere(page, 'Posteingang')
    await page.getByRole('link', { name: /scan-2026-09-01/ }).click()
    await page.getByRole('button', { name: '2 Belege übernehmen' }).click()

    await expect(page.getByText(/Dieser Stapel ist übernommen/)).toBeVisible()
  })

  await test.step('Und zwar zwei, jeder mit eigenem Text', async () => {
    await expect(async () => {
      await navigiere(page, 'Belege')
      await page.getByLabel('Volltext').fill('Stapelprobe')
      await page.getByRole('button', { name: 'Suchen' }).click()
      expect(await page.getByText(/Stapelprobe/).count()).toBe(2)
    }).toPass({ timeout: 90_000 })
  })
})
