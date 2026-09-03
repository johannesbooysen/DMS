/**
 * Die zweite Belegart im Browser (Konzept §24.3).
 *
 * **Der eigentliche Beweis für den generischen Kern.** Die Unit-Tests zeigen,
 * dass die Tabellen und Funktionen stimmen. Hier zeigt sich, ob ein
 * Schriftstück wirklich denselben Weg geht wie eine Rechnung — durch
 * dieselbe Anmeldung, dieselbe RLS, dasselbe Postfach, dieselbe Engine, in
 * dieselbe Belegansicht.
 *
 * Wäre der Kern nicht generisch, bräuchte es dafür einen zweiten Posteingang
 * und eine zweite Oberfläche. Diese Datei kommt mit denselben Hilfsfunktionen
 * aus wie `stempeln.spec.ts`.
 *
 * Gefahren wird `SV-1` aus dem Seed (Bauordnungsamt) — kein Beleg, den eine
 * andere Datei anfasst.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

const SCHREIBEN = 'Bauordnungsamt Musterstadt · Anhoerung zur Nutzungsaenderung'

test('Ein Schriftstück steht in der Belegliste — mit Absender statt Kreditor', async ({
  page,
}) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')

  /*
   * Vorher hätte hier „Ohne Kreditor" gestanden: Alle vier Anzeigestellen
   * bauten den Titel aus Kreditor und Rechnungsnummer. Ein Amt ist kein
   * Lieferant — und ein Beleg, den man in einer Liste nicht wiedererkennt,
   * ist ein Beleg, den niemand bearbeitet.
   */
  await expect(page.getByRole('link', { name: SCHREIBEN })).toBeVisible()
})

test('Es liegt in Annas Postfach und trägt dort seinen Absender', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)

  // Dasselbe Postfach wie für Rechnungen. Kein zweiter Eingang.
  await expect(page.getByRole('link', { name: SCHREIBEN })).toBeVisible()
  await page.getByRole('link', { name: SCHREIBEN }).first().click()

  /*
   * Der Postfachlink führt auf die Aufgabe, nicht auf den Beleg — die
   * fünfte Anzeigestelle für dieselbe Frage „wie heißt dieser Beleg".
   * Genau hier stand vor dem Umbau „Ohne Kreditor", und zwar als letzte
   * Auskunft, bevor jemand stempelt.
   */
  await expect(page.getByRole('heading', { name: 'Zur Kenntnis genommen' })).toBeVisible()
  await expect(page.getByText(/Bauordnungsamt Musterstadt/)).toBeVisible()
})

test('Von der Belegliste führt es in die gewöhnliche Belegansicht', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')
  await page.getByRole('link', { name: SCHREIBEN }).first().click()

  // Dieselbe Ansicht wie für eine Rechnung -- kein zweiter Viewer.
  await expect(page.getByRole('heading', { name: /Bauordnungsamt/ })).toBeVisible()
})

test('Es trägt seine eigene Stufenfolge, nicht die der Rechnung', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  // Über das Postfach: Gestempelt wird an der Aufgabe.
  await page.getByRole('link', { name: SCHREIBEN }).first().click()

  /*
   * Die Engine wählt die Definition über `p.belegart = d.belegart`. Für
   * Schriftverkehr steht sie im Seed — kein Codepfad kennt sie. Sichtbar
   * wird das an den Stempeln: „Zur Kenntnis" gibt es nur hier, „Sachlich
   * richtig" nur an der Rechnung.
   */
  await expect(page.getByRole('button', { name: 'Zur Kenntnis' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sachlich richtig' })).toHaveCount(0)

  // Und keine Zahlungsstufe -- ein Schriftstück wird nicht gezahlt.
  await expect(page.getByRole('button', { name: /Zahlung/ })).toHaveCount(0)
})

test('Doris sieht das Schreiben aus Nord nicht', async ({ page }) => {
  await anmelden(page, BENUTZER.doris)
  await navigiere(page, 'Belege')

  // Dieselbe RLS wie für jeden anderen Beleg -- kein zweites Rechtemodell.
  await expect(page.getByRole('link', { name: SCHREIBEN })).toHaveCount(0)
})
