/**
 * Tests der Mahnungsprüfung.
 *
 * Konzept 14: Eine Mahnung läuft nicht wie ein gewöhnlicher Beleg durch. Sie
 * wird gegen die Ursprungsrechnung geprüft, mit ihr verkettet und nie separat
 * bezahlt. Der teuerste Fehler wäre, auf eine Mahnung zu zahlen, deren
 * Rechnung längst beglichen ist.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { plausibilitaetPruefen } from '../src/pruefung/plausibilitaet'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const BEKANNTE_IBAN = 'DE00000000000000000000'

const angelegt: string[] = []

async function belegAnlegen(
  belegart: 'rechnung' | 'mahnung',
  rechnungsnummer: string,
  brutto: number,
  status = 'laufend',
): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, erfasst_von,
                             ampel_extraktion, status, eingang_am)
       values ($1, $2, $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), $4, 'gruen', $5,
               now() - interval '12 days')
       returning id`,
      [MANDANT, OBJEKT_42, belegart, ANNA, status],
    )
    const dokumentId = rows[0].id
    const netto = brutto / 1.19
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto, iban_im_beleg)
       values ($1, $2, $3, current_date, $4, $5, $6, $7)`,
      [dokumentId, KREDITOR, rechnungsnummer, netto, brutto - netto, brutto, BEKANNTE_IBAN],
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

async function hinweisVon(dokumentId: string, pruefung: string): Promise<string> {
  return alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ hinweis: string }>(
      `select hinweis from plausibilitaet_befund
        where dokument_id = $1 and pruefung = $2`,
      [dokumentId, pruefung],
    )
    return rows[0]?.hinweis ?? ''
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

describe('Mahnung ohne Rechnung', () => {
  it('meldet, dass der Beleg fehlt', async () => {
    const mahnung = await belegAnlegen('mahnung', 'RE-NICHT-DA', 120)
    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, mahnung))
    expect((await befundeVon(mahnung))['mahnung_ohne_rechnung']).toBe('orange')
  })
})

describe('Mahnung zu einer laufenden Rechnung', () => {
  it('nennt die Stufe und die Liegezeit', async () => {
    const rechnung = await belegAnlegen('rechnung', 'RE-IM-LAUF', 1000)
    await alsBenutzer(ANNA, (c) => laufStarten(c, rechnung))
    const mahnung = await belegAnlegen('mahnung', 'RE-IM-LAUF', 1015)

    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, mahnung))
    const hinweis = await hinweisVon(mahnung, 'mahnung_rechnung_im_lauf')

    expect(hinweis).toContain('Sachliche Pruefung')
    expect(hinweis).toContain('12 Tagen')
  })

  it('findet die Rechnung trotz abweichendem Betrag', async () => {
    // Eine Mahnung traegt Mahngebuehren -- gesucht wird deshalb ueber
    // Kreditor und Rechnungsnummer, nicht ueber den Betrag.
    const rechnung = await belegAnlegen('rechnung', 'RE-GEBUEHR', 1000)
    await alsBenutzer(ANNA, (c) => laufStarten(c, rechnung))
    const mahnung = await belegAnlegen('mahnung', 'RE-GEBUEHR', 1042.5)

    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, mahnung))
    expect(await befundeVon(mahnung)).not.toHaveProperty('mahnung_ohne_rechnung')
  })
})

describe('Mahnung zu einer erledigten Rechnung', () => {
  it('haelt an -- das ist der Doppelzahlungsfall', async () => {
    await belegAnlegen('rechnung', 'RE-BEZAHLT', 1000, 'archiviert')
    const mahnung = await belegAnlegen('mahnung', 'RE-BEZAHLT', 1015)

    const ergebnis = await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, mahnung))

    expect(ergebnis.gestoppt).toBe(true)
    expect((await befundeVon(mahnung))['mahnung_bereits_erledigt']).toBe('hart')
    expect(await hinweisVon(mahnung, 'mahnung_bereits_erledigt')).toContain('keinen Fall erneut zahlen')
  })
})

describe('Mahnung zu einer Rechnung in Klaerung', () => {
  it('nennt den Verantwortlichen und die Mahnkosten', async () => {
    const rechnung = await belegAnlegen('rechnung', 'RE-KLAERUNG', 1000)
    await alsBenutzer(ANNA, (c) =>
      c.query(
        `insert into klaerung (dokument_id, grund, kommentar, eroeffnet_von,
                               verantwortlich_benutzer, wiedervorlage_am)
         values ($1, 'Rueckfrage', 'Position unklar', $2, $2, current_date + 7)`,
        [rechnung, ANNA],
      ),
    )
    const mahnung = await belegAnlegen('mahnung', 'RE-KLAERUNG', 1015)

    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, mahnung))
    const hinweis = await hinweisVon(mahnung, 'mahnung_rechnung_in_klaerung')

    expect(hinweis).toContain('Anna Ahrens')
    expect(hinweis).toContain('Mahnkosten')
  })
})

describe('Verkettung', () => {
  it('verkettet die Mahnung mit der Rechnung', async () => {
    const rechnung = await belegAnlegen('rechnung', 'RE-KETTE', 1000)
    await alsBenutzer(ANNA, (c) => laufStarten(c, rechnung))
    const mahnung = await belegAnlegen('mahnung', 'RE-KETTE', 1015)

    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, mahnung))

    const beziehung = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ zu_dokument: string; art: string }>(
        'select zu_dokument, art from dokument_beziehung where von_dokument = $1',
        [mahnung],
      )
      return rows
    })
    expect(beziehung).toEqual([{ zu_dokument: rechnung, art: 'mahnung_zu' }])
  })

  it('verkettet auch dann, wenn der Befund harmlos ist', async () => {
    // Beide gehoeren in dieselbe Akte, unabhaengig vom Befund.
    const rechnung = await belegAnlegen('rechnung', 'RE-HARMLOS', 1000, 'in_aufbereitung')
    const mahnung = await belegAnlegen('mahnung', 'RE-HARMLOS', 1015)

    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, mahnung))

    const anzahl = await alsBenutzer(ANNA, async (c) => {
      const { rowCount } = await c.query(
        'select 1 from dokument_beziehung where von_dokument = $1',
        [mahnung],
      )
      return rowCount
    })
    expect(anzahl).toBe(1)
    expect(rechnung).toBeTruthy()
  })

  it('haelt eine Mahnung nicht fuer die Rechnung einer anderen Mahnung', async () => {
    await belegAnlegen('mahnung', 'RE-ZWEIMAL', 1015)
    const zweite = await belegAnlegen('mahnung', 'RE-ZWEIMAL', 1030)

    await alsBenutzer(ANNA, (c) => plausibilitaetPruefen(c, zweite))
    expect((await befundeVon(zweite))['mahnung_ohne_rechnung']).toBe('orange')
  })
})
