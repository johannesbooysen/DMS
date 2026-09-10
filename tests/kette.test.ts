/**
 * Der Weg von der Datei bis zur ersten Aufgabe.
 *
 * Die einzelnen Bausteine haben eigene Tests. Dieser hier prüft, dass sie
 * zusammenhängen — genau das war lange nicht der Fall: Ingest, Queue und
 * Worker existierten, aber niemand reihte einen Auftrag ein.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { DateisystemAblage } from '../src/ablage'
import { dokumentAufnehmen, type Eingang } from '../src/ingest/aufnehmen'
import { queueBeenden, queueStarten, AUFBEREITUNG } from '../src/queue'
import { aufbereiten } from '../src/worker/aufbereitung'
import { pdfBauen, rechnungsvorlage } from './hilfe/pdf-bauen'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:15322/postgres'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

let client: Client
let wurzel: string
let ablage: DateisystemAblage
let rechnung: Buffer

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
  wurzel = await mkdtemp(join(tmpdir(), 'dms-kette-'))
  ablage = new DateisystemAblage(wurzel)
  rechnung = await pdfBauen(rechnungsvorlage())
  // Legt das Schema pgboss an, falls es noch fehlt.
  await queueStarten()
})

afterAll(async () => {
  await queueBeenden()
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

function eingang(inhalt: Buffer): Eingang {
  return {
    mandantId: MANDANT,
    objektId: OBJEKT_42,
    belegart: 'rechnung',
    eingangskanal: 'mail',
    dateiname: 'rechnung.pdf',
    mime: 'application/pdf',
    inhalt,
  }
}

/** Aufträge in der Warteschlange, die zu diesem Dokument gehören. */
async function auftraegeFuer(c: Client, dokumentId: string): Promise<number> {
  // pg-boss legt seine Tabellen im Schema pgboss an. Der Zugriff erfolgt hier
  // nur lesend und nur im Test -- die Anwendung geht immer über pg-boss.
  await c.query('reset role')
  const { rows } = await c.query<{ anzahl: string }>(
    `select count(*) as anzahl from pgboss.job
      where name = $1 and data->>'dokumentId' = $2`,
    [AUFBEREITUNG, dokumentId],
  )
  await c.query('set local role dms_app')
  return Number(rows[0].anzahl)
}

describe('Vom Eingang bis zur ersten Aufgabe', () => {
  it('reiht die Aufbereitung ein', async () => {
    const anzahl = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      return auftraegeFuer(c, auf.dokumentId)
    })
    expect(anzahl).toBe(1)
  })

  it('reiht fuer eine Dublette nichts ein', async () => {
    const anzahl = await alsAnna(async (c) => {
      await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      const zweit = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      return auftraegeFuer(c, zweit.dokumentId)
    })
    expect(anzahl).toBe(0)
  })

  it('schreibt Auftrag und Dokument gemeinsam fest', async () => {
    // Rollt die Transaktion zurueck: Danach darf weder das Dokument noch der
    // Auftrag existieren. Sonst arbeitete der Worker an einem Beleg, den es
    // nie gab.
    let dokumentId = ''
    await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)
      dokumentId = auf.dokumentId
      expect(await auftraegeFuer(c, dokumentId)).toBe(1)
    })

    const { rows: dokumente } = await client.query(
      'select 1 from dokument where id = $1',
      [dokumentId],
    )
    const { rows: auftraege } = await client.query(
      `select 1 from pgboss.job where data->>'dokumentId' = $1`,
      [dokumentId],
    )
    expect(dokumente).toHaveLength(0)
    expect(auftraege).toHaveLength(0)
  })

  it('fuehrt vom Eingang ueber die Aufbereitung zur offenen Aufgabe', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const auf = await dokumentAufnehmen(c as never, ablage, eingang(rechnung), ANNA)

      // Was sonst der Worker tut, wenn er den Auftrag abholt.
      const bericht = await aufbereiten(c as never, ablage, auf.dokumentId)

      const { rows: seiten } = await c.query<{ anzahl: string }>(
        'select count(*) as anzahl from dokument_seite where dokument_id = $1',
        [auf.dokumentId],
      )
      const { rows: derivate } = await c.query<{ anzahl: string }>(
        `select count(*) as anzahl from dokument_datei
          where dokument_id = $1 and variante = 'ansicht_webp'`,
        [auf.dokumentId],
      )
      const { rows: aufgaben } = await c.query<{ bezeichnung: string; status: string }>(
        `select s.bezeichnung, a.status
           from aufgabe a
           join dokument_lauf l on l.id = a.lauf_id
           join prozessstufe s on s.id = a.stufe_id
          where l.dokument_id = $1`,
        [auf.dokumentId],
      )
      return {
        laufGestartet: auf.laufGestartet,
        bericht,
        seiten: Number(seiten[0].anzahl),
        derivate: Number(derivate[0].anzahl),
        aufgaben,
      }
    })

    expect(ergebnis.laufGestartet).toBe(true)
    expect(ergebnis.bericht.seiten).toBe(2)
    expect(ergebnis.bericht.weg).toBe('textlayer')
    // Ohne eingebettetes XML und ohne eingeschaltetes Modell wird nicht
    // geraten -- der Beleg geht in die manuelle Erfassung.
    expect(ergebnis.bericht.erkennung?.quelle).toBe('keine')
    expect(ergebnis.seiten).toBe(2)
    // Zwei Leseansichten und eine Miniatur.
    expect(ergebnis.derivate).toBe(3)
    expect(ergebnis.aufgaben).toEqual([
      { bezeichnung: 'Sachliche Pruefung', status: 'offen' },
    ])
  })
})
