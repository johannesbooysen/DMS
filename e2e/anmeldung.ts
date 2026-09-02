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

/**
 * Wer im Seed wer ist.
 *
 * Die Rollen stehen hier, weil sie den Unterschied machen: Clara ist **nicht**
 * die Geschäftsleitung, auch wenn der Name danach klingt — sie trägt das
 * Spezialgebiet Versicherung. Ein Test, der sie freigeben lässt, scheitert an
 * einer Aufgabe, die sie gar nicht sieht, und der Fehler sieht dann aus wie
 * ein Fehler der Anwendung.
 */
export const BENUTZER = {
  /** Objektbearbeitung, ausdrücklich nur Objekt 42. */
  anna: 'Anna Ahrens',
  /** Buchhaltung, mandantenweit — auch Kontierung und Zahlungsübergabe. */
  bernd: 'Bernd Bruns',
  /** Spezialgebiet Versicherung, mandantenweit. */
  clara: 'Clara Cordes',
  /** Geschäftsleitung, mandantenweit — die Freigabestufe. */
  eva: 'Eva Ebert',
  /** Anderer Mandant. Darf aus Nord nichts sehen. */
  doris: 'Doris Dahl',
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

/**
 * Zu einer Seite über die Navigation.
 *
 * **Auf die Navigation eingegrenzt**, und das ist kein Feinschliff: „Belege"
 * steht nach einer Stapelübernahme auch im Fließtext („Die Belege stehen
 * unter Belege"), „Einsicht" auf der Einsichtsseite selbst. Ein Selektor über
 * die ganze Seite trifft dann zwei Elemente und der Test bricht ab — an einer
 * Stelle, die mit dem Geprüften nichts zu tun hat.
 */
export async function navigiere(seite: Page, name: string): Promise<void> {
  const verweis = seite
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name })
  const ziel = await verweis.getAttribute('href')
  await verweis.click()

  /*
   * Warten, bis die neue Seite wirklich steht.
   *
   * Die Navigation läuft über `next/link` und damit ohne vollen Seitenaufbau
   * — der alte Inhalt bleibt einen Augenblick stehen. Wer sofort weiterklickt,
   * trifft ihn noch.
   *
   * Das ging lange gut, weil die alte Seite meist keinen passenden Treffer
   * hatte. Beim Export fiel es auf: Im Postfach **und** in der Belegliste
   * heißt ein Verweis „Musterreinigung GmbH · RE-2026-0001" — der Klick
   * landete auf der Aufgabe statt auf dem Beleg, und der Test suchte
   * Exportlinks auf einer Seite, die keine hat.
   */
  if (ziel !== null) await seite.waitForURL(`**${ziel}`)
}

/**
 * Abmelden — und warten, bis es wirklich geschehen ist.
 *
 * Die Wartezeile ist kein Schmuck. Ohne sie fragt der nächste `anmelden` die
 * Anmeldeseite, während die Sitzung noch gilt; sie leitet dann folgerichtig
 * ins Postfach um, und der Test sucht vergeblich nach einer Schaltfläche,
 * die es dort nicht gibt. Beim Wechsel zwischen drei Menschen in einem Test
 * geht das mal gut und mal nicht — die schlimmste Art von Fehlschlag.
 */
export async function abmelden(seite: Page): Promise<void> {
  await seite.getByRole('button', { name: 'Abmelden' }).click()
  await expect(seite.getByRole('button', { name: 'Anmelden' })).toBeVisible()
}
