/**
 * Tests der Plausibilitätsprüfungen.
 *
 * Der Kern von Konzept 14 sind zwei Aussagen, und beide werden hier geprüft:
 *
 *   * Die Ampel hat zwei Werte, und der schlechtere gewinnt. Ein perfekt
 *     gelesener Beleg kann fachlich falsch sein.
 *   * Zwei Prüfungen färben nicht nur, sie halten an: IBAN und Dublette.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  ampelAusBefunden,
  gesamtampel,
  plausibilitaetPruefen,
} from '../src/pruefung/plausibilitaet'
import { laufStarten } from '../src/workflow/engine'
import { VERWALTER } from './hilfe/kennungen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const BEKANNTE_IBAN = 'DE00000000000000000000'

const angelegt: string[] = []

/** Legt einen Beleg samt Rechnungsdaten an. Alle Werte einzeln setzbar. */
async function belegAnlegen(
  fakten: {
    kreditorId?: string | null
    rechnungsnummer?: string | null
    rechnungsdatum?: string | null
    netto?: number | null
    steuer?: number | null
    brutto?: number | null
    iban?: string | null
  } = {},
  ampelExtraktion: string | null = 'gruen',
): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, erfasst_von, ampel_extraktion)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), $3, $4)
       returning id`,
      [MANDANT, OBJEKT_42, ANNA, ampelExtraktion],
    )
    const dokumentId = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto, iban_im_beleg)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        dokumentId,
        fakten.kreditorId === undefined ? KREDITOR : fakten.kreditorId,
        fakten.rechnungsnummer === undefined ? 'RE-PLAUS-1' : fakten.rechnungsnummer,
        fakten.rechnungsdatum === undefined ? '2026-08-14' : fakten.rechnungsdatum,
        fakten.netto === undefined ? 860 : fakten.netto,
        fakten.steuer === undefined ? 163.4 : fakten.steuer,
        fakten.brutto === undefined ? 1023.4 : fakten.brutto,
        fakten.iban === undefined ? BEKANNTE_IBAN : fakten.iban,
      ],
    )
    return dokumentId
  })
  angelegt.push(id)
  return id
}

async function befundeVon(dokumentId: string): Promise<Record<string, string>> {
  return alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ pruefung: string; schwere: string }>(
      'select pruefung, schwere from plausibilitaet_befund where dokument_id = $1',
      [dokumentId],
    )
    return Object.fromEntries(rows.map((r) => [r.pruefung, r.schwere]))
  })
}

async function ampeln(dokumentId: string) {
  return alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<Record<string, string>>(
      'select ampel_extraktion, ampel_plausibilitaet, ampel_gesamt from dokument where id = $1',
      [dokumentId],
    )
    return rows[0]
  })
}

beforeEach(() => {
  angelegt.length = 0
})

afterEach(async () => {
  const c = await verbindungspool().connect()
  try {
    await c.query('alter table stempel_ereignis disable trigger stempel_ereignis_unveraenderlich')
    await c.query('delete from dokument where id = any($1)', [angelegt])
  } finally {
    await c.query('alter table stempel_ereignis enable trigger stempel_ereignis_unveraenderlich')
    c.release()
  }
})

afterAll(poolSchliessen)

describe('Die Gesamtampel', () => {
  it('nimmt den schlechteren der beiden Werte', () => {
    expect(gesamtampel('gruen', 'orange')).toBe('orange')
    expect(gesamtampel('orange', 'gruen')).toBe('orange')
    expect(gesamtampel('gruen', 'rot')).toBe('rot')
    expect(gesamtampel('rot', 'gruen')).toBe('rot')
  })

  it('ist gruen nur, wenn beide gruen sind', () => {
    expect(gesamtampel('gruen', 'gruen')).toBe('gruen')
  })

  it('wertet eine fehlende Extraktion als rot', () => {
    expect(gesamtampel(null, 'gruen')).toBe('rot')
  })

  it('macht aus einem harten Befund rot, aus orange orange', () => {
    expect(ampelAusBefunden([{ pruefung: 'x', schwere: 'hart', hinweis: '' }])).toBe('rot')
    expect(ampelAusBefunden([{ pruefung: 'x', schwere: 'orange', hinweis: '' }])).toBe('orange')
    expect(ampelAusBefunden([])).toBe('gruen')
  })
})

describe('IBAN gegen den bekannten Kreditor', () => {
  it('laesst die hinterlegte Bankverbindung durch', async () => {
    const beleg = await belegAnlegen()
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect(await befundeVon(beleg)).not.toHaveProperty('iban_unbekannt')
  })

  it('haelt bei einer fremden Bankverbindung an', async () => {
    // Der klassische Betrugsfall: Beleg makellos, nur das Geld ginge woanders hin.
    const beleg = await belegAnlegen({ iban: 'DE99999999999999999999' })
    const ergebnis = await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))

    expect(ergebnis.gestoppt).toBe(true)
    expect((await befundeVon(beleg))['iban_unbekannt']).toBe('hart')
    expect((await ampeln(beleg))['ampel_gesamt']).toBe('rot')
  })

  it('greift nicht bei einem Kreditor ohne hinterlegte Bankverbindung', async () => {
    // Einen Kreditor anzulegen ist Stammdatenpflege und braucht seit
    // 20260903100000 das Recht dazu -- Anna hat es nicht.
    const beleg = await alsBenutzer(VERWALTER, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into kreditor (mandant_id, name) values ($1, 'Neu GmbH') returning id`,
        [MANDANT],
      )
      return rows[0].id
    })
    const dokument = await belegAnlegen({ kreditorId: beleg, iban: 'DE99999999999999999999' })
    const ergebnis = await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, dokument))
    // Nichts zu vergleichen ist kein Verdacht.
    expect(ergebnis.gestoppt).toBe(false)
  })
})

describe('Dublette', () => {
  it('erkennt dasselbe Papier an Kreditor, Nummer und Betrag', async () => {
    await belegAnlegen({ rechnungsnummer: 'RE-DOPPELT' })
    const zweiter = await belegAnlegen({ rechnungsnummer: 'RE-DOPPELT' })

    const ergebnis = await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, zweiter))
    expect(ergebnis.gestoppt).toBe(true)
    expect((await befundeVon(zweiter))['dublette']).toBe('hart')
  })

  it('haelt einen anderen Betrag nicht fuer eine Dublette', async () => {
    await belegAnlegen({ rechnungsnummer: 'RE-AEHNLICH', brutto: 1023.4 })
    const zweiter = await belegAnlegen({ rechnungsnummer: 'RE-AEHNLICH', brutto: 500 })

    const ergebnis = await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, zweiter))
    expect(await befundeVon(zweiter)).not.toHaveProperty('dublette')
    expect(ergebnis.gestoppt).toBe(false)
  })

  it('haelt wiederkehrende Rechnungen ohne Nummer nicht fuer Dubletten', async () => {
    await belegAnlegen({ rechnungsnummer: null })
    const zweiter = await belegAnlegen({ rechnungsnummer: null })
    const ergebnis = await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, zweiter))
    expect(ergebnis.gestoppt).toBe(false)
  })
})

describe('Betragsprobe', () => {
  it('meldet, wenn netto plus Steuer nicht den Rechnungsbetrag ergibt', async () => {
    // Genau der Fall, den ein zu kleines Modell erzeugt hat: sicher gelesene,
    // aber unsinnige Betraege (docs/messungen.md).
    const beleg = await belegAnlegen({ netto: 0.8, steuer: 0.19, brutto: 0.95 })
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect((await befundeVon(beleg))['betragsprobe']).toBe('orange')
  })

  it('laesst einen Cent Rundung durchgehen', async () => {
    const beleg = await belegAnlegen({ netto: 860, steuer: 163.4, brutto: 1023.41 })
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect(await befundeVon(beleg)).not.toHaveProperty('betragsprobe')
  })

  it('prueft nicht, wenn ein Betrag fehlt', async () => {
    const beleg = await belegAnlegen({ steuer: null })
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect(await befundeVon(beleg)).not.toHaveProperty('betragsprobe')
  })
})

describe('Pflichtangaben nach Paragraf 14 UStG', () => {
  it('meldet fehlende Angaben und nennt sie', async () => {
    const beleg = await belegAnlegen({ rechnungsnummer: null, netto: null })
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))

    const hinweis = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ hinweis: string }>(
        `select hinweis from plausibilitaet_befund
          where dokument_id = $1 and pruefung = 'pflichtangaben_ust'`,
        [beleg],
      )
      return rows[0]?.hinweis ?? ''
    })
    expect(hinweis).toContain('Rechnungsnummer')
    expect(hinweis).toContain('Nettobetrag')
  })

  it('schweigt bei vollstaendigem Beleg', async () => {
    const beleg = await belegAnlegen()
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect(await befundeVon(beleg)).not.toHaveProperty('pflichtangaben_ust')
  })
})

describe('Kreditor', () => {
  it('meldet einen nicht zugeordneten Rechnungssteller', async () => {
    const beleg = await belegAnlegen({ kreditorId: null })
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect((await befundeVon(beleg))['kreditor_unbekannt']).toBe('orange')
  })
})

describe('Harte Befunde halten an', () => {
  it('setzt den Lauf auf Klaerung und legt einen Klaerungsfall an', async () => {
    const beleg = await belegAnlegen({ iban: 'DE99999999999999999999' })
    await alsBenutzer(ANNA, (c) => laufStarten(c, beleg))
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))

    const stand = await alsBenutzer(ANNA, async (c) => {
      const { rows: lauf } = await c.query<{ status: string }>(
        'select status from dokument_lauf where dokument_id = $1',
        [beleg],
      )
      const { rows: klaerung } = await c.query<{ kommentar: string; kategorie: string }>(
        'select kommentar, kategorie from klaerung where dokument_id = $1',
        [beleg],
      )
      return { lauf: lauf[0]?.status, klaerung: klaerung[0] }
    })

    expect(stand.lauf).toBe('klaerung')
    expect(stand.klaerung?.kategorie).toBe('iban_unbekannt')
    expect(stand.klaerung?.kommentar).toContain('Bankverbindung')
  })

  it('laesst einen unauffaelligen Beleg weiterlaufen', async () => {
    const beleg = await belegAnlegen()
    await alsBenutzer(ANNA, (c) => laufStarten(c, beleg))
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))

    const status = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ status: string }>(
        'select status from dokument_lauf where dokument_id = $1',
        [beleg],
      )
      return rows[0]?.status
    })
    expect(status).toBe('laufend')
  })
})

describe('Erneutes Pruefen', () => {
  it('loescht Befunde, die behoben sind', async () => {
    const beleg = await belegAnlegen({ kreditorId: null })
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect(await befundeVon(beleg)).toHaveProperty('kreditor_unbekannt')

    await alsBenutzer(ANNA, (c) =>
      c.query('update rechnung_fakten set kreditor_id = $2 where dokument_id = $1', [
        beleg,
        KREDITOR,
      ]),
    )
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))

    expect(await befundeVon(beleg)).not.toHaveProperty('kreditor_unbekannt')
  })

  it('faerbt die Ampel danach wieder gruen', async () => {
    const beleg = await belegAnlegen({ kreditorId: null })
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect((await ampeln(beleg))['ampel_gesamt']).toBe('orange')

    await alsBenutzer(ANNA, (c) =>
      c.query('update rechnung_fakten set kreditor_id = $2 where dokument_id = $1', [
        beleg,
        KREDITOR,
      ]),
    )
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, beleg))
    expect((await ampeln(beleg))['ampel_gesamt']).toBe('gruen')
  })
})
