/**
 * Legt einen Zahlungsauftrag ins Ausgangsbuch und versucht ihn zu senden.
 *
 *   npx tsx scripts/postausgang-demo.ts
 *
 * Ohne `SMTP_URL` bleibt der Eintrag offen liegen — genau das soll er. Mit
 * gesetzter Adresse geht er hinaus und wird als gesendet vermerkt.
 */

import { alsBenutzer, poolSchliessen } from '../src/db'
import {
  ausgangsbuchLaden,
  postAnlegen,
  postSenden,
  versandAusUmgebung,
  versandEingerichtet,
} from '../src/postausgang'

const ANNA = '20000000-0000-0000-0000-000000000001'
const D1 = '70000000-0000-0000-0000-000000000001'

const ablage = {
  async lesen(): Promise<Buffer> {
    return Buffer.from('Empfaenger;IBAN;Betrag\r\n"Musterreinigung GmbH";"DE00";"1240,00"\r\n')
  },
}

await alsBenutzer(ANNA, (c) =>
  postAnlegen(c, {
    schluessel: 'zahlungsauftrag',
    anlass: 'zahlung',
    empfaenger: 'zahlungen@bank.example.invalid',
    dokumentId: D1,
    werte: {
      rechnungsnummer: 'RE-2026-0001',
      kreditor: 'Musterreinigung GmbH',
      betrag: '1.240,00 EUR',
      objekt: '42 WEG Lindenweg 3',
      faellig: '2026-09-14',
    },
    anhang: { schluessel: 'demo/zahlung.csv', name: 'zahlung.csv' },
  }),
)

console.log(`Versand eingerichtet: ${versandEingerichtet() ? 'ja' : 'nein'}`)

const ergebnis = await postSenden(ablage, versandAusUmgebung())
console.log(`gesendet: ${ergebnis.gesendet}, gescheitert: ${ergebnis.gescheitert}`)

for (const e of await ausgangsbuchLaden(ANNA)) {
  console.log(`  ${e.status.padEnd(15)} ${e.empfaenger}  ${e.betreff}`)
  if (e.fehler !== null) console.log(`                  ${e.fehler}`)
}

await poolSchliessen()
