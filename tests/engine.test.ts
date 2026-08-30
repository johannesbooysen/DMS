/**
 * Tests der Workflow-Engine.
 *
 * Geprüft wird, was das Konzept an Verhalten zusichert: der Beleg wandert
 * ohne Zielangabe weiter, ein paralleler Block wartet auf beide Zweige, eine
 * Verzweigung wählt, eine Betragsgrenze lässt eine Stufe entfallen, und vor
 * der Zahlung fehlt kein Pflichtstempel.
 *
 * Jeder Test baut seinen Ablauf im Rollback selbst auf — so steht die
 * geprüfte Struktur im Test und nicht verstreut im Seed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  fehlendePflichtstempel,
  kontextLaden,
  laufStarten,
  stempeln,
} from '../src/workflow/engine.js'
import { baumLaden, simulieren } from '../src/workflow/baum.js'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const D1 = '70000000-0000-0000-0000-000000000001'
const DEFINITION_SEED = '65000000-0000-0000-0000-000000000001'

let client: Client

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
})

afterAll(async () => {
  await client.end()
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

/** Legt einen Beleg ohne Lauf an. */
async function belegAnlegen(c: Client, brutto: number | null): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                           inhalt_hash, storage_praefix)
     values ($1, $2, 'rechnung', 'mail', md5(random()::text), 'test/' || gen_random_uuid())
     returning id`,
    [MANDANT, OBJEKT_42],
  )
  const id = rows[0].id
  if (brutto !== null) {
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-TEST', current_date, $3, 0, $3)`,
      [id, KREDITOR, brutto],
    )
  }
  return id
}

/** Legt eine eigene Definition mit Stufen an und gibt deren Kennungen zurück. */
async function definitionAnlegen(
  c: Client,
  stufen: Array<{
    bezeichnung: string
    betragVon?: number | null
    pflicht?: boolean
    typ?: string
  }>,
): Promise<{ definitionId: string; stufenIds: string[] }> {
  const { rows: d } = await c.query<{ id: string }>(
    `insert into prozessdefinition (mandant_id, belegart, version, status, aktiv_ab)
     values ($1, 'rechnung', 99, 'entwurf', now()) returning id`,
    [MANDANT],
  )
  const definitionId = d[0].id

  const stufenIds: string[] = []
  for (const [i, s] of stufen.entries()) {
    const { rows } = await c.query<{ id: string }>(
      `insert into prozessstufe (definition_id, reihenfolge, stufentyp, bezeichnung,
                                 zustaendigkeit_typ, betrag_von, pflicht)
       values ($1, $2, $3, $4, 'objektverantwortlich', $5, $6)
       returning id`,
      [definitionId, i + 1, s.typ ?? 'sachlich', s.bezeichnung, s.betragVon ?? null,
       s.pflicht ?? true],
    )
    stufenIds.push(rows[0].id)
  }
  return { definitionId, stufenIds }
}

async function knotenAnlegen(
  c: Client,
  definitionId: string,
  elternId: string | null,
  reihenfolge: number,
  knotentyp: string,
  stufeId?: string,
  bedingung?: unknown,
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp,
                                stufe_id, bedingung)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [definitionId, elternId, reihenfolge, knotentyp, stufeId ?? null,
     bedingung === undefined ? null : JSON.stringify(bedingung)],
  )
  return rows[0].id
}

async function offeneAufgaben(c: Client, laufId: string): Promise<string[]> {
  const { rows } = await c.query<{ bezeichnung: string }>(
    `select s.bezeichnung from aufgabe a join prozessstufe s on s.id = a.stufe_id
      where a.lauf_id = $1 and a.status = 'offen' order by s.reihenfolge`,
    [laufId],
  )
  return rows.map((r) => r.bezeichnung)
}

describe('Kontext', () => {
  it('liest die Werte des Belegs fuer Bedingungen zusammen', async () => {
    const kontext = await alsAnna((c) => kontextLaden(c as never, D1))
    expect(kontext['brutto']).toBe(1240)
    expect(kontext['belegart']).toBe('rechnung')
    expect(kontext['ordnungsgruppe.kurzcode']).toBe('BK')
    expect(kontext['kreditor.name']).toBe('Musterreinigung GmbH')
  })
})

describe('Lauf', () => {
  it('startet mit der ersten Stufe und weist sie dem Objektverantwortlichen zu', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      const { rows } = await c.query<{ zugewiesen_benutzer: string; bezeichnung: string }>(
        `select a.zugewiesen_benutzer, s.bezeichnung
           from aufgabe a join prozessstufe s on s.id = a.stufe_id
          where a.lauf_id = $1`,
        [lauf?.laufId],
      )
      return rows
    })
    expect(ergebnis).toHaveLength(1)
    expect(ergebnis[0].bezeichnung).toBe('Sachliche Pruefung')
    expect(ergebnis[0].zugewiesen_benutzer).toBe(ANNA)
  })

  it('ruecktdurch die Kette, ohne dass der Stempel ein Ziel nennt', async () => {
    const verlauf = await alsAnna(async (c) => {
      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      const laufId = lauf!.laufId
      const schritte: string[][] = [await offeneAufgaben(c, laufId)]

      for (let i = 0; i < 3; i++) {
        const offen = await c.query<{ stufe_id: string }>(
          `select stufe_id from aufgabe where lauf_id = $1 and status = 'offen' limit 1`,
          [laufId],
        )
        if (offen.rows.length === 0) break
        await stempeln(c as never, {
          laufId,
          stufeId: offen.rows[0].stufe_id,
          benutzerId: ANNA,
          entscheidung: 'freigabe',
        })
        schritte.push(await offeneAufgaben(c, laufId))
      }

      const { rows: status } = await c.query<{ status: string }>(
        'select status from dokument_lauf where id = $1',
        [laufId],
      )
      return { schritte, status: status[0].status }
    })

    expect(verlauf.schritte[0]).toEqual(['Sachliche Pruefung'])
    expect(verlauf.schritte[1]).toEqual(['Rechnerische Pruefung'])
    expect(verlauf.schritte[2]).toEqual(['Freigabe Geschaeftsleitung'])
    expect(verlauf.schritte[3]).toEqual([])
    expect(verlauf.status).toBe('abgeschlossen')
  })

  it('schreibt zu jedem Schritt ein Stempelereignis', async () => {
    const anzahl = await alsAnna(async (c) => {
      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      const offen = await c.query<{ stufe_id: string }>(
        `select stufe_id from aufgabe where lauf_id = $1`,
        [lauf!.laufId],
      )
      await stempeln(c as never, {
        laufId: lauf!.laufId,
        stufeId: offen.rows[0].stufe_id,
        benutzerId: ANNA,
        entscheidung: 'freigabe',
      })
      const { rowCount } = await c.query('select 1 from stempel_ereignis where lauf_id = $1', [
        lauf!.laufId,
      ])
      return rowCount
    })
    expect(anzahl).toBe(1)
  })

  it('beendet den Lauf bei Ablehnung und setzt den Beleg auf abgelehnt', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      const offen = await c.query<{ stufe_id: string }>(
        `select stufe_id from aufgabe where lauf_id = $1`,
        [lauf!.laufId],
      )
      await stempeln(c as never, {
        laufId: lauf!.laufId,
        stufeId: offen.rows[0].stufe_id,
        benutzerId: ANNA,
        entscheidung: 'ablehnung',
        kommentar: 'Leistung nicht erbracht',
      })
      const { rows } = await c.query<{ lauf: string; beleg: string }>(
        `select l.status as lauf, d.status as beleg
           from dokument_lauf l join dokument d on d.id = l.dokument_id
          where l.id = $1`,
        [lauf!.laufId],
      )
      return rows[0]
    })
    expect(ergebnis.lauf).toBe('abgeschlossen')
    expect(ergebnis.beleg).toBe('abgelehnt')
  })

  it('haelt bei Klaerung an, ohne die Aufgabe zu schliessen', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      const offen = await c.query<{ stufe_id: string }>(
        `select stufe_id from aufgabe where lauf_id = $1`,
        [lauf!.laufId],
      )
      await stempeln(c as never, {
        laufId: lauf!.laufId,
        stufeId: offen.rows[0].stufe_id,
        benutzerId: ANNA,
        entscheidung: 'klaerung',
        kommentar: 'Rueckfrage beim Lieferanten',
      })
      const { rows } = await c.query<{ status: string; offene: string }>(
        `select l.status,
                (select count(*) from aufgabe a
                  where a.lauf_id = l.id and a.status = 'offen') as offene
           from dokument_lauf l where l.id = $1`,
        [lauf!.laufId],
      )
      return rows[0]
    })
    expect(ergebnis.status).toBe('klaerung')
    expect(Number(ergebnis.offene)).toBe(1)
  })
})

describe('Betragsgrenze', () => {
  it('laesst eine Stufe entfallen, statt sie stillschweigend zu ueberspringen', async () => {
    const aufgaben = await alsAnna(async (c) => {
      const { definitionId, stufenIds } = await definitionAnlegen(c, [
        { bezeichnung: 'Sachlich' },
        { bezeichnung: 'Freigabe GL', betragVon: 5000 },
      ])
      const wurzel = await knotenAnlegen(c, definitionId, null, 0, 'nacheinander')
      await knotenAnlegen(c, definitionId, wurzel, 0, 'stufe', stufenIds[0])
      await knotenAnlegen(c, definitionId, wurzel, 1, 'stufe', stufenIds[1])
      await c.query(`update prozessdefinition set status = 'aktiv' where id = $1`, [definitionId])
      await c.query(`update prozessdefinition set status = 'abgeloest' where id = $1`, [
        DEFINITION_SEED,
      ])

      const beleg = await belegAnlegen(c, 1200)
      const lauf = await laufStarten(c as never, beleg)
      await stempeln(c as never, {
        laufId: lauf!.laufId,
        stufeId: stufenIds[0],
        benutzerId: ANNA,
        entscheidung: 'freigabe',
      })

      const { rows } = await c.query<{ bezeichnung: string; status: string }>(
        `select s.bezeichnung, a.status from aufgabe a
           join prozessstufe s on s.id = a.stufe_id
          where a.lauf_id = $1 order by s.reihenfolge`,
        [lauf!.laufId],
      )
      return rows
    })

    expect(aufgaben).toEqual([
      { bezeichnung: 'Sachlich', status: 'erledigt' },
      // Sichtbar entfallen, nicht unsichtbar uebersprungen.
      { bezeichnung: 'Freigabe GL', status: 'entfallen' },
    ])
  })
})

describe('Paralleler Block', () => {
  it('oeffnet beide Stufen gleichzeitig und wartet auf die zweite', async () => {
    const ergebnis = await alsAnna(async (c) => {
      const { definitionId, stufenIds } = await definitionAnlegen(c, [
        { bezeichnung: 'Sachlich' },
        { bezeichnung: 'Rechnerisch' },
        { bezeichnung: 'Freigabe' },
      ])
      const wurzel = await knotenAnlegen(c, definitionId, null, 0, 'nacheinander')
      const parallel = await knotenAnlegen(c, definitionId, wurzel, 0, 'gleichzeitig')
      await knotenAnlegen(c, definitionId, parallel, 0, 'stufe', stufenIds[0])
      await knotenAnlegen(c, definitionId, parallel, 1, 'stufe', stufenIds[1])
      await knotenAnlegen(c, definitionId, wurzel, 1, 'stufe', stufenIds[2])
      await c.query(`update prozessdefinition set status = 'aktiv' where id = $1`, [definitionId])
      await c.query(`update prozessdefinition set status = 'abgeloest' where id = $1`, [
        DEFINITION_SEED,
      ])

      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      const zuBeginn = await offeneAufgaben(c, lauf!.laufId)

      await stempeln(c as never, {
        laufId: lauf!.laufId,
        stufeId: stufenIds[0],
        benutzerId: ANNA,
        entscheidung: 'freigabe',
      })
      const nachEinem = await offeneAufgaben(c, lauf!.laufId)

      await stempeln(c as never, {
        laufId: lauf!.laufId,
        stufeId: stufenIds[1],
        benutzerId: ANNA,
        entscheidung: 'freigabe',
      })
      const nachBeiden = await offeneAufgaben(c, lauf!.laufId)

      return { zuBeginn, nachEinem, nachBeiden }
    })

    expect(ergebnis.zuBeginn).toEqual(['Sachlich', 'Rechnerisch'])
    // Der Block ist noch nicht durch -- die Freigabe darf nicht aufgehen.
    expect(ergebnis.nachEinem).toEqual(['Rechnerisch'])
    expect(ergebnis.nachBeiden).toEqual(['Freigabe'])
  })
})

describe('Verzweigung', () => {
  async function laufMitVerzweigung(c: Client, brutto: number) {
    const { definitionId, stufenIds } = await definitionAnlegen(c, [
      { bezeichnung: 'Sachlich' },
      { bezeichnung: 'Freigabe GL' },
      { bezeichnung: 'Freigabe Objekt' },
    ])
    const wurzel = await knotenAnlegen(c, definitionId, null, 0, 'nacheinander')
    await knotenAnlegen(c, definitionId, wurzel, 0, 'stufe', stufenIds[0])
    const zweig = await knotenAnlegen(c, definitionId, wurzel, 1, 'verzweigung', undefined, {
      feld: 'brutto',
      op: '>',
      wert: 5000,
    })
    await knotenAnlegen(c, definitionId, zweig, 0, 'stufe', stufenIds[1])
    await knotenAnlegen(c, definitionId, zweig, 1, 'stufe', stufenIds[2])
    await c.query(`update prozessdefinition set status = 'aktiv' where id = $1`, [definitionId])
    await c.query(`update prozessdefinition set status = 'abgeloest' where id = $1`, [
      DEFINITION_SEED,
    ])

    const beleg = await belegAnlegen(c, brutto)
    const lauf = await laufStarten(c as never, beleg)
    await stempeln(c as never, {
      laufId: lauf!.laufId,
      stufeId: stufenIds[0],
      benutzerId: ANNA,
      entscheidung: 'freigabe',
    })
    return offeneAufgaben(c, lauf!.laufId)
  }

  it('nimmt den Dann-Zweig, wenn die Bedingung zutrifft', async () => {
    expect(await alsAnna((c) => laufMitVerzweigung(c, 6000))).toEqual(['Freigabe GL'])
  })

  it('nimmt den Sonst-Zweig, wenn sie nicht zutrifft', async () => {
    expect(await alsAnna((c) => laufMitVerzweigung(c, 900))).toEqual(['Freigabe Objekt'])
  })
})

describe('Sperre vor der Zahlung', () => {
  it('meldet die Pflichtstufen, die noch keinen Stempel haben', async () => {
    const fehlend = await alsAnna(async (c) => {
      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      return fehlendePflichtstempel(c as never, lauf!.laufId)
    })
    expect(fehlend).toEqual([
      'Sachliche Pruefung',
      'Rechnerische Pruefung',
      'Freigabe Geschaeftsleitung',
    ])
  })

  it('gibt frei, wenn jede Pflichtstufe erledigt ist', async () => {
    const fehlend = await alsAnna(async (c) => {
      const beleg = await belegAnlegen(c, 1000)
      const lauf = await laufStarten(c as never, beleg)
      for (let i = 0; i < 3; i++) {
        const offen = await c.query<{ stufe_id: string }>(
          `select stufe_id from aufgabe where lauf_id = $1 and status = 'offen' limit 1`,
          [lauf!.laufId],
        )
        if (offen.rows.length === 0) break
        await stempeln(c as never, {
          laufId: lauf!.laufId,
          stufeId: offen.rows[0].stufe_id,
          benutzerId: ANNA,
          entscheidung: 'freigabe',
        })
      }
      return fehlendePflichtstempel(c as never, lauf!.laufId)
    })
    expect(fehlend).toEqual([])
  })
})

describe('Simulation', () => {
  it('zeigt die Kette, die sich fuer einen gedachten Beleg ergibt', async () => {
    const schritte = await alsAnna(async (c) => {
      const wurzel = await baumLaden(c as never, DEFINITION_SEED)
      return simulieren(wurzel!, { brutto: 3000, belegart: 'rechnung' })
    })
    expect(schritte.map((s) => s.stufen.map((st) => st.bezeichnung))).toEqual([
      ['Sachliche Pruefung'],
      ['Rechnerische Pruefung'],
      ['Freigabe Geschaeftsleitung'],
    ])
  })

  it('laesst eine Stufe aus, deren Betragsgrenze nicht greift', async () => {
    const schritte = await alsAnna(async (c) => {
      await c.query(`update prozessstufe set betrag_von = 5000 where definition_id = $1
                      and bezeichnung = 'Freigabe Geschaeftsleitung'`, [DEFINITION_SEED])
      const wurzel = await baumLaden(c as never, DEFINITION_SEED)
      return simulieren(wurzel!, { brutto: 1200 })
    })
    expect(schritte.flatMap((s) => s.stufen.map((st) => st.bezeichnung))).toEqual([
      'Sachliche Pruefung',
      'Rechnerische Pruefung',
    ])
  })

  it('veraendert dabei nichts', async () => {
    const vorher = await alsAnna(async (c) => {
      const { rowCount } = await c.query('select 1 from aufgabe')
      return rowCount
    })
    await alsAnna(async (c) => {
      const wurzel = await baumLaden(c as never, DEFINITION_SEED)
      simulieren(wurzel!, { brutto: 9999 })
    })
    const nachher = await alsAnna(async (c) => {
      const { rowCount } = await c.query('select 1 from aufgabe')
      return rowCount
    })
    expect(nachher).toBe(vorher)
  })
})
