/**
 * Klärung: hinein mit Kommentar und Wiedervorlage, heraus mit dem nächsten
 * Stempel.
 *
 * Geprüft wird der ganze Weg durch die Oberfläche: Die Maske verlangt beides,
 * der Beleg erscheint im Klärungspostfach mit Kommentar und Datum, die
 * Aufgabe bleibt am Arbeitsplatz offen -- und nach „Sachlich richtig" ist die
 * Klärung zu, der Beleg bei der Buchhaltung. Eigener Beleg RE-2026-0005
 * (`belege-anlegen.ts`): Jede Testdatei, die einen Beleg verändert, braucht
 * ihren eigenen.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

const BELEG = 'Musterreinigung GmbH · RE-2026-0005'

test('Ohne Kommentar und Wiedervorlage gibt es keine Klärung', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Arbeitsplatz')
  await page.getByRole('navigation', { name: 'Aufgaben' }).getByRole('link', { name: BELEG }).click()

  const entscheidung = page.getByRole('complementary', { name: 'Entscheidung' })
  await expect(entscheidung.getByRole('heading', { name: 'Sachliche Pruefung' })).toBeVisible()
  await entscheidung.getByRole('button', { name: 'Zur Klaerung' }).click()

  // Abgewiesen, mit Grund -- und die Aufgabe steht noch.
  // Next legt eine zweite Live-Region an (Routenansage); die Meldung ist die mit dem Grund.
  await expect(page.getByRole('alert').filter({ hasText: /Kommentar|Wiedervorlage/ })).toBeVisible()
  await expect(entscheidung.getByRole('button', { name: 'Zur Klaerung' })).toBeVisible()
})

test('Mit beidem landet der Beleg im Klärungspostfach -- und kommt mit dem nächsten Stempel wieder heraus', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Arbeitsplatz')
  await page.getByRole('navigation', { name: 'Aufgaben' }).getByRole('link', { name: BELEG }).click()

  const entscheidung = page.getByRole('complementary', { name: 'Entscheidung' })
  await test.step('Zur Klärung geben', async () => {
    await entscheidung.getByLabel('Kommentar').fill('Leistungszeitraum beim Lieferanten nachfragen')
    await entscheidung.getByLabel(/Wiedervorlage/).fill('2026-10-15')
    await entscheidung.getByRole('button', { name: 'Zur Klaerung' }).click()
  })

  await test.step('Das Klärungspostfach zeigt ihn mit Kommentar und Datum', async () => {
    await navigiere(page, 'Postfächer')
    await expect(page.getByRole('heading', { name: 'Klärung (1)' })).toBeVisible()
    await expect(page.getByText('Leistungszeitraum beim Lieferanten nachfragen')).toBeVisible()
    await expect(page.getByText('15.10.2026')).toBeVisible()
  })

  await test.step('Die Aufgabe bleibt offen -- und der nächste Stempel beendet die Klärung', async () => {
    await navigiere(page, 'Arbeitsplatz')
    const liste = page.getByRole('navigation', { name: 'Aufgaben' })
    await liste.getByRole('link', { name: BELEG }).click()
    await expect(entscheidung.getByRole('heading', { name: 'Sachliche Pruefung' })).toBeVisible()
    await entscheidung.getByLabel('Kommentar').fill('Lieferant hat den Zeitraum bestätigt')
    await entscheidung.getByRole('button', { name: 'Sachlich richtig' }).click()

    await navigiere(page, 'Postfächer')
    await expect(page.getByRole('heading', { name: 'Klärung (0)' })).toBeVisible()
    await expect(page.getByRole('link', { name: BELEG })).toHaveCount(0)
  })

  await test.step('Bernd hat ihn jetzt zur rechnerischen Prüfung', async () => {
    await page.goto('/postfach')
    await page.getByRole('button', { name: 'Abmelden' }).click()
    await anmelden(page, BENUTZER.bernd)
    await navigiere(page, 'Postfächer')
    await expect(page.getByRole('link', { name: BELEG })).toBeVisible()
  })
})
