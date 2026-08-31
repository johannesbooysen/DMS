/**
 * Legt einen Beleg an, der an einer Kontierungsstufe steht.
 *
 * Der Seed-Ablauf hat keine Kontierungsstufe -- er bildet die Pruefkette ab,
 * nicht die Buchhaltung. Fuer den Blick in die Maske braucht es also einen
 * eigenen Ablauf. Eigene Kennungen, damit der Kontierungstest ihn nicht
 * mitabraeumt.
 *
 *   npx tsx scripts/kontierung-demo.ts
 */

import { alsBenutzer, poolSchliessen } from '../src/db'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const SACHLICH_RICHTIG = '60000000-0000-0000-0000-000000000001'
const ZUR_KLAERUNG = '60000000-0000-0000-0000-000000000002'

const GRUPPE = '40000000-0000-0000-0000-0000000000d0'
const DEFINITION = '65000000-0000-0000-0000-0000000000d0'
const STUFE = '66000000-0000-0000-0000-0000000000d0'
const WURZEL = '67000000-0000-0000-0000-0000000000d0'
const BLATT = '67000000-0000-0000-0000-0000000000d1'

const dokumentId = await alsBenutzer(ANNA, async (c) => {
  await c.query(
    `insert into ordnungsgruppe (id, mandant_id, name, kurzcode, sortierung)
     values ($1, $2, 'Kontierung (Demo)', 'KTD', 910)
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
     values ($1, $2, 1, 'kontierung', 'Kontierung', 'objektverantwortlich', 48)
     on conflict (id) do nothing`,
    [STUFE, DEFINITION],
  )
  await c.query(
    `insert into prozessknoten (id, definition_id, eltern_id, reihenfolge,
                                knotentyp, stufe_id)
     values ($1, $2, null, 0, 'nacheinander', null),
            ($3, $2, $1, 0, 'stufe', $4)
     on conflict (id) do nothing`,
    [WURZEL, DEFINITION, BLATT, STUFE],
  )
  await c.query(
    `insert into prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung)
     values ($1, $2, 0), ($1, $3, 1)
     on conflict do nothing`,
    [STUFE, SACHLICH_RICHTIG, ZUR_KLAERUNG],
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
                                  rechnungsdatum, netto, steuer, brutto)
     values ($1, $2, 'RE-DEMO-' || substr(md5(random()::text), 1, 6),
             current_date, 860.08, 163.42, 1023.50)`,
    [id, KREDITOR],
  )
  await laufStarten(c, id)
  return id
})

console.log(`Beleg ${dokumentId} steht an der Kontierungsstufe.`)
console.log('Postfach: http://localhost:3000/postfach')

await poolSchliessen()
