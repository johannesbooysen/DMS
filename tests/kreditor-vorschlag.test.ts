/**
 * Tests der Kreditorvorschlaege.
 *
 * Die Aufbereitung meldet einen unbekannten Rechnungssteller; ein Mensch
 * mit Stammdatenrecht uebernimmt ihn (Kreditor, Bankverbindung als "neu",
 * Belege zugeordnet), ordnet ihn einem vorhandenen zu oder verwirft ihn.
 * Ohne das Recht bewirkt nichts etwas -- und das wird gemeldet. Ein fremdes
 * Haus sieht nichts.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { extrahierenUndUebernehmen } from '../src/extraktion'
import { NichtErlaubt } from '../src/stammdaten'
import {
  vorschlaegeLaden,
  vorschlagUebernehmen,
  vorschlagVerwerfen,
  vorschlagZumBeleg,
  vorschlagZuordnen,
} from '../src/stammdaten/kreditor-vorschlag'
import { laufStarten } from '../src/workflow/engine'
import { belegEntfernen } from './hilfe/aufraeumen'
import { pdfBauen } from './hilfe/pdf-bauen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const MUSTERREINIGUNG = '55000000-0000-0000-0000-000000000001'

const belege: string[] = []
const kreditoren: string[] = []

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    return (await c.query(frage, werte)).rows as T[]
  } finally {
    c.release()
  }
}

async function belegMitVorschlag(name: string, ustId: string | null, iban: string | null): Promise<string> {
  return alsBenutzer(BERND, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'rot')
       returning id`,
      [MANDANT, OBJEKT_42, GRUPPE_BK],
    )
    const id = rows[0]!.id
    await laufStarten(c, id)
    await c.query('select app.kreditor_vorschlag_melden($1, $2, $3, $4)', [id, name, ustId, iban])
    belege.push(id)
    return id
  })
}

afterEach(async () => {
  for (const id of belege.splice(0)) await belegEntfernen(id)
  for (const id of kreditoren.splice(0)) {
    await direkt('delete from kreditor_bankverbindung where kreditor_id = $1', [id])
    await direkt('delete from kreditor where id = $1', [id])
  }
})

afterAll(poolSchliessen)

describe('Vorschlag aus der Aufbereitung', () => {
  it('meldet einen unbekannten Rechnungssteller -- und keinen bekannten', async () => {
    const unbekannt = await belegMitVorschlag('Neuland Haustechnik GmbH', 'DE999888777', 'DE02120300000000202051')
    const v = await vorschlagZumBeleg(BERND, unbekannt)
    expect(v).toMatchObject({ name: 'Neuland Haustechnik GmbH', ustId: 'DE999888777', iban: 'DE02120300000000202051', status: 'offen' })

    // Ueber die echte Extraktion: Der Kreditor wird ueber den Namen gefunden,
    // also kein Vorschlag. Ohne Anbieter liefert die Extraktion nichts --
    // deshalb wird hier ein Feld direkt geprueft: kein Vorschlag fuer den Beleg.
    const bekannt = await alsBenutzer(BERND, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
         values ($1, $2, 'rechnung', $3, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'rot') returning id`,
        [MANDANT, OBJEKT_42, GRUPPE_BK],
      )
      belege.push(rows[0]!.id)
      await extrahierenUndUebernehmen(c, {
        dokumentId: rows[0]!.id,
        inhalt: await pdfBauen([{ zeilen: ['Musterreinigung GmbH Rechnung'] }]),
        seiten: [{ seite: 1, text: 'Musterreinigung GmbH Rechnung RE-1' }],
      })
      return rows[0]!.id
    })
    expect(await vorschlagZumBeleg(BERND, bekannt)).toBeNull()
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    await belegMitVorschlag('Neuland Haustechnik GmbH', null, null)
    expect((await vorschlaegeLaden(DORIS)).some((v) => v.name === 'Neuland Haustechnik GmbH')).toBe(false)
  })
})

describe('Entscheidung', () => {
  it('uebernimmt: Kreditor mit IBAN als neu, alle Belege desselben Rechnungsstellers zugeordnet', async () => {
    const a = await belegMitVorschlag('Neuland Haustechnik GmbH', 'DE999888777', 'DE02120300000000202051')
    const b = await belegMitVorschlag('neuland haustechnik gmbh', null, null)
    const v = (await vorschlagZumBeleg(BERND, a))!
    expect(v.gleiche).toBe(1)

    const { kreditorId, belege: zahl } = await vorschlagUebernehmen(BERND, v.id, {
      name: 'Neuland Haustechnik GmbH',
      ustId: 'DE999888777',
      iban: 'DE02 1203 0000 0000 2020 51',
      email: 'rechnung@neuland.invalid',
    })
    kreditoren.push(kreditorId)
    expect(zahl).toBe(2)

    const [k] = await direkt<{ name: string; ust_id: string; email: string }>('select name, ust_id, email from kreditor where id = $1', [kreditorId])
    expect(k).toMatchObject({ name: 'Neuland Haustechnik GmbH', ust_id: 'DE999888777', email: 'rechnung@neuland.invalid' })
    const [bank] = await direkt<{ iban: string; status: string }>('select iban, status from kreditor_bankverbindung where kreditor_id = $1', [kreditorId])
    expect(bank).toMatchObject({ iban: 'DE02120300000000202051', status: 'neu' })
    const fakten = await direkt<{ dokument_id: string; kreditor_id: string }>(
      'select dokument_id, kreditor_id from rechnung_fakten where dokument_id = any($1)',
      [[a, b]],
    )
    expect(fakten.map((f) => f.kreditor_id)).toEqual([kreditorId, kreditorId])
    expect(await vorschlagZumBeleg(BERND, b)).toBeNull()
  })

  it('ordnet einem vorhandenen Kreditor zu', async () => {
    const a = await belegMitVorschlag('Musterreinigung GmbH & Co. KG', null, null)
    const v = (await vorschlagZumBeleg(BERND, a))!
    const { belege: zahl } = await vorschlagZuordnen(BERND, v.id, MUSTERREINIGUNG)
    expect(zahl).toBe(1)
    const [f] = await direkt<{ kreditor_id: string }>('select kreditor_id from rechnung_fakten where dokument_id = $1', [a])
    expect(f?.kreditor_id).toBe(MUSTERREINIGUNG)
    const [s] = await direkt<{ status: string }>('select status from kreditor_vorschlag where id = $1', [v.id])
    expect(s?.status).toBe('zugeordnet')
  })

  it('verwirft -- und laesst ohne Recht nichts zu', async () => {
    const a = await belegMitVorschlag('Irrlaeufer e. K.', null, null)
    const v = (await vorschlagZumBeleg(BERND, a))!
    await expect(vorschlagVerwerfen(ANNA, v.id)).rejects.toThrow(NichtErlaubt)
    await expect(vorschlagUebernehmen(ANNA, v.id, { name: 'Irrlaeufer e. K.' })).rejects.toThrow(NichtErlaubt)
    await vorschlagVerwerfen(BERND, v.id)
    expect(await vorschlagZumBeleg(BERND, a)).toBeNull()
    const [s] = await direkt<{ status: string }>('select status from kreditor_vorschlag where id = $1', [v.id])
    expect(s?.status).toBe('verworfen')
  })
})
