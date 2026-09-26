/**
 * Tests: Merkmale aus dem Text lernen, wenn ein Mensch zuordnet -- und die
 * Anschrift des Objekts als Rueckfall, wenn nichts gelernt ist.
 *
 * Die Zusage: Der erste Beleg eines Versorgers braucht einen Menschen, der
 * zweite nicht mehr.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { angabenNachtragen } from '../src/belege/nachtragen'
import { merkmaleImText } from '../src/lernen/merkmale'
import { objektVorschlagen } from '../src/lernen/zuordnung'
import { laufStarten } from '../src/workflow/engine'
import { belegEntfernen } from './hilfe/aufraeumen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const KREDITOR = '55000000-0000-0000-0000-000000000001'

const belege: string[] = []

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    return (await c.query(frage, werte)).rows as T[]
  } finally {
    c.release()
  }
}

async function belegMitText(text: string, kreditor = true): Promise<string> {
  return alsBenutzer(BERND, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, belegart, ordnungsgruppe_id, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl)
       values ($1, 'rechnung', $2, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'rot', 1) returning id`,
      [MANDANT, GRUPPE_BK],
    )
    const id = rows[0]!.id
    await c.query('insert into dokument_seite (dokument_id, seite, text) values ($1, 1, $2)', [id, text])
    if (kreditor) {
      await c.query('insert into rechnung_fakten (dokument_id, kreditor_id, wirtschaftsjahr) values ($1, $2, 2026)', [id, KREDITOR])
    }
    await laufStarten(c, id)
    belege.push(id)
    return id
  })
}

afterEach(async () => {
  for (const id of belege.splice(0)) await belegEntfernen(id)
  await direkt("delete from zuordnungs_merkmal where wert_normalisiert in ('40137953', '1LGZ0062822182', '77001')")
})

afterAll(poolSchliessen)

describe('Merkmale im Text', () => {
  it('findet beschriftete Nummern und laesst Daten und Betraege liegen', () => {
    const funde = merkmaleImText(
      'Kundennummer 40137953 Zählernummer 1LGZ0062822182 Vertragsnummer: 77001 Rechnungs-Nr. 12 Kunden-Nr. 01.09.2026 Betrag 1.234,56',
    )
    expect(funde).toEqual(
      expect.arrayContaining([
        { typ: 'kundennummer', wert: '40137953' },
        { typ: 'zaehlernummer', wert: '1LGZ0062822182' },
        { typ: 'vertragsnummer', wert: '77001' },
      ]),
    )
    expect(funde.some((f) => f.wert === '01.09.2026' || f.wert === '12')).toBe(false)
  })
})

describe('Lernen beim Zuordnen', () => {
  it('lernt die Kundennummer, und der naechste Beleg wird von selbst zugeordnet', async () => {
    const erster = await belegMitText('Stadtwerke Rechnung Kundennummer 40137953 Lieferstelle irgendwo')
    const ergebnis = await angabenNachtragen(BERND, erster, { objektId: OBJEKT_42 })
    expect(ergebnis.gelernt).toEqual(['Kundennummer 40137953'])

    const [m] = await direkt<{ objekt_id: string; kreditor_id: string; trefferzahl: number }>(
      "select objekt_id, kreditor_id, trefferzahl from zuordnungs_merkmal where merkmalstyp = 'kundennummer' and wert_normalisiert = '40137953' and aktiv",
    )
    expect(m).toMatchObject({ objekt_id: OBJEKT_42, kreditor_id: KREDITOR, trefferzahl: 1 })
    const [d] = await direkt<{ objekt_begruendung: string }>('select objekt_begruendung from dokument where id = $1', [erster])
    expect(d?.objekt_begruendung).toContain('gelernt: Kundennummer 40137953')

    // Der zweite Beleg desselben Versorgers: gruen, ohne Mensch.
    const zweiter = await belegMitText('Stadtwerke Rechnung Kundennummer 40137953 Abschlag Oktober')
    const vorschlag = await alsBenutzer(BERND, (c) => objektVorschlagen(c, zweiter))
    expect(vorschlag).toMatchObject({ objektId: OBJEKT_42, sicherheit: 'gruen' })
  })
})

describe('Anschrift als Rueckfall', () => {
  it('findet das Objekt an seiner Anschrift im Beleg, wenn nichts gelernt ist', async () => {
    const beleg = await belegMitText('Versorgung für Lindenweg 3, 00000 Musterstadt — Abrechnung ohne Kundennummer', false)
    const vorschlag = await alsBenutzer(BERND, (c) => objektVorschlagen(c, beleg))
    expect(vorschlag).toMatchObject({ objektId: OBJEKT_42, sicherheit: 'gruen' })
    expect(vorschlag.begruendung).toContain('Lindenweg 3')
  })

  it('bleibt rot, wenn zwei Anschriften im Beleg stehen', async () => {
    const beleg = await belegMitText('Sammelrechnung Lindenweg 3 und Amselgasse 12, Musterstadt', false)
    const vorschlag = await alsBenutzer(BERND, (c) => objektVorschlagen(c, beleg))
    expect(vorschlag).toMatchObject({ objektId: null, sicherheit: 'rot', mehrdeutig: true })
  })
})
