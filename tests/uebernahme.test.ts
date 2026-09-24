/**
 * Tests der Bestandsuebernahme (Konzept 24.12).
 *
 * Drei Zusagen: Ein Altbeleg wird ein **archivierter** Beleg mit den Fakten
 * aus dem Export und dem Eingangsdatum von damals, nie ein neuer Eingang.
 * Derselbe Altbeleg wird nicht zweimal uebernommen. Und was scheitert,
 * steht mit Grund im Protokoll -- fuer den eigenen Mandanten, fuer keinen
 * anderen.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { pdfBauen, rechnungsvorlage } from './hilfe/pdf-bauen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import type { Ablage } from '../src/ablage'
import {
  belegUebernehmen,
  bestandPruefen,
  csvLesen,
  datumLesen,
  zeileLesen,
  zuordnungPruefen,
  type Bestandsbeleg,
  type Zuordnung,
} from '../src/uebernahme'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'

class Merkablage implements Ablage {
  readonly dateien = new Map<string, Buffer>()
  async schreiben(schluessel: string, inhalt: Buffer): Promise<void> {
    this.dateien.set(schluessel, inhalt)
  }
  async lesen(schluessel: string): Promise<Buffer> {
    const treffer = this.dateien.get(schluessel)
    if (treffer === undefined) throw new Error('nicht gefunden')
    return treffer
  }
  async entfernen(schluessel: string): Promise<void> {
    this.dateien.delete(schluessel)
  }
}

const ZUORDNUNG: Zuordnung = {
  quelle: 'test',
  index: 'index.csv',
  datumsformat: 'DD.MM.YYYY',
  belegart: 'rechnung',
  spalten: {
    datei: 'Datei',
    altKennung: 'ID',
    kreditor: 'Lieferant',
    rechnungsnummer: 'Rechnungsnr',
    rechnungsdatum: 'Datum',
    brutto: 'Brutto',
    objektnummer: 'Objekt',
    ordnungsgruppe: 'Gruppe',
    eingangAm: 'Eingang',
  },
}

let pdf: Buffer
const angelegt: string[] = []

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

beforeAll(async () => {
  pdf = await pdfBauen(rechnungsvorlage())
})

afterEach(async () => {
  // Rueckwaerts: Eine Dublette verweist auf ihr Original (`dublette_von`)
  // und muss vor ihm weg.
  for (const id of angelegt.splice(0).reverse()) await belegEntfernen(id)
  await direkt('alter table uebernahme_eintrag disable trigger uebernahme_eintrag_unveraenderlich')
  await direkt("delete from uebernahme_eintrag where quelle = 'test'")
  await direkt('alter table uebernahme_eintrag enable trigger uebernahme_eintrag_unveraenderlich')
  await direkt("delete from kreditor where name = 'Neuer Altlieferant e.K.'")
})

afterAll(poolSchliessen)

function beleg(teil: Partial<Bestandsbeleg> = {}): Bestandsbeleg {
  return {
    zeile: 2,
    datei: 'alt/0001.pdf',
    altKennung: 'AMG-0001',
    belegart: 'rechnung',
    kreditor: 'Musterreinigung GmbH',
    rechnungsnummer: 'ALT-2019-0001',
    rechnungsdatum: '2019-03-14',
    brutto: 1240,
    netto: 1042.02,
    objektnummer: '42',
    ordnungsgruppe: null,
    eingangAm: '2019-03-18',
    betreff: null,
    ...teil,
  }
}

describe('Die Zuordnung', () => {
  it('liest CSV mit Semikolon, Anfuehrungszeichen, Zeilenumbruch im Feld und BOM', () => {
    const zeilen = csvLesen('﻿ID;Lieferant;Brutto\r\n1;"Müller; Söhne";"1.240,00"\r\n2;"Zeile\nzwei";5\r\n')
    expect(zeilen).toEqual([
      { ID: '1', Lieferant: 'Müller; Söhne', Brutto: '1.240,00' },
      { ID: '2', Lieferant: 'Zeile\nzwei', Brutto: '5' },
    ])
  })

  it('erkennt das Trennzeichen an der Kopfzeile', () => {
    expect(csvLesen('a,b\n1,2\n')).toEqual([{ a: '1', b: '2' }])
  })

  it('macht aus einer Zeile einen Altbeleg -- Datum und Betrag deutsch', () => {
    const b = zeileLesen(
      { Datei: 'x.pdf', ID: 'A1', Lieferant: 'Firma', Rechnungsnr: 'R1', Datum: '14.03.2019 09:12', Brutto: '1.240,00', Objekt: '42', Gruppe: '', Eingang: '' },
      ZUORDNUNG,
      2,
    )
    expect(b.rechnungsdatum).toBe('2019-03-14')
    expect(b.brutto).toBe(1240)
    expect(b.ordnungsgruppe).toBeNull()
    expect(b.eingangAm).toBeNull()
    expect(datumLesen('2019-03-14', 'YYYY-MM-DD')).toBe('2019-03-14')
    expect(datumLesen('unsinn', 'DD.MM.YYYY')).toBeNull()
  })

  it('weist eine Zuordnung mit unbekannter Spalte ab -- bevor eine Zeile gelesen wird', () => {
    expect(() => zuordnungPruefen({ ...ZUORDNUNG, spalten: { ...ZUORDNUNG.spalten, kreditor: 'Firma' } }, ['Datei', 'ID'])).toThrow(
      /spalten.kreditor/,
    )
    expect(() => zuordnungPruefen({ index: 'x.csv', spalten: { datei: 'D' } })).toThrow(/altKennung/)
  })
})

describe('Die Probe', () => {
  it('meldet fehlende Datei, unbekanntes Objekt und unbekannten Kreditor -- ohne zu schreiben', async () => {
    const bericht = await alsBenutzer(BERND, (c) =>
      bestandPruefen(
        c,
        'test',
        [beleg(), beleg({ altKennung: 'AMG-0002', datei: 'fehlt.pdf', objektnummer: '999', kreditor: 'Unbekannt AG' })],
        async (datei) => datei !== 'fehlt.pdf',
      ),
    )
    expect(bericht[0]?.fehler).toEqual([])
    expect(bericht[1]?.fehler.join('; ')).toMatch(/Datei nicht gefunden.*Objekt 999/)
    expect(bericht[1]?.hinweise.join('; ')).toMatch(/Unbekannt AG.*wird angelegt/)
    const [{ n }] = await direkt<{ n: string }>("select count(*) as n from uebernahme_eintrag where quelle = 'test'")
    expect(Number(n)).toBe(0)
  })
})

describe('Die Uebernahme', () => {
  it('macht aus dem Altbeleg einen archivierten Beleg mit Fakten und altem Eingangsdatum', async () => {
    const ablage = new Merkablage()
    const ergebnis = await belegUebernehmen(ablage, BERND, MANDANT, beleg(), pdf, { kennung: 'lauf-1', quelle: 'test' })
    expect(ergebnis.ergebnis).toBe('uebernommen')
    angelegt.push(ergebnis.dokumentId as string)

    const [d] = await direkt<{
      status: string
      eingangskanal: string
      eingang: string
      seitenzahl: number
      rechnungsnummer: string
      brutto: string
      kreditor: string
      archiviert: boolean
      laeufe: string
    }>(
      `select d.status, d.eingangskanal, to_char(d.eingang_am, 'YYYY-MM-DD') as eingang, d.seitenzahl,
              f.rechnungsnummer, f.brutto, k.name as kreditor,
              exists (select 1 from archiv_eintrag a where a.dokument_id = d.id) as archiviert,
              (select count(*) from dokument_lauf l where l.dokument_id = d.id) as laeufe
         from dokument d
         left join rechnung_fakten f on f.dokument_id = d.id
         left join kreditor k on k.id = f.kreditor_id
        where d.id = $1`,
      [ergebnis.dokumentId],
    )
    expect(d?.status).toBe('archiviert')
    expect(d?.eingangskanal).toBe('uebernahme')
    expect(d?.eingang).toBe('2019-03-18')
    expect(d?.seitenzahl).toBeGreaterThan(0)
    expect(d?.rechnungsnummer).toBe('ALT-2019-0001')
    expect(Number(d?.brutto)).toBe(1240)
    expect(d?.kreditor).toBe('Musterreinigung GmbH')
    expect(d?.archiviert).toBe(true)
    // Kein Lauf: Ein Beleg von 2019 geht nicht noch einmal durch die Pruefung.
    expect(Number(d?.laeufe)).toBe(0)
  }, 30_000)

  it('setzt die Ampel nach den uebernommenen Fakten, nicht nach dem Geratenen', async () => {
    const ablage = new Merkablage()
    const ergebnis = await belegUebernehmen(ablage, BERND, MANDANT, beleg(), pdf, { kennung: 'lauf-ampel', quelle: 'test' })
    angelegt.push(ergebnis.dokumentId as string)
    const [d] = await direkt<{ ampel_extraktion: string; befunde: string | null }>(
      `select d.ampel_extraktion,
              (select string_agg(b.pruefung, ',') from plausibilitaet_befund b where b.dokument_id = d.id) as befunde
         from dokument d where d.id = $1`,
      [ergebnis.dokumentId],
    )
    // Nichts geraten: Die Fakten stammen aus dem Altsystem.
    expect(d?.ampel_extraktion).toBe('gruen')
    // Der Kreditor steht am Beleg -- ein Befund "unbekannt" waere der Stand von vor dem Upsert.
    expect(d?.befunde ?? '').not.toContain('kreditor_unbekannt')
  }, 30_000)

  it('uebernimmt dieselbe Datei kein zweites Mal -- die Dublette steht im Protokoll', async () => {
    const ablage = new Merkablage()
    const erste = await belegUebernehmen(ablage, BERND, MANDANT, beleg(), pdf, { kennung: 'lauf-2', quelle: 'test' })
    angelegt.push(erste.dokumentId as string)
    const zweite = await belegUebernehmen(
      ablage,
      BERND,
      MANDANT,
      beleg({ altKennung: 'AMG-0001b' }),
      pdf,
      { kennung: 'lauf-2', quelle: 'test' },
    )
    expect(zweite.ergebnis).toBe('dublette')
    if (zweite.dokumentId !== null) angelegt.push(zweite.dokumentId)
    const zeilen = await direkt<{ ergebnis: string }>("select ergebnis from uebernahme_eintrag where lauf = 'lauf-2' order by zeitpunkt")
    expect(zeilen.map((z) => z.ergebnis)).toEqual(['uebernommen', 'dublette'])
  }, 30_000)

  it('legt einen unbekannten Kreditor an, wenn der Uebernehmende Stammdaten pflegen darf -- sonst Fehler mit Grund', async () => {
    const ablage = new Merkablage()
    const zaehlen = async () =>
      Number((await direkt<{ n: string }>("select count(*) as n from dokument where eingangskanal = 'uebernahme'"))[0]?.n)
    const vorher = await zaehlen()
    // Anna darf keine Stammdaten pflegen: Fehler, zurueckgerollt, vermerkt.
    const anna = await belegUebernehmen(
      ablage,
      ANNA,
      MANDANT,
      beleg({ kreditor: 'Neuer Altlieferant e.K.' }),
      pdf,
      { kennung: 'lauf-3', quelle: 'test' },
    )
    expect(anna.ergebnis).toBe('fehler')
    expect(anna.grund).toMatch(/stammdaten_pflegen/)
    // Zurueckgerollt heisst: kein halber Beleg bleibt liegen.
    expect(await zaehlen()).toBe(vorher)

    // Bernd darf: der Kreditor entsteht, der Beleg haengt daran.
    const bernd = await belegUebernehmen(
      ablage,
      BERND,
      MANDANT,
      beleg({ kreditor: 'Neuer Altlieferant e.K.' }),
      pdf,
      { kennung: 'lauf-3', quelle: 'test' },
    )
    expect(bernd.ergebnis).toBe('uebernommen')
    angelegt.push(bernd.dokumentId as string)
    const zeilen = await direkt<{ ergebnis: string; grund: string | null }>(
      "select ergebnis, grund from uebernahme_eintrag where lauf = 'lauf-3' order by zeitpunkt",
    )
    expect(zeilen.map((z) => z.ergebnis)).toEqual(['fehler', 'uebernommen'])
  }, 30_000)

  it('zeigt das Protokoll nur dem eigenen Mandanten', async () => {
    const ablage = new Merkablage()
    const e = await belegUebernehmen(ablage, BERND, MANDANT, beleg(), pdf, { kennung: 'lauf-4', quelle: 'test' })
    angelegt.push(e.dokumentId as string)
    const fremd = await alsBenutzer(DORIS, async (c) => {
      const { rows } = await c.query("select count(*) as n from uebernahme_eintrag where lauf = 'lauf-4'")
      return Number(rows[0]?.n)
    })
    expect(fremd).toBe(0)
    const eigen = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query("select count(*) as n from uebernahme_eintrag where lauf = 'lauf-4'")
      return Number(rows[0]?.n)
    })
    expect(eigen).toBe(1)
  }, 30_000)

  it('laesst das Protokoll nicht aendern', async () => {
    const ablage = new Merkablage()
    const e = await belegUebernehmen(ablage, BERND, MANDANT, beleg(), pdf, { kennung: 'lauf-5', quelle: 'test' })
    angelegt.push(e.dokumentId as string)
    await expect(direkt("update uebernahme_eintrag set ergebnis = 'fehler' where lauf = 'lauf-5'")).rejects.toThrow(
      /append-only/,
    )
  }, 30_000)
})
