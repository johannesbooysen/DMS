/**
 * Tests der manuellen Zuordnung (Konzept 13).
 *
 * Ein Beleg ohne Objekt hat eine Aufgabe ohne Traeger. Geprueft wird die
 * Kette, die ihn wieder sichtbar macht: Er steht im Postfach "Ohne
 * Zustaendigkeit", das Nachtragen setzt Objekt und Fakten, die Aufgabe
 * bekommt danach die Objektverantwortliche -- und ein fremdes Haus kann
 * weder sehen noch nachtragen.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { angabenNachtragen, NachtragAbgelehnt, nachtragNoetig, nachtragsauswahl } from '../src/belege/nachtragen'
import { ohneZustaendigkeit, persoenlichesPostfach } from '../src/app/lib/postfach'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'

let beleg = ''

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

beforeEach(async () => {
  // Ein Scan, wie er hereinkommt: ohne Objekt, ohne Fakten, mit Lauf.
  beleg = await alsBenutzer(BERND, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, belegart, ordnungsgruppe_id, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, 'rechnung', $2, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'rot')
       returning id`,
      [MANDANT, GRUPPE_BK],
    )
    await laufStarten(c, rows[0]!.id)
    return rows[0]!.id
  })
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

describe('Ohne Zustaendigkeit', () => {
  it('fuehrt den Beleg ohne Objekt -- die Aufgabe hat niemanden', async () => {
    const [a] = await direkt<{ zugewiesen_benutzer: string | null }>(
      'select a.zugewiesen_benutzer from aufgabe a join dokument_lauf l on l.id = a.lauf_id where l.dokument_id = $1',
      [beleg],
    )
    expect(a?.zugewiesen_benutzer).toBeNull()
    const herrenlos = await ohneZustaendigkeit(ANNA)
    expect(herrenlos.some((z) => z.dokumentId === beleg)).toBe(true)
    expect(nachtragNoetig(herrenlos.find((z) => z.dokumentId === beleg)!)).toBe(true)
  })

  it('zeigt einem fremden Mandanten nichts davon', async () => {
    expect((await ohneZustaendigkeit(DORIS)).some((z) => z.dokumentId === beleg)).toBe(false)
  })
})

describe('Angaben nachtragen', () => {
  it('setzt Objekt und Fakten -- und die Aufgabe bekommt die Objektverantwortliche', async () => {
    const ergebnis = await angabenNachtragen(BERND, beleg, {
      objektId: OBJEKT_42,
      kreditorId: KREDITOR,
      rechnungsnummer: 'RE-NACHTRAG-1',
      rechnungsdatum: '2026-09-01',
      brutto: 1190,
    })
    expect(ergebnis.neuZugewiesen).toBe(1)

    const [d] = await direkt<{ objekt_id: string; rechnungsnummer: string; brutto: string; kreditor_id: string }>(
      `select d.objekt_id, f.rechnungsnummer, f.brutto, f.kreditor_id
         from dokument d join rechnung_fakten f on f.dokument_id = d.id where d.id = $1`,
      [beleg],
    )
    expect(d).toMatchObject({ objekt_id: OBJEKT_42, rechnungsnummer: 'RE-NACHTRAG-1', kreditor_id: KREDITOR })
    expect(Number(d?.brutto)).toBe(1190)

    // Nicht mehr herrenlos, sondern bei Anna -- der Objektverantwortlichen von 42.
    expect((await ohneZustaendigkeit(ANNA)).some((z) => z.dokumentId === beleg)).toBe(false)
    expect((await persoenlichesPostfach(ANNA)).some((z) => z.dokumentId === beleg)).toBe(true)
  })

  it('laesst leere Felder stehen und ueberschreibt gefuellte -- ein Mensch hat das letzte Wort', async () => {
    await angabenNachtragen(BERND, beleg, { objektId: OBJEKT_42, rechnungsnummer: 'ERST', brutto: 100 })
    await angabenNachtragen(BERND, beleg, { rechnungsnummer: 'ZWEIT' })
    const [f] = await direkt<{ rechnungsnummer: string; brutto: string }>(
      'select rechnungsnummer, brutto from rechnung_fakten where dokument_id = $1',
      [beleg],
    )
    expect(f?.rechnungsnummer).toBe('ZWEIT')
    expect(Number(f?.brutto)).toBe(100)
  })

  it('weist ein Objekt ab, das es im eigenen Haus nicht gibt', async () => {
    const [sued] = await direkt<{ id: string }>("select id from objekt where mandant_id <> $1 limit 1", [MANDANT])
    if (sued !== undefined) {
      await expect(angabenNachtragen(BERND, beleg, { objektId: sued.id })).rejects.toThrow(/Objekt gibt es nicht/)
    }
    await expect(angabenNachtragen(BERND, beleg, { rechnungsdatum: '1.9.2026' })).rejects.toThrow(/JJJJ-MM-TT/)
    await expect(angabenNachtragen(BERND, beleg, { brutto: -1 })).rejects.toThrow(NachtragAbgelehnt)
  })

  it('laesst einen fremden Mandanten nichts nachtragen', async () => {
    await expect(angabenNachtragen(DORIS, beleg, { objektId: OBJEKT_42 })).rejects.toThrow(/gibt es nicht/)
  })

  it('bietet nur die Listen des eigenen Hauses an', async () => {
    const auswahl = await nachtragsauswahl(DORIS)
    expect(auswahl.objekte.some((o) => o.id === OBJEKT_42)).toBe(false)
    expect(auswahl.kreditoren.some((k) => k.id === KREDITOR)).toBe(false)
  })
})
