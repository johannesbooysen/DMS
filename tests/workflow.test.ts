/**
 * Tests des Blockbaums und der Bedingungen.
 *
 * Der Blockbaum soll die typischen Konfigurationsfehler gar nicht erst
 * zulassen (ADR 0002). Geprüft wird deshalb beides: dass gültige Bäume
 * durchgehen und dass die Bauart die ungültigen abweist.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  bedingungAuswerten,
  bedingungPruefen,
  verwendeteFelder,
  type Bedingung,
} from '../src/workflow/bedingung'

const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/*
 * **Eva und nicht Anna.** Diese Datei prueft die Blockbaum-Regeln des
 * Schemas -- also muss der Constraint abweisen, nicht die Policy. Anna hat
 * seit 20260909100000 kein `prozess_konfigurieren`; unter ihr scheiterte
 * schon das Einfuegen, und die Tests haetten den Constraint nie erreicht.
 *
 * Vorher lief die Datei durch die Luecke, die diese Migration geschlossen
 * hat -- dieselbe Beobachtung wie bei den Stammdatentests damals: Ein Test,
 * der durch ein Loch laeuft, prueft weniger, als sein Name sagt.
 */
const EVA = '20000000-0000-0000-0000-000000000005'
const DEFINITION = '65000000-0000-0000-0000-000000000001'
const WURZEL = '67000000-0000-0000-0000-000000000001'
const STUFE_SACHLICH = '66000000-0000-0000-0000-000000000001'

let client: Client

beforeAll(async () => {
  client = new Client({ connectionString: VERBINDUNG })
  await client.connect()
})

afterAll(async () => {
  await client.end()
})

async function alsKonfigurator<T>(aktion: (c: Client) => Promise<T>): Promise<T> {
  await client.query('begin')
  try {
    await client.query('set local role dms_app')
    await client.query('select set_config($1, $2, true)', ['app.benutzer_id', EVA])
    return await aktion(client)
  } finally {
    await client.query('rollback')
  }
}

async function befunde(c: Client): Promise<string[]> {
  const { rows } = await c.query<{ schwere: string; befund: string }>(
    'select schwere, befund from app.prozessbaum_pruefen($1)',
    [DEFINITION],
  )
  return rows.map((r) => `${r.schwere}: ${r.befund}`)
}

describe('Blockbaum', () => {
  it('haelt den Ablauf aus dem Seed fuer gueltig', async () => {
    const gefunden = await alsKonfigurator(befunde)
    expect(gefunden).toEqual([])
  })

  it('laesst keinen zweiten Wurzelknoten zu', async () => {
    await expect(
      alsKonfigurator((c) =>
        c.query(
          `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp)
           values ($1, null, 1, 'nacheinander')`,
          [DEFINITION],
        ),
      ),
    ).rejects.toThrow(/prozessknoten_wurzel_idx|duplicate key/i)
  })

  it('laesst kein Blatt ohne Stufe zu', async () => {
    await expect(
      alsKonfigurator((c) =>
        c.query(
          `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp)
           values ($1, $2, 9, 'stufe')`,
          [DEFINITION, WURZEL],
        ),
      ),
    ).rejects.toThrow(/prozessknoten_blatt/i)
  })

  it('laesst keine Bedingung ausserhalb einer Verzweigung zu', async () => {
    await expect(
      alsKonfigurator((c) =>
        c.query(
          `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp, bedingung)
           values ($1, $2, 9, 'nacheinander', '{"feld":"brutto","op":">","wert":1}'::jsonb)`,
          [DEFINITION, WURZEL],
        ),
      ),
    ).rejects.toThrow(/prozessknoten_bedingung/i)
  })

  it('laesst zwei Geschwister nicht auf derselben Position stehen', async () => {
    await expect(
      alsKonfigurator((c) =>
        c.query(
          `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp, stufe_id)
           values ($1, $2, 0, 'stufe', $3)`,
          [DEFINITION, WURZEL, STUFE_SACHLICH],
        ),
      ),
    ).rejects.toThrow(/prozessknoten_position/i)
  })

  it('meldet eine Verzweigung ohne beide Zweige', async () => {
    const gefunden = await alsKonfigurator(async (c) => {
      await c.query(
        `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp, bedingung)
         values ($1, $2, 9, 'verzweigung', '{"feld":"brutto","op":">","wert":5000}'::jsonb)`,
        [DEFINITION, WURZEL],
      )
      return befunde(c)
    })
    expect(gefunden.some((b) => /Verzweigung .* hat 0 Zweige statt zwei/.test(b))).toBe(true)
  })

  it('meldet einen leeren Behaelter', async () => {
    const gefunden = await alsKonfigurator(async (c) => {
      await c.query(
        `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp)
         values ($1, $2, 9, 'gleichzeitig')`,
        [DEFINITION, WURZEL],
      )
      return befunde(c)
    })
    expect(gefunden.some((b) => /enthaelt nichts/.test(b))).toBe(true)
  })

  it('meldet eine Stufe, die im Ablauf nicht eingehaengt ist', async () => {
    const gefunden = await alsKonfigurator(async (c) => {
      await c.query(
        `insert into prozessstufe (definition_id, reihenfolge, stufentyp, bezeichnung,
                                   zustaendigkeit_typ)
         values ($1, 99, 'freigabe', 'Vergessene Stufe', 'rolle')`,
        [DEFINITION],
      )
      return befunde(c)
    })
    expect(gefunden).toContain('fehler: Stufe "Vergessene Stufe" ist im Ablauf nicht eingehaengt.')
  })
})

describe('Bedingungen: Pruefung', () => {
  it('nimmt einen gueltigen Ausdruck an', () => {
    const b: Bedingung = {
      und: [
        { feld: 'brutto', op: '>', wert: 5000 },
        { feld: 'ordnungsgruppe.kurzcode', op: '=', wert: 'VS' },
      ],
    }
    expect(bedingungPruefen(b)).toEqual([])
  })

  it('weist ein Feld ausserhalb der Weissliste ab', () => {
    const befund = bedingungPruefen({ feld: 'iban_im_beleg', op: '=', wert: 'DE00' })
    expect(befund).toHaveLength(1)
    expect(befund[0]).toContain('steht nicht zur Verfügung')
  })

  it('weist einen Vergleich ab, der zum Feldtyp nicht passt', () => {
    // "groesser als" ergibt fuer eine Ordnungsgruppe keinen Sinn.
    const befund = bedingungPruefen({ feld: 'ordnungsgruppe.kurzcode', op: '>', wert: 'VS' })
    expect(befund[0]).toContain('nicht möglich')
  })

  it('weist einen Wert vom falschen Typ ab', () => {
    const befund = bedingungPruefen({ feld: 'brutto', op: '>', wert: 'viel' })
    expect(befund[0]).toContain('Typ zahl')
  })

  it('verlangt fuer "in" eine nicht leere Liste', () => {
    expect(bedingungPruefen({ feld: 'belegart', op: 'in', wert: [] })[0]).toContain('nicht leere')
  })

  it('meldet den Ort des Fehlers im verschachtelten Ausdruck', () => {
    const befund = bedingungPruefen({
      und: [{ feld: 'brutto', op: '>', wert: 1 }, { feld: 'unbekannt', op: '=', wert: 'x' }],
    })
    expect(befund[0]).toContain('Bedingung.und[1]')
  })
})

describe('Bedingungen: Auswertung', () => {
  const beleg = {
    brutto: 6200,
    belegart: 'rechnung',
    'ordnungsgruppe.kurzcode': 'VS',
    'kreditor.name': 'Musterreinigung GmbH',
    hat_umlagefaehige_zeile: true,
  }

  it('wertet eine Betragsgrenze aus', () => {
    expect(bedingungAuswerten({ feld: 'brutto', op: '>', wert: 5000 }, beleg)).toBe(true)
    expect(bedingungAuswerten({ feld: 'brutto', op: '>', wert: 7000 }, beleg)).toBe(false)
  })

  it('verknuepft mit und, oder, nicht', () => {
    expect(
      bedingungAuswerten(
        { und: [{ feld: 'brutto', op: '>', wert: 5000 }, { feld: 'belegart', op: '=', wert: 'rechnung' }] },
        beleg,
      ),
    ).toBe(true)
    expect(
      bedingungAuswerten(
        { oder: [{ feld: 'brutto', op: '<', wert: 100 }, { feld: 'belegart', op: '=', wert: 'mahnung' }] },
        beleg,
      ),
    ).toBe(false)
    expect(bedingungAuswerten({ nicht: { feld: 'belegart', op: '=', wert: 'mahnung' } }, beleg)).toBe(true)
  })

  it('prueft Mitgliedschaft in einer Liste', () => {
    expect(
      bedingungAuswerten({ feld: 'belegart', op: 'in', wert: ['rechnung', 'gutschrift'] }, beleg),
    ).toBe(true)
  })

  it('vergleicht Text ohne Ruecksicht auf Gross- und Kleinschreibung', () => {
    expect(
      bedingungAuswerten({ feld: 'kreditor.name', op: 'enthaelt', wert: 'musterreinigung' }, beleg),
    ).toBe(true)
  })

  it('nimmt bei fehlendem Wert den Sonst-Zweig, statt den Lauf anzuhalten', () => {
    // Ein Beleg ohne Kreditor ist kein Beleg mit falschem Kreditor.
    expect(bedingungAuswerten({ feld: 'kreditor.name', op: '=', wert: 'X' }, {})).toBe(false)
    expect(bedingungAuswerten({ feld: 'kreditor.name', op: '!=', wert: 'X' }, {})).toBe(false)
  })

  it('nennt die verwendeten Felder', () => {
    const felder = verwendeteFelder({
      und: [
        { feld: 'brutto', op: '>', wert: 1 },
        { nicht: { feld: 'belegart', op: '=', wert: 'mahnung' } },
      ],
    })
    expect([...felder].sort()).toEqual(['belegart', 'brutto'])
  })
})
