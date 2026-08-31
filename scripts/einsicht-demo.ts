/**
 * Legt einen Einsichtszugang für die Seed-Mieterin an.
 *
 *   npx tsx scripts/einsicht-demo.ts [dokumentId]
 *
 * Ohne Dokumentkennung reicht der Seed: Meike Meier sieht den Beleg aus ihrer
 * Mietzeit. Mit Kennung wird zusätzlich ein vorhandener Beleg dem Objekt 42
 * zugeordnet und umlagefähig kontiert — nützlich, um die Seitenansicht samt
 * Wasserzeichen an einem Beleg mit echten Seiten zu sehen.
 */

import { verbindungspool, poolSchliessen } from '../src/db'
import { einsichtGewaehren } from '../src/einsicht'

const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const MEIKE = '85000000-0000-0000-0000-000000000001'
const KONTO = '37000000-0000-0000-0000-000000000001'

const dokumentId = process.argv[2]

if (dokumentId !== undefined) {
  const c = await verbindungspool().connect()
  try {
    await c.query(
      `update dokument
          set objekt_id = $2,
              leistung_von = date '2026-02-01',
              leistung_bis = date '2026-02-28'
        where id = $1`,
      [dokumentId, OBJEKT_42],
    )
    await c.query(
      `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                               steuersatz, betrag_brutto, umlagefaehig, quelle)
       values ($1, 1, $2, 100, 19, 119, true, 'mensch')
       on conflict (dokument_id, zeile_nr) do nothing`,
      [dokumentId, KONTO],
    )
    console.log(`Beleg ${dokumentId} liegt jetzt in Meikes Mietzeit.`)
  } finally {
    c.release()
  }
}

const { token } = await einsichtGewaehren(ANNA, {
  objektId: OBJEKT_42,
  personId: MEIKE,
  empfaengerTyp: 'mieter',
  umfang: 'belegliste',
  tage: 7,
})

console.log(`http://localhost:3000/einsicht/${token}`)

await poolSchliessen()
