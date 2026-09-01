/**
 * Externe Belegeinsicht — der Weg, den nur ein Browser beweisen kann.
 *
 * Konzept 17: **Es gibt keinen Benutzer und keine Sitzung.** Der Token *ist*
 * der Zugang. Ein Unit-Test kann prüfen, dass die SQL-Funktion das Richtige
 * liefert; er kann nicht prüfen, dass jemand **ohne jede Anmeldung** den Link
 * öffnet und den Beleg sieht — und dass nach dem Widerruf nichts mehr kommt.
 *
 * Deshalb läuft das hier in einem eigenen Browserkontext ohne Cookies. Das
 * ist die Lage des Empfängers: ein Mieter mit einem Link in einer Mail.
 */

import { expect, test, type Browser } from '@playwright/test'
import { anmelden, BENUTZER } from './anmeldung'

/** Ein frischer Kontext ohne Sitzung — so wie ein Mieter das DMS sieht. */
async function alsFremder(browser: Browser) {
  const kontext = await browser.newContext()
  return { kontext, seite: await kontext.newPage() }
}

test('Ein Mieter sieht seinen Beleg ohne Anmeldung — und nach dem Widerruf nicht mehr', async ({
  page,
  browser,
}) => {
  let link = ''

  await test.step('Anna gewährt Einsicht und bekommt den Link einmal zu sehen', async () => {
    await anmelden(page, BENUTZER.anna)
    await page.getByRole('link', { name: 'Einsicht' }).click()

    // Der Beleg aus dem Seed gehoert in Meikes Mietzeit (Januar bis Maerz) --
    // die Mietersicht wird gerechnet, nicht freigegeben (Konzept 7).
    await page.getByLabel('Person').selectOption({ label: 'Meike Meier (mieter)' })
    await page.getByRole('button', { name: 'Zugang anlegen' }).click()

    await expect(page.getByRole('heading', { name: 'Zugang angelegt' })).toBeVisible()
    const angezeigt = await page.getByText(/^\/einsicht\//).textContent()
    link = String(angezeigt).trim()
    expect(link).toMatch(/^\/einsicht\/[\w-]{20,}$/)
  })

  const { kontext, seite } = await alsFremder(browser)
  try {
    await test.step('Der Mieter öffnet den Link ohne jede Anmeldung', async () => {
      await seite.goto(link)

      // Keine Navigation, kein Abmelden -- er ist kein Benutzer.
      await expect(seite.getByRole('link', { name: 'Postfächer' })).toHaveCount(0)
      await expect(seite.getByText(/Meike Meier/)).toBeVisible()
    })

    await test.step('Widerrufen', async () => {
      await page.getByRole('link', { name: 'Einsicht' }).click()
      await page.getByRole('button', { name: 'widerrufen' }).click()

      /*
       * Warten, bis die **Schaltfläche verschwunden** ist — nicht darauf,
       * dass irgendwo „widerrufen" steht.
       *
       * Der erste Entwurf prüfte auf den Text. Den trägt der Knopf selbst,
       * die Zusicherung war also schon erfüllt, bevor die Serveraktion
       * durch war — und der Test las den Link, während der Widerruf noch
       * lief. Ein Wettlauf, der mal grün und mal rot ausgeht.
       */
      await expect(page.getByRole('button', { name: 'widerrufen' })).toHaveCount(0)
      await expect(page.getByText('widerrufen')).toBeVisible()
    })

    await test.step('Derselbe Link führt jetzt ins Leere', async () => {
      await seite.goto(link)

      /*
       * Und zwar ohne zu sagen, warum. „Abgelaufen" wäre bereits die
       * Auskunft, dass es diesen Zugang gab — der Empfänger soll denselben
       * Eindruck bekommen wie jemand, der einen Token errät.
       */
      await expect(seite.getByText(/Meike Meier/)).toHaveCount(0)
      await expect(seite.getByText(/abgelaufen|widerrufen/i)).toHaveCount(0)
    })
  } finally {
    await kontext.close()
  }
})

test('Ein erfundener Token führt nirgendwohin', async ({ browser }) => {
  const { kontext, seite } = await alsFremder(browser)
  try {
    const antwort = await seite.goto('/einsicht/dieser-token-ist-frei-erfunden-und-lang-genug')
    expect(antwort?.status()).toBeGreaterThanOrEqual(400)
  } finally {
    await kontext.close()
  }
})
