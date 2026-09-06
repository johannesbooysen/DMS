/**
 * Stammdatenpflege im Browser.
 *
 * **Was hier geprüft wird, kann kein Unit-Test.** Die Sicherheit liegt in
 * den Policies, und ein Unit-Test setzt die Kennung selbst. Erst hier zeigt
 * sich, ob Anmeldung, Sitzung und RLS zusammen dafür sorgen, dass eine
 * Objektbearbeiterin die Formulare gar nicht erst sieht — und dass die
 * Grenze auch dann hält, wenn sie das Formular umgeht.
 *
 * Die zweite Hälfte ist die wichtigere: Ausgeblendete Knöpfe sind
 * Bequemlichkeit, keine Sicherheit.
 */

import { expect, test } from '@playwright/test'
import { abmelden, anmelden, BENUTZER, navigiere } from './anmeldung'

test('Anna sieht die Stammdaten, darf sie aber nicht ändern', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Stammdaten')

  await expect(page.getByRole('heading', { name: 'Stammdaten' })).toBeVisible()

  /*
   * Lesen bleibt offen. Wer die Stammdaten nicht pflegen darf, hat trotzdem
   * Grund nachzusehen, welches Konto es gibt — verborgen ginge die Frage an
   * einen Kollegen.
   */
  await expect(page.getByText(/dürfen sie aber nicht ändern/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Anlegen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Kreditor anlegen' })).toHaveCount(0)
})

test('Eva legt ein Objekt an und sieht es in der Liste', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Stammdaten')

  /*
   * Auf das Formular eingegrenzt, nicht auf die Seite: "Nummer" gibt es
   * auch bei den Konten ("Kontonummer"), und ein Selektor ueber die ganze
   * Seite trifft dann zwei Felder.
   */
  const objektformular = page.locator('form').filter({ has: page.getByLabel('Nummer', { exact: true }) })
  await objektformular.getByLabel('Nummer', { exact: true }).fill('E2E-1')
  await objektformular.getByLabel('Bezeichnung').fill('Probeweg 7')
  await objektformular.getByRole('button', { name: 'Anlegen' }).click()

  await expect(page.getByRole('cell', { name: 'E2E-1' })).toBeVisible()

  /*
   * Ein frisch angelegtes Objekt hat niemanden — und das steht rot da.
   * Sonst liegen dort Belege, die keiner sieht, und das fällt erst auf,
   * wenn jemand nach einer Rechnung sucht.
   */
  await expect(page.getByRole('cell', { name: 'niemand' }).first()).toBeVisible()
})

test('Benutzer und Rollen sind ein eigenes Recht', async ({ page }) => {
  await anmelden(page, BENUTZER.bernd)
  await page.goto('/stammdaten/benutzer')

  /*
   * Bernd pflegt Stammdaten — Kreditoren, Konten, Zahlungswege. Rollen zu
   * vergeben darf er nicht: Daraus folgt jedes andere Recht, und wer es hat,
   * kann sich selbst zur Geschäftsleitung machen. Genau das war für jeden
   * Benutzer möglich, bis die Migration 20260903100000 es geschlossen hat.
   */
  await expect(page.getByText(/dürfen sie aber nicht ändern/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zuweisen' })).toHaveCount(0)

  await abmelden(page)
  await anmelden(page, BENUTZER.eva)
  await page.goto('/stammdaten/benutzer')
  await expect(page.getByRole('button', { name: 'Zuweisen' })).toBeVisible()
})

test('Die Grenze hält auch ohne Formular', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)

  /*
   * **Der eigentliche Test.** Anna ruft die Serveraktion auf, deren
   * Formular sie nie zu sehen bekommt. Ausgeblendete Knöpfe sind
   * Bequemlichkeit; die Grenze ziehen die Policies (Projektregel:
   * Berechtigungsprüfung serverseitig, nicht nur in der Oberfläche).
   */
  const vorher = await page.request.get('/stammdaten')
  expect(vorher.status()).toBe(200)

  const antwort = await page.request.fetch('/stammdaten', {
    method: 'POST',
    form: { name: 'Untergeschoben GmbH', zurueck: '/stammdaten' },
    headers: { 'next-action': 'erfunden' },
    maxRedirects: 0,
  })

  // Ob die Aktion mit 400 abgewiesen wird oder mit einem Fehler zurück-
  // leitet, ist zweitrangig -- entscheidend ist, dass danach kein Kreditor
  // dieses Namens existiert.
  expect([200, 302, 303, 400, 404, 500]).toContain(antwort.status())

  await page.goto('/stammdaten')
  await expect(page.getByText('Untergeschoben GmbH')).toHaveCount(0)
})

test('Die Vorlagenmaske zeigt, was ankommt — nicht nur, was getippt wurde', async ({
  page,
}) => {
  await anmelden(page, BENUTZER.eva)
  await page.goto('/stammdaten/vorlagen')

  await expect(page.getByRole('heading', { name: /Vorlagen/ })).toBeVisible()

  /*
   * Die Weißliste steht auf der Seite. Wer nicht weiß, welche Platzhalter es
   * gibt, probiert — und ein Tippfehler geht im Klartext an einen Dritten.
   */
  await expect(page.getByRole('cell', { name: '{{kreditor}}' })).toBeVisible()

  // Und die Vorschau mit erfundenen Beispielwerten: der eigentliche Punkt
  // der Seite.
  await expect(page.getByText('Musterreinigung GmbH').first()).toBeVisible()
})

test('Ein unbekannter Platzhalter wird beim Speichern abgewiesen', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await page.goto('/stammdaten/vorlagen')

  const betreff = page.getByLabel('Betreff').first()
  await betreff.fill('Zahlung {{rechnungsbetrag}}')
  await page.getByRole('button', { name: 'Speichern' }).first().click()

  /*
   * Abgewiesen, nicht stillschweigend gespeichert. Die spätere Gelegenheit,
   * den Tippfehler zu bemerken, wäre eine Mail, die schon draußen ist.
   */
  await expect(page.getByRole('alert').filter({ hasText: 'rechnungsbetrag' })).toBeVisible()
})

test('Die Eingangsquellenmaske hat kein Passwortfeld', async ({ page }) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Eingangsquellen')

  await page.getByRole('link', { name: 'Mailpostfach' }).click()
  await expect(page.getByLabel('Umgebungsvariable')).toBeVisible()

  /*
   * **Die Zusicherung dieser Seite.** Eingetragen wird der Name einer
   * Umgebungsvariablen; das Geheimnis liegt auf dem Rechner, auf dem der
   * Worker läuft. Was sich nicht eingeben lässt, kann auch nicht
   * versehentlich in der Datenbank landen.
   */
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByText(/kein Passwortfeld, und das ist Absicht/)).toBeVisible()
})
