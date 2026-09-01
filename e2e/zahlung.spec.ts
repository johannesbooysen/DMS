/**
 * Kontierung und die harte Sperre vor der Zahlung.
 *
 * Beide Masken erscheinen **nur an ihrer Stufe**. Bis dieser Test geschrieben
 * wurde, endete der mitgelieferte Ablauf nach der Freigabe — beide waren
 * damit im Betrieb unerreichbar, obwohl sie fertig sind. Der Seed schließt
 * die Kette jetzt (Konzept 9).
 *
 * Was hier geprüft wird, ist nicht die Regel — die steht in
 * `tests/kontierung` und `tests/zahlung` —, sondern ob ein Mensch **sieht**,
 * warum er nicht weiterkommt. Eine Sperre, die nur eine Schaltfläche
 * ausgraut, führt zu einem Anruf. Eine, die den Grund nennt, führt zu einer
 * Behebung.
 */

import { expect, test } from '@playwright/test'
import { abmelden, anmelden, BENUTZER, navigiere } from './anmeldung'

/*
 * **Ein eigener Beleg, nicht der aus `stempeln.spec.ts`.**
 *
 * Alle Testdateien teilen sich eine Datenbank, die nur einmal vor dem Lauf
 * zurueckgesetzt wird. Wer denselben Beleg veraendert, haengt an der
 * Reihenfolge der Dateien -- und genau das ist einmal passiert: Der
 * Stempeltest fuehrte RE-2026-0001 zwei Stufen weiter, und hier fand sich
 * dann keine offene Aufgabe mehr.
 *
 * D4 bekommt seinen Lauf im Fixture. Er hat noch keine Kontierungszeile und
 * ist damit auch der ehrlichere Fall: der volle Betrag offen.
 */
const BELEG = 'Musterreinigung GmbH · RE-2026-0004'

test.setTimeout(90_000)
test.describe.configure({ mode: 'serial' })

/** Meldet an, öffnet die Aufgabe zum Beleg und stempelt. */
async function stempeln(
  page: import('@playwright/test').Page,
  wer: string,
  knopf: string,
): Promise<void> {
  await anmelden(page, wer)
  await navigiere(page, 'Postfächer')
  await page.getByRole('link', { name: BELEG }).click()

  // Wer an einer Stufe keinen passenden Stempel hat, sieht das ausdrücklich
  // (Konzept 8.7) -- dass hier einer da ist, gehört zur Prüfung.
  await expect(page.getByRole('button', { name: knopf })).toBeVisible()
  await page.getByRole('button', { name: knopf }).click()
  await abmelden(page)
}

test('Bis zur Kontierung', async ({ page }) => {
  await stempeln(page, BENUTZER.anna, 'Sachlich richtig')
  await stempeln(page, BENUTZER.bernd, 'Rechnerisch richtig')
  await stempeln(page, BENUTZER.eva, 'Freigegeben')
})

test('Die Kontierung verlangt die volle Summe — und sagt das', async ({ page }) => {
  await anmelden(page, BENUTZER.bernd)
  await navigiere(page, 'Postfächer')
  await page.getByRole('link', { name: BELEG }).click()

  // Zwei Überschriften heißen „Kontierung": die Stufe und die Maske. Ohne
  // `level` ist der Selektor mehrdeutig.
  await expect(page.getByRole('heading', { level: 2, name: 'Kontierung' })).toBeVisible()

  await test.step('Der Beleg ist vollständig kontiert — die Maske sagt das', async () => {
    await expect(page.getByText('Stimmt mit dem Rechnungsbetrag überein')).toBeVisible()
    // Nichts offen, also nichts zu übernehmen.
    await expect(page.getByRole('button', { name: /Rest übernehmen/ })).toHaveCount(0)
  })

  await test.step('Die Zeile weg — und die Maske nennt den offenen Betrag', async () => {
    await page.getByRole('button', { name: 'entfernen' }).first().click()

    await expect(page.getByText('Offen')).toBeVisible()
    /*
     * **Das ist der Punkt.** Nicht „Aktion nicht möglich", sondern der
     * Betrag, der fehlt. Wer nur eine graue Schaltfläche sieht, ruft an;
     * wer 800,00 € liest, trägt sie ein.
     */
    await expect(page.getByRole('button', { name: /Rest übernehmen \(/ })).toBeVisible()
  })

  await test.step('Und der Stempel wird verweigert, nicht nur ausgegraut', async () => {
    await page.getByRole('button', { name: 'Kontiert' }).click()

    /*
     * Der Summenzwang blockiert die Stufe, nicht die Ampel (Konzept 6). Und
     * die Meldung nennt beide Zahlen und die Differenz — sie sagt nicht
     * „nicht möglich", sondern was zu tun ist.
     *
     * Nicht über `getByRole('alert')`: Next hängt einen eigenen Ansager mit
     * dieser Rolle in jede Seite, der Selektor wäre mehrdeutig.
     */
    /*
     * Zwei mögliche Sätze, je nachdem wie weit die Kontierung ist:
     *
     *   gar keine Zeile → „Der Beleg ist noch nicht kontiert."
     *   Zeilen, aber falsche Summe → „Die Kontierung ergibt X, der
     *   Rechnungsbetrag ist Y. Es fehlen Z."
     *
     * Beide sagen, was zu tun ist — und darauf kommt es an. Der erste
     * Entwurf verlangte den zweiten Satz und übersah, dass hier die einzige
     * Zeile entfernt wurde.
     */
    await expect(
      page.getByText(/noch nicht kontiert|Die Kontierung ergibt .* Es fehlen /),
    ).toBeVisible()
  })

  await test.step('Rest übernehmen, dann geht es weiter', async () => {
    await page.getByRole('button', { name: /Rest übernehmen/ }).click()
    await expect(page.getByText('Stimmt mit dem Rechnungsbetrag überein')).toBeVisible()

    await page.getByRole('button', { name: 'Kontiert' }).click()
    await expect(page.getByRole('heading', { name: 'Postfächer' })).toBeVisible()
  })
})

test('Vor der Übergabe steht, was noch fehlt', async ({ page }) => {
  await anmelden(page, BENUTZER.bernd)
  await navigiere(page, 'Postfächer')
  await page.getByRole('link', { name: BELEG }).click()

  await expect(page.getByRole('heading', { name: 'Zahlungsuebergabe' })).toBeVisible()

  await test.step('Die Zahlungsansicht sagt, wohin und wie viel', async () => {
    // `exact`, sonst trifft der Name auch die Ueberschrift "Zahlungsuebergabe".
    await expect(
      page.getByRole('heading', { name: 'Zahlung', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('scan2bank')).toBeVisible()
    // Der Empfaenger **mit** seiner IBAN: Genau das soll vor der Uebergabe
    // auf dem Schirm stehen, damit niemand ins Blaue anweist.
    await expect(page.getByText(/Musterreinigung GmbH · IBAN/)).toBeVisible()
  })

  await test.step('Und wenn etwas fehlt, steht der Grund da — nicht nur eine graue Taste', async () => {
    const sperre = page.getByRole('alert').filter({ hasText: 'Übergabe gesperrt' })

    if (await sperre.isVisible()) {
      /*
       * `zahlung_moeglich` gibt genau **ein** Hindernis zurück, das erste in
       * der festen Reihenfolge. Sonst behebt jemand das dritte und wundert
       * sich, dass es immer noch nicht geht. Ein leerer Grund wäre der
       * schlechteste Fall.
       */
      await expect(sperre).not.toHaveText(/Übergabe gesperrt\.\s*$/)
    } else {
      // Nichts fehlt: Dann muss die Übergabe auch wirklich möglich sein.
      await expect(page.getByRole('button', { name: 'Zur Zahlung uebergeben' })).toBeVisible()
    }
  })
})
