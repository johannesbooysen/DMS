/**
 * Eingangsquellen und Vertretung -- die beiden Wege, auf denen ein Beleg
 * ohne Klick hereinkommt und ohne Klick den Bearbeiter wechselt.
 *
 * Ein überwachter Ordner wird über die Maske eingerichtet, eine Datei
 * hineingelegt, und der **Worker** holt sie: Ruhefrist, Takt der Quelle und
 * Takt des Workers zusammen sind das, was hier gewartet wird -- ohne festes
 * Warten, sondern bis der Beleg in der Suche steht. Danach richtet Anna eine
 * Vertretung ein, und der nächste Beleg aus demselben Ordner landet bei
 * Bernd, obwohl Anna die Objektverantwortliche ist. Beides lässt sich nur
 * so prüfen: Der Unit-Test ruft den Durchgang direkt auf und überspringt
 * damit genau die Stelle, an der es hakt.
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { pdfBauen } from '../tests/hilfe/pdf-bauen'
import { abmelden, anmelden, BENUTZER, navigiere } from './anmeldung'

/** Wörter, die in keinem anderen Beleg vorkommen. */
const KENNWORT_A = 'Fassadenreinigung'
const KENNWORT_B = 'Kellerentruempelung'

test.setTimeout(240_000)

let ordner = ''

/** Sucht so lange, bis der Worker den Beleg aufbereitet hat. */
async function sucheBisTreffer(seite: Page, wort: string): Promise<void> {
  await navigiere(seite, 'Belege')
  await seite.getByLabel('Volltext').fill(wort)
  await expect(async () => {
    await seite.getByRole('button', { name: 'Suchen' }).click()
    await expect(seite.getByRole('navigation', { name: 'Treffer' }).getByText(new RegExp(wort)).first()).toBeVisible({
      timeout: 3_000,
    })
  }).toPass({ timeout: 180_000 })
}

async function ablegen(wort: string, nummer: string): Promise<void> {
  const pdf = await pdfBauen([
    {
      zeilen: [
        'Gebaeudeservice Sued GmbH, Hofweg 3, 00000 Musterstadt',
        `Rechnung ${nummer} vom 10.09.2026`,
        `${wort} Objekt 42, September 2026`,
        'Netto 250,00 EUR zuzueglich 19 Prozent Umsatzsteuer',
      ],
    },
  ])
  await writeFile(join(ordner, `${nummer}.pdf`), pdf)
}

test('Ein überwachter Ordner liefert Belege -- eingerichtet über die Maske, geholt vom Worker', async ({ page }) => {
  ordner = await mkdtemp(join(tmpdir(), 'dms-eingang-'))

  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Eingangsquellen')

  await test.step('Ordner einrichten, mit Objekt 42 vorbelegt', async () => {
    const formular = page.locator('form').filter({ has: page.getByLabel('Pfad') })
    await formular.getByLabel('Bezeichnung').fill('E2E-Scanner')
    await formular.getByLabel('Pfad').fill(ordner)
    // Der kleinste erlaubte Takt -- der Test soll nicht fünf Minuten warten.
    await formular.getByLabel('Takt (s)').fill('30')
    await formular.locator('select[name=objektId]').selectOption('50000000-0000-0000-0000-000000000042')
    await formular.getByRole('button', { name: 'Ordner einrichten' }).click()
    await expect(page.getByRole('cell', { name: 'E2E-Scanner' })).toBeVisible()
  })

  await test.step('Eine Datei im Ordner wird ein Beleg', async () => {
    await ablegen(KENNWORT_A, 'RE-2026-0901')
    await sucheBisTreffer(page, KENNWORT_A)
  })

  await test.step('Die Quelle sagt, dass sie etwas bekommen hat', async () => {
    await navigiere(page, 'Eingangsquellen')
    const zeile = page.getByRole('row', { name: /E2E-Scanner/ })
    await expect(zeile).toBeVisible()
    await expect(zeile.getByText(/^0$/)).toHaveCount(0)
  })
})

test('Mit Vertretung geht der nächste Beleg aus dem Ordner an Bernd statt an Anna', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)

  await test.step('Anna gibt ihre Aufgaben an Bernd', async () => {
    await navigiere(page, 'Vertretung')
    await page.locator('select[name=anBenutzer]').selectOption({ label: 'Bernd Bruns' })
    await page.locator('input[name=grund]').fill('Urlaub')
    await page.getByRole('button', { name: 'Vertretung einrichten' }).click()
    await expect(page.getByRole('heading', { name: 'Von mir abgegeben (1)' })).toBeVisible()
  })

  await test.step('Der nächste Beleg aus dem Ordner landet bei Bernd', async () => {
    // Ohne Extraktion heisst der Beleg "Ohne Bezeichnung" -- gezaehlt wird
    // deshalb, dass Annas persoenliche Liste nicht waechst.
    await navigiere(page, 'Postfächer')
    const persoenlichAnna = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Persönlich/ }) })
    const vorher = await persoenlichAnna.getByRole('link').count()

    await ablegen(KENNWORT_B, 'RE-2026-0902')
    await sucheBisTreffer(page, KENNWORT_B)
    await navigiere(page, 'Postfächer')
    await expect(persoenlichAnna.getByRole('link')).toHaveCount(vorher)
    // ... sondern bei Bernd.
    await abmelden(page)
    await anmelden(page, BENUTZER.bernd)
    await navigiere(page, 'Postfächer')
    const persoenlichBernd = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Persönlich/ }) })
    await expect(persoenlichBernd.getByRole('link', { name: /RE-2026-0902|Ohne Bezeichnung/ }).first()).toBeVisible()
  })

  await test.step('Und die Vertretung wird widerrufen, damit sie nicht in andere Tests hineinwirkt', async () => {
    await abmelden(page)
    await anmelden(page, BENUTZER.anna)
    await navigiere(page, 'Vertretung')
    await page.getByRole('button', { name: /widerrufen/i }).first().click()
    await expect(page.getByText('· widerrufen').first()).toBeVisible()
  })
})
