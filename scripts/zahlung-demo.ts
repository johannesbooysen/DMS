/**
 * Legt einen Beleg an, der an der Bankübergabe steht.
 *
 * Wie `kontierung-demo.ts`: Der Seed-Ablauf endet bei der Freigabe, die
 * Zahlungsstufe kommt darin nicht vor. Eigene Kennungen, damit der
 * Zahlungstest sie nicht mitabräumt.
 *
 *   npx tsx scripts/zahlung-demo.ts
 */

import { alsBenutzer, poolSchliessen } from '../src/db'
import { laufStarten, stempeln } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const KONTO = '37000000-0000-0000-0000-000000000001'
const SACHLICH_RICHTIG = '60000000-0000-0000-0000-000000000001'

const GRUPPE = '40000000-0000-0000-0000-0000000000f0'
const DEFINITION = '65000000-0000-0000-0000-0000000000f0'
const STUFE_PRUEFUNG = '66000000-0000-0000-0000-0000000000f0'
const STUFE_ZAHLUNG = '66000000-0000-0000-0000-0000000000f1'
const WURZEL = '67000000-0000-0000-0000-0000000000f0'
const BLATT_PRUEFUNG = '67000000-0000-0000-0000-0000000000f1'
const BLATT_ZAHLUNG = '67000000-0000-0000-0000-0000000000f2'

const dokumentId = await alsBenutzer(ANNA, async (c) => {
  await c.query(
    `insert into ordnungsgruppe (id, mandant_id, name, kurzcode, sortierung)
     values ($1, $2, 'Zahlung (Demo)', 'ZAD', 930)
     on conflict (id) do update set aktiv = true`,
    [GRUPPE, MANDANT],
  )
  await c.query(
    `insert into prozessdefinition (id, mandant_id, belegart, ordnungsgruppe_id,
                                    version, status, aktiv_ab)
     values ($1, $2, 'rechnung', $3, 1, 'aktiv', now())
     on conflict (id) do update set status = 'aktiv'`,
    [DEFINITION, MANDANT, GRUPPE],
  )
  await c.query(
    `insert into prozessstufe (id, definition_id, reihenfolge, stufentyp,
                               bezeichnung, zustaendigkeit_typ, sla_stunden)
     values ($1, $3, 1, 'sachlich', 'Sachliche Pruefung', 'objektverantwortlich', 48),
            ($2, $3, 2, 'zahlung', 'Bankuebergabe', 'objektverantwortlich', 24)
     on conflict (id) do nothing`,
    [STUFE_PRUEFUNG, STUFE_ZAHLUNG, DEFINITION],
  )
  await c.query(
    `insert into prozessknoten (id, definition_id, eltern_id, reihenfolge,
                                knotentyp, stufe_id)
     values ($1, $2, null, 0, 'nacheinander', null),
            ($3, $2, $1, 0, 'stufe', $5),
            ($4, $2, $1, 1, 'stufe', $6)
     on conflict (id) do nothing`,
    [WURZEL, DEFINITION, BLATT_PRUEFUNG, BLATT_ZAHLUNG, STUFE_PRUEFUNG, STUFE_ZAHLUNG],
  )
  await c.query(
    `insert into prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung)
     values ($1, $3, 0), ($2, $3, 0)
     on conflict do nothing`,
    [STUFE_PRUEFUNG, STUFE_ZAHLUNG, SACHLICH_RICHTIG],
  )

  const { rows } = await c.query<{ id: string }>(
    `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                           eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
     values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
             'demo/' || gen_random_uuid(), 'gruen')
     returning id`,
    [MANDANT, OBJEKT_42, GRUPPE],
  )
  const id = rows[0].id

  await c.query(
    `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                  rechnungsdatum, netto, steuer, brutto, zahlungsziel)
     values ($1, $2, 'RE-ZAHL-' || substr(md5(random()::text), 1, 6),
             current_date, 1000, 190, 1190, current_date + 14)`,
    [id, KREDITOR],
  )
  await c.query(
    `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                             steuersatz, betrag_brutto, umlagefaehig, quelle)
     values ($1, 1, $2, 1000, 19, 1190, true, 'mensch')`,
    [id, KONTO],
  )

  const lauf = await laufStarten(c, id)
  if (lauf !== null) {
    // Die Pruefstufe gleich mit abschliessen -- der Blick soll der
    // Zahlungsstufe gelten.
    await stempeln(c, {
      laufId: lauf.laufId,
      stufeId: STUFE_PRUEFUNG,
      benutzerId: ANNA,
      stempeltypId: SACHLICH_RICHTIG,
      entscheidung: 'freigabe',
    })
  }
  return id
})

console.log(`Beleg ${dokumentId} steht an der Bankuebergabe.`)
console.log('Postfach: http://localhost:3000/postfach')

await poolSchliessen()
