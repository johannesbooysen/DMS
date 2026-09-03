/**
 * Auswertungen im Browser.
 *
 * Was hier geprüft wird, kann ein Unit-Test nicht: dass die Seite unter der
 * **Sitzung des Angemeldeten** rechnet. Die drei Funktionen laufen bewusst
 * ohne `security definer` — die RLS ist der Mandantenfilter. Ob das über
 * Anmeldung, Sitzung und Server Component wirklich trägt, zeigt sich erst
 * hier: In einem Unit-Test setzt man den Benutzer selbst, im Browser muss
 * ihn die Kette liefern.
 *
 * `zahlung.spec.ts` fährt `RE-2026-0004`, `stempeln.spec.ts` fährt
 * `RE-2026-0001` — diese Datei ändert **nichts** und darf deshalb alles
 * lesen.
 */

import { expect, test } from '@playwright/test'
import { abmelden, anmelden, BENUTZER, navigiere } from './anmeldung'

test('Die Auswertungen stehen und nennen ihre Grundlage', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Auswertungen')

  await expect(page.getByRole('heading', { name: 'Auswertungen' })).toBeVisible()

  // Alle drei Abschnitte -- eine Kennzahlenseite, auf der einer fehlt, sieht
  // vollständig aus und ist es nicht.
  await expect(page.getByRole('heading', { name: 'Verfallene Skonti' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Durchlaufzeiten je Stufe' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Älteste offene Belege' })).toBeVisible()

  /*
   * Die Grundlage steht dabei. Eine Zahl ohne Angabe, was sie zählt, wird
   * falsch verstanden -- und dann wird danach entschieden.
   */
  await expect(page.getByText(/Gerechnet ab Eingang im Haus/)).toBeVisible()
})

test('Die ältesten offenen Belege führen zum Beleg', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Auswertungen')

  /*
   * Eine Auswertung, aus der man nicht in den Einzelfall kommt, ist eine
   * Sackgasse: Man sieht, dass etwas seit vierzig Tagen liegt, und muss den
   * Beleg dann von Hand suchen.
   */
  const zeile = page.getByRole('link', { name: /RE-2026-/ }).first()
  await expect(zeile).toBeVisible()
  await zeile.click()

  await expect(page.getByRole('link', { name: 'Original-PDF öffnen' })).toBeVisible()
})

test('Doris sieht die Zahlen ihres eigenen Mandanten, nicht die von Nord', async ({
  page,
}) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Auswertungen')
  const beiAnna = await page.getByRole('link', { name: /RE-2026-/ }).count()
  expect(beiAnna).toBeGreaterThan(0)

  await abmelden(page)
  await anmelden(page, BENUTZER.doris)
  await navigiere(page, 'Auswertungen')

  /*
   * Die eigentliche Zusicherung -- und der Grund, warum diese Seite keinen
   * `security definer` benutzt. Aus einer Kennzahl lässt sich zurückrechnen:
   * Bei einem Objekt mit drei Rechnungen im Monat ist „Summe der verlorenen
   * Skonti" fast schon der Einzelbetrag.
   */
  await expect(page.getByRole('heading', { name: 'Auswertungen' })).toBeVisible()
  expect(await page.getByRole('link', { name: /RE-2026-/ }).count()).toBe(0)
})
