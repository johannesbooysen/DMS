/**
 * Posteingang: der Weg über zwei Prozesse.
 *
 * Ein hochgeladener Beleg geht durch die Anwendung in die Warteschlange, von
 * dort in den **Worker** und über ihn zurück in die Anwendung. Das ist die
 * einzige Kette im System, die den Prozess wechselt — und die einzige, die
 * sich nur so prüfen lässt: Ein Unit-Test ruft `aufbereiten` direkt auf und
 * überspringt damit genau die Stelle, an der es hakt.
 *
 * **Ohne Extraktion.** Der Testlauf setzt `DMS_EXTRAKTION` nicht, also bleiben
 * Kreditor und Rechnungsnummer leer — der Beleg heißt in der Liste „Ohne
 * Kreditor". Das ist die Voreinstellung des Systems und keine Panne: Ohne
 * Bestellung wird nicht geraten. Gefunden wird der Beleg deshalb über seinen
 * **Seitentext**, und genau der ist auch das, was der Worker beigesteuert hat.
 */

import { expect, test } from '@playwright/test'
import { pdfBauen } from '../tests/hilfe/pdf-bauen'
import { anmelden, BENUTZER, navigiere } from './anmeldung'

/** Ein Wort, das in keinem Seed-Beleg vorkommt. */
const KENNWORT = 'Dachrinnenreinigung'

/**
 * Der Worker holt seine Aufträge im Takt ab. Das dauert länger als die
 * dreißig Sekunden, die Playwright einem Test von Haus aus gibt.
 */
test.setTimeout(120_000)

/** Sucht so lange erneut, bis der Worker den Seitentext geschrieben hat. */
async function sucheBisTreffer(
  seite: import('@playwright/test').Page,
  wort: string,
): Promise<void> {
  await navigiere(seite, 'Belege')
  await seite.getByLabel('Volltext').fill(wort)

  // Kein festes Warten: auf einem langsamen Rechner zu kurz, auf einem
  // schnellen Zeitverschwendung.
  await expect(async () => {
    await seite.getByRole('button', { name: 'Suchen' }).click()
    await expect(seite.getByText(new RegExp(wort)).first()).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 90_000 })
}

test('Ein hochgeladener Beleg wird vom Worker aufbereitet', async ({ page }) => {
  const pdf = await pdfBauen([
    {
      zeilen: [
        'Bedachungen Nord GmbH, Ziegelweg 7, 00000 Musterstadt',
        'Rechnung RE-2026-0777 vom 01.09.2026',
        `${KENNWORT} Objekt 42, Leistungszeitraum August 2026`,
        'Netto 420,17 EUR zuzueglich 19 Prozent Umsatzsteuer',
      ],
    },
  ])

  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Posteingang')

  await test.step('Hochladen', async () => {
    await page.getByLabel('Datei').setInputFiles({
      name: 'RE-2026-0777.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    })
    await page.getByRole('button', { name: 'Aufnehmen' }).click()
  })

  await test.step('Der Seitentext taucht auf — er kommt aus dem Worker', async () => {
    await sucheBisTreffer(page, KENNWORT)
  })

  await test.step('Und die Seite hat eine Vorschau', async () => {
    /*
     * "Ohne Bezeichnung" und nicht mehr "Ohne Kreditor": Seit es eine
     * zweite Belegart gibt, bauen alle Listen ihren Titel ueber
     * `belegBezeichnung`. Ein Schriftstueck hat nie einen Kreditor -- der
     * alte Platzhalter haette dort etwas Falsches behauptet.
     *
     * Frisch hochgeladen ist hier noch nichts extrahiert, also greift der
     * Platzhalter.
     */
    await page.getByRole('link', { name: /Ohne Bezeichnung/ }).first().click()

    const bild = page.getByRole('img', { name: 'Seite 1' })
    await expect(bild).toBeVisible()
    await expect
      .poll(() => bild.evaluate((e) => (e as unknown as { naturalWidth: number }).naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(200)
  })
})

test('Dieselbe Datei zweimal ergibt einen roten zweiten Beleg', async ({ page }) => {
  const wort = 'Regenrohrsanierung'
  const pdf = await pdfBauen([
    {
      zeilen: [
        'Bedachungen Nord GmbH, Ziegelweg 7, 00000 Musterstadt',
        'Rechnung RE-2026-0778 vom 01.09.2026',
        `${wort} Objekt 42`,
      ],
    },
  ])

  await anmelden(page, BENUTZER.anna)

  for (const durchgang of [1, 2]) {
    await navigiere(page, 'Posteingang')
    await page.getByLabel('Datei').setInputFiles({
      name: `zweimal-${durchgang}.pdf`,
      mimeType: 'application/pdf',
      buffer: pdf,
    })
    await page.getByRole('button', { name: 'Aufnehmen' }).click()
  }

  await sucheBisTreffer(page, wort)

  /*
   * Dublette ist ein **harter** Rot-Fall (Konzept 14): Sie färbt nicht nur,
   * sie stoppt die Bearbeitung. Gelöscht wird nichts — beide Belege stehen
   * da, der zweite verkettet mit dem ersten, und seine Ampel ist rot.
   */
  await expect(async () => {
    await page.getByRole('button', { name: 'Suchen' }).click()
    expect(await page.getByLabel('Ampel rot').count()).toBeGreaterThan(0)
  }).toPass({ timeout: 90_000 })
})
