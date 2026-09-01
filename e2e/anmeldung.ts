/**
 * Anmelden im Test.
 *
 * Zwei Klicks: die Schaltfläche auf der Anmeldeseite (sie beginnt den Weg
 * zum Anbieter) und der Name in der Benutzerauswahl (sie ersetzt in der
 * Entwicklung den Umweg über Microsoft).
 *
 * Bewusst über die Oberfläche und nicht durch Setzen eines Cookies: Die
 * Anmeldung ist selbst Teil der Kette, die diese Tests prüfen sollen. Wer
 * sie überspringt, prüft eine Anwendung, in die niemand hineinkommt.
 */

import { expect, type Page } from '@playwright/test'

export const BENUTZER = {
  /** Objektbearbeitung, ausdrücklich nur Objekt 42. */
  anna: 'Anna Ahrens',
  /** Buchhaltung, mandantenweit. */
  bernd: 'Bernd Bruns',
  /** Geschäftsleitung. */
  clara: 'Clara Cordes',
} as const

export async function anmelden(seite: Page, name: string): Promise<void> {
  await seite.goto('/anmeldung')

  // Kein Passwortfeld -- das DMS kennt keins. Das ist die Zusage, die hier
  // nebenbei mitgeprüft wird.
  await expect(seite.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  await expect(seite.locator('input[type="password"]')).toHaveCount(0)

  await seite.getByRole('button', { name: 'Anmelden' }).click()

  await expect(seite.getByRole('heading', { name: 'Anmelden als' })).toBeVisible()
  await seite.getByRole('link', { name }).click()

  // Nach der Rückkehr steht die Navigation -- sie gibt es nur mit Sitzung.
  await expect(seite.getByRole('link', { name: 'Postfächer' })).toBeVisible()
}
