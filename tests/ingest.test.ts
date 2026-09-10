/**
 * Tests des Eingangs.
 *
 * Jeder Test laeuft unter der Anwendungsrolle in einer Transaktion, die
 * zurueckgerollt wird. Die Ablage schreibt in ein temporaeres Verzeichnis.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { DateisystemAblage, inhaltHash } from '../src/ablage'
import { dokumentAufnehmen, type Eingang } from '../src/ingest/aufnehmen'
import { dubletteSuchen } from '../src/ingest/dublette'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:15322/postgres'

const MANDANT_NORD = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const D1 = '70000000-0000-0000-0000-000000000001'

let client: Client
let ablageWurzel: string
let ablage: DateisystemAblage

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
  ablageWurzel = await mkdtemp(join(tmpdir(), 'dms-ablage-'))
  ablage = new DateisystemAblage(ablageWurzel)
})

afterAll(async () => {
  await client.end()
  await rm(ablageWurzel, { recursive: true, force: true })
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

function eingang(inhalt: string, ueberschreibungen: Partial<Eingang> = {}): Eingang {
  return {
    mandantId: MANDANT_NORD,
    objektId: OBJEKT_42,
    belegart: 'rechnung',
    eingangskanal: 'mail',
    dateiname: 'rechnung.pdf',
    mime: 'application/pdf',
    inhalt: Buffer.from(inhalt, 'utf8'),
    ...ueberschreibungen,
  }
}

describe('Aufnahme', () => {
  it('legt Dokument, Datei und Lauf an', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang('beleg-neu-1'), ANNA)
      const { rows: dateien } = await c.query<{ variante: string; groesse: string }>(
        'select variante, groesse from dokument_datei where dokument_id = $1',
        [auf.dokumentId],
      )
      const { rows: laeufe } = await c.query<{ status: string }>(
        'select status from dokument_lauf where dokument_id = $1',
        [auf.dokumentId],
      )
      return { auf, dateien, laeufe }
    })

    expect(ergebnis.auf.dublette.istDublette).toBe(false)
    expect(ergebnis.auf.laufGestartet).toBe(true)
    expect(ergebnis.dateien).toHaveLength(1)
    expect(ergebnis.dateien[0].variante).toBe('original')
    expect(ergebnis.laeufe).toEqual([{ status: 'laufend' }])
  })

  it('legt das Original in der Ablage ab', async () => {
    const gelesen = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang('beleg-ablage'), ANNA)
      const { rows } = await c.query<{ storage_key: string }>(
        `select storage_key from dokument_datei where dokument_id = $1 and variante = 'original'`,
        [auf.dokumentId],
      )
      return ablage.lesen(rows[0].storage_key)
    })
    expect(gelesen.toString('utf8')).toBe('beleg-ablage')
  })

  it('bildet den Hash ueber die Bytes der Datei', async () => {
    const inhalt = Buffer.from('beleg-hash', 'utf8')
    const ergebnis = await alsAnna((c) =>
      dokumentAufnehmen(c as never, ablage, eingang('beleg-hash'), ANNA),
    )
    expect(ergebnis.hash).toBe(inhaltHash(inhalt))
    expect(ergebnis.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('Dublettenpruefung', () => {
  it('erkennt dieselbe Datei am Inhaltshash und startet keinen Lauf', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const erst = await dokumentAufnehmen(c as never, ablage, eingang('beleg-doppelt'), ANNA)
      const zweit = await dokumentAufnehmen(c as never, ablage, eingang('beleg-doppelt'), ANNA)
      const { rows } = await c.query<{ status: string; ampel_gesamt: string; dublette_von: string }>(
        'select status, ampel_gesamt, dublette_von from dokument where id = $1',
        [zweit.dokumentId],
      )
      const { rowCount: laeufe } = await c.query(
        'select 1 from dokument_lauf where dokument_id = $1',
        [zweit.dokumentId],
      )
      return { erst, zweit, dokument: rows[0], laeufe }
    })

    expect(ergebnis.zweit.dublette.istDublette).toBe(true)
    expect(ergebnis.zweit.dublette.stufe).toBe('inhalt')
    expect(ergebnis.zweit.dublette.originalId).toBe(ergebnis.erst.dokumentId)
    expect(ergebnis.dokument.status).toBe('abgelehnt')
    expect(ergebnis.dokument.ampel_gesamt).toBe('rot')
    expect(ergebnis.dokument.dublette_von).toBe(ergebnis.erst.dokumentId)
    expect(ergebnis.laeufe).toBe(0)
  })

  it('verkettet die Dublette mit dem Original', async () => {
    const beziehung = await alsAnna(async (c) => {
      const erst = await dokumentAufnehmen(c as never, ablage, eingang('beleg-kette'), ANNA)
      const zweit = await dokumentAufnehmen(c as never, ablage, eingang('beleg-kette'), ANNA)
      const { rows } = await c.query<{ art: string; zu_dokument: string }>(
        'select art, zu_dokument from dokument_beziehung where von_dokument = $1',
        [zweit.dokumentId],
      )
      return { rows, original: erst.dokumentId }
    })
    expect(beziehung.rows).toEqual([
      { art: 'dublette_von', zu_dokument: beziehung.original },
    ])
  })

  it('erkennt dasselbe Papier an Kreditor, Rechnungsnummer und Betrag', async () => {
    const befund = await alsAnna((c) =>
      dubletteSuchen(c as never, {
        mandantId: MANDANT_NORD,
        inhaltHash: 'ein-anderer-hash',
        kreditorId: KREDITOR,
        rechnungsnummer: 'RE-2026-0001',
        brutto: 1240.0,
      }),
    )
    expect(befund.istDublette).toBe(true)
    expect(befund.stufe).toBe('rechnungsmerkmale')
    expect(befund.originalId).toBe(D1)
  })

  it('haelt gleichen Kreditor und gleichen Betrag ohne Rechnungsnummer nicht fuer eine Dublette', async () => {
    // Wiederkehrende Rechnungen sind der Normalfall -- zwei von drei
    // Merkmalen duerfen nicht genuegen.
    const befund = await alsAnna((c) =>
      dubletteSuchen(c as never, {
        mandantId: MANDANT_NORD,
        inhaltHash: 'noch-ein-hash',
        kreditorId: KREDITOR,
        rechnungsnummer: null,
        brutto: 1240.0,
      }),
    )
    expect(befund.istDublette).toBe(false)
  })

  it('sucht nicht ueber Mandantengrenzen hinweg', async () => {
    const befund = await alsAnna((c) =>
      dubletteSuchen(c as never, {
        mandantId: '10000000-0000-0000-0000-000000000002',
        inhaltHash: 'hash-d1',
      }),
    )
    expect(befund.istDublette).toBe(false)
  })
})
