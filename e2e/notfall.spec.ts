/**
 * Notfallzugriff im Browser (Konzept §24.10).
 *
 * **Was hier geprüft wird, kann kein Unit-Test.** Die Unit-Tests belegen die
 * Regel in der Datenbank; hier zeigt sich, ob Anmeldung, Sitzung, RLS,
 * Serveraktion und Umleitung zusammen dafür sorgen, dass Eva den Zugriff
 * einrichten kann — und dass er danach **über jeder Seite** steht, auch bei
 * jemandem, der gar nicht beteiligt ist.
 *
 * Das Band ist die eigentliche Zusicherung: Ein Zugriff auf fremde Belege,
 * den man nur in einer eigenen Maske findet, ist eine leise Hintertür.
 */

import { expect, test } from '@playwright/test'
import { abmelden, anmelden, BENUTZER, navigiere } from './anmeldung'

const GRUND = 'Vertretung fuer Objekt 43 waehrend Abwesenheit'

test('Eva richtet einen Notfallzugriff ein, Bernd sieht ihn über jeder Seite', async ({
  page,
}) => {
  await anmelden(page, BENUTZER.eva)
  await navigiere(page, 'Notfall')

  await expect(page.getByRole('heading', { name: 'Notfallzugriff' })).toBeVisible()
  await expect(page.getByText('Zurzeit läuft kein Notfallzugriff.')).toBeVisible()

  const formular = page.locator('form').filter({ hasText: 'Wer bekommt den Zugriff' })
  await formular.getByLabel('Wer bekommt den Zugriff').selectOption({ label: 'Anna Ahrens' })
  await formular.getByLabel('Auf welches Objekt').selectOption({ index: 1 })
  await formular.getByLabel('Grund').fill(GRUND)
  await formular.getByLabel('Dauer in Tagen').fill('5')
  await formular.getByRole('button', { name: 'Zugriff einrichten' }).click()

  // Der Eintrag steht in der Liste ...
  await expect(page.getByRole('cell', { name: 'Anna Ahrens' })).toBeVisible()
  await expect(page.getByRole('cell', { name: GRUND })).toBeVisible()

  /*
   * ... und im Band ueber der Seite. Beides gehoert geprueft: Die Liste
   * findet nur, wer sie aufruft; das Band sieht jeder.
   */
  await expect(page.getByRole('complementary')).toContainText('Notfallzugriff')

  await abmelden(page)

  /*
   * **Die wichtigste Zusicherung dieser Datei.** Bernd ist unbeteiligt --
   * weder Zugreifender noch Einrichter -- und sieht den Vorgang trotzdem,
   * ohne die Maske aufzurufen. Sichtbarkeit ersetzt hier die
   * Vorabfreigabe, die im Notfall niemand geben kann.
   */
  await anmelden(page, BENUTZER.bernd)
  await navigiere(page, 'Belege')
  await expect(page.getByRole('complementary')).toContainText('Notfallzugriff')
  await expect(page.getByRole('complementary')).toContainText('Anna Ahrens')
})

test('Anna darf keinen einrichten — und sieht das Formular gar nicht erst', async ({
  page,
}) => {
  await anmelden(page, BENUTZER.anna)
  await navigiere(page, 'Notfall')

  await expect(page.getByRole('heading', { name: 'Notfallzugriff' })).toBeVisible()

  /*
   * Lesen bleibt offen -- das ist der Sinn. Einrichten nicht: Das Recht
   * `notfallzugriff` traegt nur die Geschaeftsleitung.
   *
   * Der ausgeblendete Knopf ist dabei Bequemlichkeit, keine Sicherheit; die
   * Grenze belegen die Unit-Tests an der Policy.
   */
  await expect(page.getByRole('button', { name: 'Zugriff einrichten' })).toHaveCount(0)
  await expect(page.getByLabel('Grund')).toHaveCount(0)
})
