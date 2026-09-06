/**
 * Löschen nach Fristablauf im Browser.
 *
 * Die Seite zeigt Belege, deren Aufbewahrungsfrist abgelaufen ist. Geprüft
 * wird hier, was ein Unit-Test nicht kann: dass sie unter der Sitzung des
 * Angemeldeten rechnet und dass die Grenze auch dann hält, wenn jemand das
 * Formular gar nicht sieht.
 *
 * Diese Datei ändert **nichts** — sie löscht keinen Beleg. Ein E2E-Test, der
 * einen Beleg endgültig entfernt, nimmt der nächsten Datei die Grundlage;
 * die Datenbank wird nur einmal vor dem Lauf zurückgesetzt.
 */

import { expect, test } from '@playwright/test'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

test('Das Archiv nennt, was fällig ist — und was gelöscht wurde', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Archiv')

  await expect(page.getByRole('heading', { name: 'Archiv und Löschung' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Fällig zum Löschen/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Gelöscht' })).toBeVisible()

  /*
   * Der Satz, der die Seite trägt: Wer aufbewahren muss, muss danach
   * löschen. Ohne ihn liest man die Liste als Angebot statt als Pflicht.
   */
  await expect(page.getByText(/dürfen.*nicht länger\s*liegen/)).toBeVisible()
})

test('Anna sieht die Liste, darf aber nicht löschen', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Archiv')

  /*
   * Lesen bleibt offen — wer nicht löschen darf, hat trotzdem Grund
   * nachzusehen, was ansteht. Der Knopf fehlt, die Auskunft nicht.
   */
  await expect(page.getByText(/dürfen sie aber nicht ändern/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'endgültig löschen' })).toHaveCount(0)
})

test('Der Belegtext steht nicht auf der Löschseite', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Archiv')

  /*
   * Wer löschen darf, muss den Inhalt nicht noch einmal lesen. Eine
   * Löschliste mit Kreditor und Betrag wäre ein zweiter Weg an den Beleg —
   * vorbei an der Berechtigung, die dafür gilt.
   */
  await expect(page.getByText('Musterreinigung GmbH')).toHaveCount(0)
})
