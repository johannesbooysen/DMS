/**
 * Die Belegansicht: im Beleg suchen, eine Notiz anlegen.
 *
 * Beides liest nur oder legt einen Layer neben das Original -- der Beleg
 * RE-2026-0001 bleibt, was er für den Stempeltest ist. Die Suche markiert
 * die Seite, nicht die Stelle im Bild (Zeilenkästen ohne Text, bewusst);
 * geprüft wird deshalb der Auszug mit der Markierung und die Seitenmarke.
 */

import { expect, test } from '@playwright/test'
import { anmelden, belegOeffnen, BENUTZER } from './anmeldung'

const BELEG = 'Musterreinigung GmbH · RE-2026-0001'

test('Die Suche im Beleg nennt Seite und Auszug', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await belegOeffnen(page, BELEG)

  const suche = page.getByRole('region', { name: 'Im Beleg suchen' }).or(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Im Beleg suchen' }) }))
  await suche.locator('input[name=suche]').fill('Hausreinigung')
  await suche.locator('input[name=suche]').press('Enter')

  const treffer = page.getByRole('list', { name: 'Treffer' })
  await expect(treffer.getByRole('listitem').first()).toContainText(/Seite 1/)
  await expect(treffer.locator('mark').first()).toHaveText(/Hausreinigung/i)
  // Die Seite trägt die Marke -- im Stapel und in der Miniaturleiste.
  await expect(page.getByRole('region', { name: 'Beleg' }).getByText('Treffer', { exact: true })).toBeVisible()
})

test('Eine Notiz steht danach unter der Seite', async ({ page }) => {
  await anmelden(page, BENUTZER.anna)
  await belegOeffnen(page, BELEG)

  const formular = page.locator('form').filter({ has: page.locator('select[name=typ]') })
  // Zusammengeklappt, bis jemand es braucht.
  const klappe = page.locator('details').filter({ has: formular })
  if (!(await klappe.evaluate((d) => (d as unknown as { open: boolean }).open))) {
    await klappe.locator('summary').click()
  }
  await formular.locator('select[name=typ]').selectOption('notiz')
  await formular.locator('input[name=text]').fill('Leistungszeitraum mit dem Vertrag abgleichen')
  await formular.getByRole('button').click()

  await expect(page.getByRole('region', { name: 'Beleg' }).getByText('Leistungszeitraum mit dem Vertrag abgleichen')).toBeVisible()
})
