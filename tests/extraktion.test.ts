/**
 * Tests der Erkennung.
 *
 * Zwei Aussagen stehen im Mittelpunkt:
 *
 *   * Strukturierte Rechnungen brauchen kein Modell und tragen ihr Vertrauen
 *     per Definition (Konzept 14).
 *   * Ein fehlendes Feld ist besser als ein geratenes. Was nicht erkannt
 *     wurde, geht in die manuelle Erfassung — nicht in eine stille
 *     Fehlbuchung.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { DateisystemAblage } from '../src/ablage'
import { ampelAus, extrahierenUndUebernehmen, extraktionsvertrauen } from '../src/extraktion'
import { antwortLesen } from '../src/extraktion/ollama'
import { felderAusXml, istXmlRechnung, xmlAusPdf } from '../src/extraktion/zugferd'
import { dokumentAufnehmen, type Eingang } from '../src/ingest/aufnehmen'
import { aufbereiten } from '../src/worker/aufbereitung'
import { pdfBauen, rechnungsvorlage } from './hilfe/pdf-bauen'
import { ciiXml, ublXml, zugferdPdf, type Rechnungsdaten } from './hilfe/zugferd-bauen'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

const BELEG: Rechnungsdaten = {
  rechnungsnummer: 'RE-2026-4711',
  datum: '2026-08-14',
  kreditor: 'Musterreinigung GmbH',
  ustId: 'DE000000000',
  netto: 860,
  steuer: 163.4,
  brutto: 1023.4,
  iban: 'DE02120300000000202051',
  leistungVon: '2026-07-01',
  leistungBis: '2026-09-30',
}

let client: Client
let wurzel: string
let ablage: DateisystemAblage

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
  wurzel = await mkdtemp(join(tmpdir(), 'dms-extraktion-'))
  ablage = new DateisystemAblage(wurzel)
})

afterAll(async () => {
  await client.end()
  await rm(wurzel, { recursive: true, force: true })
})

async function alsAnna<T>(aktion: (c: Client) => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    await client.query('set local role dms_app')
    await client.query('select set_config($1, $2, true)', ['app.benutzer_id', ANNA])
    return await aktion(client)
  } finally {
    await client.query('rollback')
  }
}

function eingang(inhalt: Buffer, mime = 'application/pdf'): Eingang {
  return {
    mandantId: MANDANT,
    objektId: OBJEKT_42,
    belegart: 'rechnung',
    eingangskanal: 'mail',
    dateiname: 'rechnung.pdf',
    mime,
    inhalt,
  }
}

describe('ZUGFeRD: XML lesen', () => {
  it('liest alle Felder aus einer CrossIndustryInvoice', () => {
    const felder = felderAusXml(ciiXml(BELEG))
    const nach = new Map(felder.map((f) => [f.feldname, f]))

    expect(nach.get('rechnungsnummer')?.text).toBe('RE-2026-4711')
    expect(nach.get('rechnungsdatum')?.datum).toBe('2026-08-14')
    expect(nach.get('kreditor_name')?.text).toBe('Musterreinigung GmbH')
    expect(nach.get('brutto')?.zahl).toBe(1023.4)
    expect(nach.get('netto')?.zahl).toBe(860)
    expect(nach.get('iban_im_beleg')?.text).toBe('DE02120300000000202051')
    expect(nach.get('leistung_von')?.datum).toBe('2026-07-01')
  })

  it('setzt das Vertrauen per Definition auf 1', () => {
    // Bei einer strukturierten Rechnung gibt es nichts zu raten (Konzept 14).
    for (const feld of felderAusXml(ciiXml(BELEG))) {
      expect(feld.confidence).toBe(1)
    }
  })

  it('liest auch das UBL-Format der XRechnung', () => {
    const nach = new Map(felderAusXml(ublXml(BELEG)).map((f) => [f.feldname, f]))
    expect(nach.get('rechnungsnummer')?.text).toBe('RE-2026-4711')
    expect(nach.get('brutto')?.zahl).toBe(1023.4)
  })

  it('wandelt das knappe Datumsformat um', () => {
    // ZUGFeRD schreibt 20260814, die Datenbank will 2026-08-14.
    const nach = new Map(felderAusXml(ciiXml(BELEG)).map((f) => [f.feldname, f]))
    expect(nach.get('rechnungsdatum')?.datum).toBe('2026-08-14')
  })

  it('erkennt eine reine XML-Rechnung ohne PDF-Huelle', () => {
    expect(istXmlRechnung(Buffer.from(ciiXml(BELEG), 'utf8'))).toBe(true)
    expect(istXmlRechnung(Buffer.from('%PDF-1.7 ...', 'latin1'))).toBe(false)
  })

  it('holt das XML aus dem PDF heraus', async () => {
    const xml = await xmlAusPdf(await zugferdPdf(BELEG))
    expect(xml).toContain('RE-2026-4711')
  })

  it('findet in einem gewoehnlichen PDF keines', async () => {
    expect(await xmlAusPdf(await pdfBauen(rechnungsvorlage()))).toBeNull()
  })
})

describe('Vertrauen und Ampel', () => {
  const feld = (feldname: string, confidence: number) =>
    ({ feldname, confidence, text: 'x' }) as never

  it('nimmt das Minimum ueber die Pflichtfelder, nicht den Durchschnitt', () => {
    // Ein unsicher gelesener Betrag wird nicht dadurch besser, dass der
    // Lieferantenname eindeutig war.
    const vertrauen = extraktionsvertrauen([
      feld('kreditor_name', 1),
      feld('rechnungsnummer', 1),
      feld('rechnungsdatum', 1),
      feld('brutto', 0.4),
    ])
    expect(vertrauen).toBe(0.4)
  })

  it('gibt kein Vertrauen an, wenn ein Pflichtfeld fehlt', () => {
    const vertrauen = extraktionsvertrauen([feld('kreditor_name', 1), feld('brutto', 1)])
    expect(vertrauen).toBeNull()
  })

  it('faerbt die Ampel nach dem Vertrauen', () => {
    expect(ampelAus(1)).toBe('gruen')
    expect(ampelAus(0.8)).toBe('orange')
    expect(ampelAus(0.3)).toBe('rot')
    expect(ampelAus(null)).toBe('rot')
  })
})

describe('Antwort eines Modells lesen', () => {
  it('liest Felder mit Vertrauenswert', () => {
    const felder = antwortLesen(
      '{"rechnungsnummer":{"wert":"RE-1","confidence":0.9},"brutto":{"wert":"1.023,40","confidence":0.8}}',
    )
    const nach = new Map(felder.map((f) => [f.feldname, f]))
    expect(nach.get('rechnungsnummer')?.text).toBe('RE-1')
    expect(nach.get('brutto')?.zahl).toBe(1023.4)
    expect(nach.get('brutto')?.confidence).toBe(0.8)
  })

  it('verweigert einem Modell die volle Sicherheit', () => {
    // Die Eins ist strukturierten Rechnungen vorbehalten.
    const felder = antwortLesen('{"rechnungsnummer":{"wert":"RE-1","confidence":1}}')
    expect(felder[0].confidence).toBeLessThan(1)
  })

  it('ueberspringt Felder ausserhalb der Liste', () => {
    const felder = antwortLesen('{"geheimnis":{"wert":"x"},"rechnungsnummer":{"wert":"RE-1"}}')
    expect(felder.map((f) => f.feldname)).toEqual(['rechnungsnummer'])
  })

  it('ueberspringt ein Datum in falschem Format, statt es zu erfinden', () => {
    const felder = antwortLesen('{"rechnungsdatum":{"wert":"14. August"}}')
    expect(felder).toEqual([])
  })

  it('kommt mit Geschwaetz um das JSON herum zurecht', () => {
    const felder = antwortLesen('Gern! ```json\n{"rechnungsnummer":{"wert":"RE-2"}}\n``` Bitte.')
    expect(felder[0]?.text).toBe('RE-2')
  })

  it('gibt bei unlesbarer Antwort nichts zurueck', () => {
    expect(antwortLesen('Ich habe leider nichts gefunden.')).toEqual([])
  })
})

describe('Uebernahme in die Datenbank', () => {
  it('schreibt die Felder und fuellt die Rechnungsdaten', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(
        c as never,
        ablage,
        eingang(await zugferdPdf(BELEG)),
        ANNA,
      )
      const bericht = await extrahierenUndUebernehmen(c as never, {
        dokumentId: auf.dokumentId,
        inhalt: await zugferdPdf(BELEG),
        seiten: [],
      })

      const { rows: felder } = await c.query<{ feldname: string; quelle: string }>(
        'select feldname, quelle from extraktion_feld where dokument_id = $1 order by feldname',
        [auf.dokumentId],
      )
      const { rows: fakten } = await c.query<Record<string, unknown>>(
        'select * from rechnung_fakten where dokument_id = $1',
        [auf.dokumentId],
      )
      const { rows: dok } = await c.query<{ ampel_extraktion: string }>(
        'select ampel_extraktion from dokument where id = $1',
        [auf.dokumentId],
      )
      return { bericht, felder, fakten: fakten[0], ampel: dok[0].ampel_extraktion }
    })

    expect(ergebnis.bericht.quelle).toBe('zugferd')
    expect(ergebnis.bericht.vertrauen).toBe(1)
    expect(ergebnis.ampel).toBe('gruen')
    expect(ergebnis.felder.every((f) => f.quelle === 'zugferd')).toBe(true)
    expect(ergebnis.fakten['rechnungsnummer']).toBe('RE-2026-4711')
    expect(Number(ergebnis.fakten['brutto'])).toBe(1023.4)
  })

  it('ordnet den Kreditor ueber die USt-ID zu', async () => {
    const kreditor = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(
        c as never,
        ablage,
        eingang(await zugferdPdf(BELEG)),
        ANNA,
      )
      await extrahierenUndUebernehmen(c as never, {
        dokumentId: auf.dokumentId,
        inhalt: await zugferdPdf(BELEG),
        seiten: [],
      })
      const { rows } = await c.query<{ name: string }>(
        `select k.name from rechnung_fakten f join kreditor k on k.id = f.kreditor_id
          where f.dokument_id = $1`,
        [auf.dokumentId],
      )
      return rows[0]?.name ?? null
    })
    // Der Seed kennt diesen Kreditor mit derselben USt-ID.
    expect(kreditor).toBe('Musterreinigung GmbH')
  })

  it('setzt die Ampel auf rot, wenn niemand etwas erkennt', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const gewoehnlich = await pdfBauen(rechnungsvorlage())
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(gewoehnlich), ANNA)
      const bericht = await extrahierenUndUebernehmen(c as never, {
        dokumentId: auf.dokumentId,
        inhalt: gewoehnlich,
        seiten: [{ seite: 1, text: 'Musterreinigung GmbH Rechnung' }],
      })
      const { rows } = await c.query<{ ampel_extraktion: string }>(
        'select ampel_extraktion from dokument where id = $1',
        [auf.dokumentId],
      )
      return { bericht, ampel: rows[0].ampel_extraktion }
    })

    // Ohne eingebettetes XML und ohne eingeschaltetes Modell wird nicht
    // geraten -- der Beleg geht in die manuelle Erfassung.
    expect(ergebnis.bericht.quelle).toBe('keine')
    expect(ergebnis.ampel).toBe('rot')
  })

  it('ueberschreibt einen bestaetigten Wert nicht', async () => {
    const nummer = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(
        c as never,
        ablage,
        eingang(await zugferdPdf(BELEG)),
        ANNA,
      )
      await c.query(
        `insert into rechnung_fakten (dokument_id, rechnungsnummer) values ($1, 'VON-HAND')`,
        [auf.dokumentId],
      )
      await extrahierenUndUebernehmen(c as never, {
        dokumentId: auf.dokumentId,
        inhalt: await zugferdPdf(BELEG),
        seiten: [],
      })
      const { rows } = await c.query<{ rechnungsnummer: string }>(
        'select rechnungsnummer from rechnung_fakten where dokument_id = $1',
        [auf.dokumentId],
      )
      return rows[0].rechnungsnummer
    })
    expect(nummer).toBe('VON-HAND')
  })
})

describe('Aufbereitung mit Erkennung', () => {
  it('erkennt die Felder einer ZUGFeRD-Rechnung im ganzen Durchlauf', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const pdf = await zugferdPdf(BELEG)
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(pdf), ANNA)
      return aufbereiten(c as never, ablage, auf.dokumentId)
    })

    expect(ergebnis.weg).toBe('zugferd')
    expect(ergebnis.erkennung?.quelle).toBe('zugferd')
    expect(ergebnis.erkennung?.ampel).toBe('gruen')
  })
})
