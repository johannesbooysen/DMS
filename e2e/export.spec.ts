/**
 * Belegexport (Konzept 16) — durch den Browser geholt.
 *
 * Die Regeln stehen in `tests/export`, dort wird auch der Text des erzeugten
 * PDF nachgemessen. Hier geht es um das, was ein Unit-Test nicht sieht: dass
 * die Links auf der Belegansicht stehen, dass hinter ihnen wirklich ein PDF
 * herauskommt, und dass ein Empfänger, der die Variante in der Adresszeile
 * ändert, nichts bekommt, was ihm nicht zusteht.
 */

import { expect, test } from '@playwright/test'
import { abmelden, anmelden, BENUTZER, navigiere } from './anmeldung'

const BELEG = 'Musterreinigung GmbH · RE-2026-0001'

test.setTimeout(90_000)

test('Die Belegansicht bietet die drei Varianten an', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')
  await page.getByRole('link', { name: BELEG }).first().click()

  for (const name of ['Beleg mit Stempeln', 'Belegeinsicht', 'interne Akte']) {
    await expect(page.getByRole('link', { name })).toBeVisible()
  }
  // Das Archivoriginal steht schon als „Original-PDF" da -- zweimal dasselbe
  // anzubieten waere eine Frage, die niemand beantworten kann.
  await expect(page.getByRole('link', { name: 'Original-PDF öffnen' })).toBeVisible()
})

test('Hinter jedem Link kommt ein PDF heraus', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')
  await page.getByRole('link', { name: BELEG }).first().click()

  for (const name of ['Beleg mit Stempeln', 'Belegeinsicht', 'interne Akte']) {
    const ziel = await page.getByRole('link', { name }).getAttribute('href')
    const antwort = await page.request.get(String(ziel))

    expect(antwort.status(), name).toBe(200)
    expect(antwort.headers()['content-type']).toContain('pdf')

    // Wirklich ein PDF und nicht eine Fehlerseite mit dem richtigen Kopf.
    expect((await antwort.body()).subarray(0, 4).toString(), name).toBe('%PDF')

    // Und ein Dateiname, den man in einem Ordner wiedererkennt.
    expect(antwort.headers()['content-disposition']).toContain('attachment')
  }
})

test('Eine erfundene Variante wird abgewiesen', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')
  await page.getByRole('link', { name: BELEG }).first().click()

  const ziel = await page.getByRole('link', { name: 'Beleg mit Stempeln' }).getAttribute('href')
  const basis = String(ziel).split('?')[0]

  /*
   * Die Variante kommt aus der Adresszeile. Ohne Weißliste wäre sie ein
   * Feld, in das jemand schreiben kann, was er möchte — und `VARIANTEN[x]`
   * mit `x = "__proto__"` liefert nicht `undefined`, sondern ein Objekt.
   */
  for (const erfunden of ['alles', '__proto__', 'constructor']) {
    const antwort = await page.request.get(`${basis}?variante=${erfunden}`)
    expect(antwort.status(), erfunden).toBe(400)
  }
})

test('Doris bekommt keinen Export aus dem fremden Mandanten', async ({ page }) => {
  // Erst als Anna die Adresse holen, dann als Doris versuchen.
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Belege')
  await page.getByRole('link', { name: BELEG }).first().click()
  const ziel = String(
    await page.getByRole('link', { name: 'Beleg mit Stempeln' }).getAttribute('href'),
  )

  /*
   * Ueber das Postfach abmelden: Die Belegansicht traegt keinen Rahmen und
   * damit weder Navigation noch Abmelden -- man kommt von dort nur mit dem
   * Zurueck-Knopf des Browsers weg.
   */
  await page.goto('/postfach')
  await abmelden(page)
  await anmelden(page, BENUTZER.doris)

  // Die RLS ist die Grenze, nicht die Oberflaeche: Doris kennt die Adresse
  // jetzt, und sie nuetzt ihr nichts.
  const antwort = await page.request.get(ziel)
  expect(antwort.status()).toBe(409)
  expect(await antwort.text()).toContain('nicht erreichbar')
})
