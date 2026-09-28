/**
 * Der Abschluss des Posteingangs: Eingangsstempel und Paginiernummer
 * (Migration 20261002100000).
 *
 * Zusicherungen:
 *   - Der Beleg bekommt eine Nummer nach der Einstellung des Hauses und
 *     einen Stempel-Layer 'Posteingang · Nummer · Name · Datum'.
 *   - Nummern sind lueckenlos fortlaufend und aendern sich nie.
 *   - Ein zweiter Aufruf vergibt nichts zweimal.
 *   - Bestandsuebernahmen bekommen nichts.
 *   - Ohne aktiven Eingangs-Stempeltyp gibt es die Nummer, aber keinen Stempel.
 *   - Die Einstellung schreibt nur, wer Stammdaten pflegt; ein fremder
 *     Mandant sieht sie nicht.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { layerLaden } from '../src/layer'
import { paginierungLaden, paginierungSetzen, beispielnummer } from '../src/stammdaten/paginierung'
import { eingangAbschliessen } from '../src/worker/aufbereitung'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const ADMIN = '20000000-0000-0000-0000-000000000006'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'

const belege: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

async function belegAnlegen(kanal = 'upload'): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl, erfasst_von)
       values ($1, $2, 'rechnung', $3, $4, md5(random()::text), 'test/' || gen_random_uuid(), 'gruen', 1, $5)
       returning id`,
      [MANDANT, OBJEKT_42, GRUPPE_BK, kanal, ANNA],
    )
    const id = rows[0]!.id
    await c.query(
      `insert into dokument_seite (dokument_id, seite, text, breite, hoehe, freie_bloecke, textkaesten)
       values ($1, 1, 'Text', 595, 842, '[{"x":380,"y":40,"breite":190,"hoehe":64},{"x":380,"y":120,"breite":190,"hoehe":64}]'::jsonb, '[]'::jsonb)`,
      [id],
    )
    return id
  })
  belege.push(id)
  return id
}

async function abschliessen(id: string): Promise<string | null> {
  return alsBenutzer(ANNA, (c) => eingangAbschliessen(c, id))
}

beforeEach(async () => {
  // Einstellung auf Vorgabe, Zaehler auf Anfang -- als Eigentuemer, wie Seed und Migration.
  await alsEigentuemer(async (c) => {
    await c.query('delete from paginierung where mandant_id = $1', [MANDANT])
    await c.query('delete from paginierung_zaehler where mandant_id = $1', [MANDANT])
    await c.query(`update stempeltyp set aktiv = true where mandant_id = $1 and entscheidung = 'eingang'`, [MANDANT])
  })
})

afterEach(async () => {
  for (const id of belege.splice(0)) await belegEntfernen(id)
  await alsEigentuemer(async (c) => {
    await c.query('delete from paginierung where mandant_id = $1', [MANDANT])
    await c.query('delete from paginierung_zaehler where mandant_id = $1', [MANDANT])
    await c.query(`update stempeltyp set aktiv = true where mandant_id = $1 and entscheidung = 'eingang'`, [MANDANT])
  })
})

afterAll(poolSchliessen)

describe('Abschluss des Posteingangs', () => {
  it('vergibt die Nummer nach Vorgabe und setzt den Eingangsstempel mit Nummer, Name und Datum', async () => {
    const id = await belegAnlegen()
    const nummer = await abschliessen(id)
    const jahr = new Date().getFullYear()
    expect(nummer).toBe(`${jahr}-000001`)

    const stempel = (await layerLaden(ANNA, id)).filter((l) => l.typ === 'stempel')
    expect(stempel).toHaveLength(1)
    expect(stempel[0]!.text).toMatch(new RegExp(`^Posteingang · ${jahr}-000001 · Anna Ahrens · \\d{2}\\.\\d{2}\\.${jahr}$`))
    expect(stempel[0]!.seite).toBe(1)
    expect(stempel[0]!.farbe).toBe('#5A6270')
    expect(stempel[0]!.gestaltung?.felder).toEqual(['text', 'mitarbeiter', 'datum', 'paginiernummer'])
  })

  it('zaehlt lueckenlos weiter, und ein zweiter Aufruf vergibt nichts zweimal', async () => {
    const a = await belegAnlegen()
    const b = await belegAnlegen()
    const erste = await abschliessen(a)
    const zweite = await abschliessen(b)
    expect(Number(zweite!.slice(-6)) - Number(erste!.slice(-6))).toBe(1)

    expect(await abschliessen(a)).toBe(erste)
    expect((await layerLaden(ANNA, a)).filter((l) => l.typ === 'stempel')).toHaveLength(1)
    const p = await paginierungLaden(ANNA)
    expect(p.zaehler[0]?.naechste).toBe(3)
  })

  it('folgt der Einstellung des Hauses -- Praefix, ohne Jahr, drei Stellen', async () => {
    await paginierungSetzen(ADMIN, { aktiv: true, praefix: 'PE-', mitJahr: false, stellen: 3 })
    const id = await belegAnlegen()
    expect(await abschliessen(id)).toBe('PE-001')
    expect(beispielnummer({ aktiv: true, praefix: 'PE-', mitJahr: false, stellen: 3 }, 2026, 2)).toBe('PE-002')
  })

  it('vergibt nichts, wenn die Paginierung aus ist -- der Stempel kommt trotzdem, ohne Nummer', async () => {
    await paginierungSetzen(ADMIN, { aktiv: false, praefix: '', mitJahr: true, stellen: 6 })
    const id = await belegAnlegen()
    expect(await abschliessen(id)).toBeNull()
    const stempel = (await layerLaden(ANNA, id)).filter((l) => l.typ === 'stempel')
    expect(stempel[0]!.text).toMatch(/^Posteingang · Anna Ahrens · /)
  })

  it('laesst eine vergebene Nummer nie mehr aendern', async () => {
    const id = await belegAnlegen()
    await abschliessen(id)
    await expect(
      alsEigentuemer((c) => c.query(`update dokument set paginiernummer = 'X-1' where id = $1`, [id])),
    ).rejects.toThrow(/vergeben und aendert sich nicht/)
  })

  it('gibt einer Bestandsuebernahme weder Nummer noch Stempel', async () => {
    const id = await belegAnlegen('uebernahme')
    expect(await abschliessen(id)).toBeNull()
    expect((await layerLaden(ANNA, id)).filter((l) => l.typ === 'stempel')).toHaveLength(0)
  })

  it('stempelt nicht ohne aktiven Eingangs-Stempeltyp -- die Nummer gibt es trotzdem', async () => {
    await alsEigentuemer((c) => c.query(`update stempeltyp set aktiv = false where mandant_id = $1 and entscheidung = 'eingang'`, [MANDANT]))
    const id = await belegAnlegen()
    expect(await abschliessen(id)).not.toBeNull()
    expect((await layerLaden(ANNA, id)).filter((l) => l.typ === 'stempel')).toHaveLength(0)
  })

  it('ist kein Ereignis in der Stempelkette und laesst sich nicht verschieben', async () => {
    const id = await belegAnlegen()
    await abschliessen(id)
    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query<{ n: string; verschiebbar: string | null }>(
        `select (select count(*) from stempel_ereignis e join dokument_lauf l on l.id = e.lauf_id where l.dokument_id = $1) as n,
                (select app.stempel_verschiebbar(l.id) from dokument_layer l where l.dokument_id = $1 and l.typ = 'stempel' limit 1) as verschiebbar`,
        [id],
      ),
    )
    expect(Number(rows[0]!.n)).toBe(0)
    expect(rows[0]!.verschiebbar).toMatch(/Nur Stempel/)
  })
})

describe('Die Einstellung', () => {
  it('schreibt nur, wer Stammdaten pflegt', async () => {
    await expect(paginierungSetzen(ANNA, { aktiv: true, praefix: 'X', mitJahr: true, stellen: 4 })).rejects.toThrow(/Stammdaten/)
    await paginierungSetzen(ADMIN, { aktiv: true, praefix: 'X', mitJahr: true, stellen: 4 })
    expect((await paginierungLaden(ANNA)).praefix).toBe('X')
  })

  it('weist ein unbrauchbares Praefix und falsche Stellen ab', async () => {
    await expect(paginierungSetzen(ADMIN, { aktiv: true, praefix: 'a b', mitJahr: true, stellen: 4 })).rejects.toThrow(/Präfix/)
    await expect(paginierungSetzen(ADMIN, { aktiv: true, praefix: '', mitJahr: true, stellen: 11 })).rejects.toThrow(/Stellen/)
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    await paginierungSetzen(ADMIN, { aktiv: true, praefix: 'NORD-', mitJahr: true, stellen: 4 })
    const fremd = await paginierungLaden(DORIS)
    expect(fremd.praefix).toBe('')
    expect(fremd.zaehler).toEqual([])
  })
})
