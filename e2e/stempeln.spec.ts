/**
 * Der erste Ende-zu-Ende-Test: Ein Beleg wandert.
 *
 * Er geht den Weg, der das System ausmacht — und der einzige, der sich nur
 * im Ganzen prüfen lässt:
 *
 *   anmelden → Postfach → Aufgabe → stempeln → der Beleg steht bei der
 *   nächsten Stufe, im Postfach eines anderen.
 *
 * **Die Zusage dahinter** (Konzept 8): Der Stempel trägt die *Entscheidung*,
 * nicht das Ziel. Es gibt kein Feld „weiter an" — wohin der Beleg geht,
 * leitet die Engine aus der Prozessdefinition ab. Genau das war der
 * Amagno-Fehler, den das Konzept behebt, und genau das ist von außen
 * sichtbar: Anna sieht drei Schaltflächen und keine Zieladresse.
 *
 * Jeder Teil davon ist einzeln geprüft — die Engine in `tests/engine`, die
 * Rechte in `tests/rls`, die Sitzung in `tests/anmeldung`. Dass sie
 * zusammenpassen, ist es nicht.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

/** Der Beleg aus dem Seed, der am Anfang seiner Kette steht. */
const BELEG = 'Musterreinigung GmbH · RE-2026-0001'

test.describe.configure({ mode: 'serial' })

test('Anna stempelt sachlich richtig, der Beleg geht an die Buchhaltung', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)

  await test.step('Die Aufgabe liegt in Annas persönlichem Postfach', async () => {
    await navigiere(page, 'Postfächer')
    await expect(page.getByRole('heading', { name: 'Postfächer' })).toBeVisible()
    await expect(page.getByRole('link', { name: BELEG })).toBeVisible()
  })

  await test.step('Die Maske zeigt Entscheidungen, kein Ziel', async () => {
    await page.getByRole('link', { name: BELEG }).click()
    await expect(page.getByRole('heading', { name: 'Sachliche Pruefung' })).toBeVisible()

    // Drei Ausgänge, alle als Entscheidung benannt.
    await expect(page.getByRole('button', { name: 'Sachlich richtig' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zur Klaerung' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abgelehnt' })).toBeVisible()

    // Und nirgends etwas, womit sich ein Empfänger wählen ließe. Wäre das
    // Feld da, wäre der Amagno-Fehler wieder da.
    await expect(page.getByLabel(/weiter an|empfänger|zuständig/i)).toHaveCount(0)
  })

  await test.step('Nach dem Stempeln ist Annas Postfach leer', async () => {
    await page.getByRole('button', { name: 'Sachlich richtig' }).click()

    await expect(page.getByRole('heading', { name: 'Postfächer' })).toBeVisible()
    /*
     * Nur **dieser** Beleg ist weg -- nicht das ganze Postfach leer. Anna ist
     * Objektverantwortliche fuer Objekt 42 und hat weitere Aufgaben; eine
     * Zusicherung auf "Nichts zugewiesen." haengt daran, wie viele Belege
     * der Seed gerade mitbringt.
     */
    await expect(page.getByRole('link', { name: BELEG })).toHaveCount(0)
  })
})

test('Bernd findet denselben Beleg zur rechnerischen Prüfung', async ({ page }) => {
  await anmelden(page, BENUTZER.bernd)
  await navigiere(page, 'Postfächer')

  // Der Kern der Sache: Niemand hat den Beleg weitergereicht. Er steht hier,
  // weil die Prozessdefinition es so vorsieht.
  await expect(page.getByRole('link', { name: BELEG })).toBeVisible()

  await page.getByRole('link', { name: BELEG }).click()
  await expect(page.getByRole('heading', { name: 'Rechnerische Pruefung' })).toBeVisible()
})

test('Am Beleg steht der Stempel, den Anna gesetzt hat', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')

  await page.getByRole('link', { name: BELEG }).first().click()

  /*
   * Der Stempel entsteht aus seinem Ereignis (Konzept 16) -- niemand hat ihn
   * gezeichnet. Er steht hier unter "Ohne Platz auf der Seite", weil der
   * Seed-Beleg nie aufbereitet wurde und Seite 1 deshalb keine freien
   * Stempelplätze kennt. Der Rückfallweg greift, statt den Stempel zu
   * verlieren -- und dass er sichtbar greift, ist die halbe Zusage.
   */
  await expect(page.getByText(/Sachlich richtig · Anna Ahrens/)).toBeVisible()
})
