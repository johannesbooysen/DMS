/**
 * Tests des Kontierungsvorschlags.
 *
 * Drei Zusagen:
 *
 *   * Die Ampel faellt, wo der Nachweis duenn ist -- eine Kontierung ist
 *     keine Gewohnheit, drei sind eine.
 *   * Vorgeschlagen wird nur, was sich uebernehmen laesst: kein Konto aus
 *     einem fremden Kontenrahmen.
 *   * Gelernt wird die Regel, nicht die Ausnahme -- ein Split wird kein
 *     Muster, und kein Wissen wandert ueber die Mandantengrenze.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { zeileHinzufuegen } from '../src/kontierung/kontierung'
import { GESAMT, kontierungVorschlagen, musterLernen } from '../src/kontierung/vorschlag'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const MANDANT_SUED = '10000000-0000-0000-0000-000000000002'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const OBJEKT_99 = '50000000-0000-0000-0000-000000000099'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const BETRIEBSKOSTEN = '40000000-0000-0000-0000-000000000001'
const KONTO_4200 = '37000000-0000-0000-0000-000000000001'

const angelegt: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

async function belegAnlegen(
  eingabe: { netto?: number; brutto?: number; mandant?: string } = {},
): Promise<string> {
  const mandant = eingabe.mandant ?? MANDANT
  const benutzer = mandant === MANDANT ? ANNA : DORIS
  const id = await alsBenutzer(benutzer, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, erfasst_von)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), $4)
       returning id`,
      [
        mandant,
        mandant === MANDANT ? OBJEKT_42 : OBJEKT_99,
        mandant === MANDANT ? BETRIEBSKOSTEN : null,
        benutzer,
      ],
    )
    const dokumentId = rows[0].id
    const netto = eingabe.netto ?? 1000
    const brutto = eingabe.brutto ?? 1190
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-VORSCHLAG', current_date, $3, $4, $5)`,
      [dokumentId, KREDITOR, netto, brutto - netto, brutto],
    )
    return dokumentId
  })
  angelegt.push(id)
  return id
}

async function musterSetzen(
  kontoId: string,
  trefferzahl: number,
  objektId: string | null = OBJEKT_42,
): Promise<void> {
  await alsEigentuemer((c) =>
    c.query(
      `insert into kontierungs_muster (mandant_id, kreditor_id, objekt_id,
                                       positionstext_normalisiert, konto_id, trefferzahl)
       values ($1, $2, $3, $4, $5, $6)`,
      [MANDANT, KREDITOR, objektId, GESAMT, kontoId, trefferzahl],
    ),
  )
}

const FREMDER_RAHMEN = 'Testrahmen (fremd, Kontierungsvorschlag)'

/**
 * Ein Konto in einem Kontenrahmen, den Objekt 42 **nicht** benutzt.
 *
 * Eigens angelegt statt aus dem Seed gesucht: Der erste Entwurf fand ein
 * passendes Konto -- das ein anderer Test hinterlassen hatte. Nach einem
 * `db:reset` war es weg, und der Test fiel um, ohne dass sich etwas am
 * Code geaendert hatte.
 */
async function fremdesKonto(): Promise<string> {
  return alsEigentuemer(async (c) => {
    const { rows: rahmen } = await c.query<{ id: string }>(
      `insert into kontenrahmen (mandant_id, name) values ($1, $2) returning id`,
      [MANDANT, FREMDER_RAHMEN],
    )
    const { rows } = await c.query<{ id: string }>(
      `insert into konto (kontenrahmen_id, kontonummer, bezeichnung)
       values ($1, '4200', 'Hausreinigung (fremder Rahmen)') returning id`,
      [rahmen[0].id],
    )
    return rows[0].id
  })
}

beforeEach(async () => {
  angelegt.length = 0
  await alsEigentuemer(async (c) => {
    await c.query('delete from kontierungs_muster')
    await c.query('update ordnungsgruppe set konto_vorschlag_id = null')
  })
})

afterEach(async () => {
  await alsEigentuemer(async (c) => {
    await c.query('delete from dokument where id = any($1)', [angelegt])
    await c.query('delete from kontierungs_muster')
    await c.query('update ordnungsgruppe set konto_vorschlag_id = null')
    await c.query(
      `delete from konto where kontenrahmen_id in (select id from kontenrahmen where name = $1)`,
      [FREMDER_RAHMEN],
    )
    await c.query('delete from kontenrahmen where name = $1', [FREMDER_RAHMEN])
  })
})

afterAll(poolSchliessen)

describe('Vorschlag', () => {
  it('bleibt aus, wenn nichts bekannt ist', async () => {
    const beleg = await belegAnlegen()
    const v = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, beleg))
    expect(v).toBeNull()
  })

  it('ist orange nach einer Kontierung und gruen ab drei', async () => {
    await musterSetzen(KONTO_4200, 1)
    const beleg = await belegAnlegen()
    const einmal = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, beleg))
    expect(einmal?.kontoId).toBe(KONTO_4200)
    expect(einmal?.sicherheit).toBe('orange')

    await alsEigentuemer((c) => c.query('update kontierungs_muster set trefferzahl = 3'))
    const dreimal = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, beleg))
    expect(dreimal?.sicherheit).toBe('gruen')
    expect(dreimal?.quelle).toBe('muster_objekt')
  })

  it('zieht das Muster fuer dieses Objekt dem allgemeinen vor', async () => {
    await musterSetzen(KONTO_4200, 9, null)
    const anderes = await fremdesKonto()
    // Das objektbezogene zeigt auf ein Konto, das es hier nicht gibt -- es
    // faellt weg, und das allgemeine bleibt als orange uebrig.
    await musterSetzen(anderes, 5, OBJEKT_42)
    const beleg = await belegAnlegen()
    const v = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, beleg))
    expect(v?.kontoId).toBe(KONTO_4200)
    expect(v?.quelle).toBe('muster_kreditor')
    expect(v?.sicherheit).toBe('orange')
  })

  it('schlaegt kein Konto aus einem fremden Kontenrahmen vor', async () => {
    await musterSetzen(await fremdesKonto(), 10)
    const beleg = await belegAnlegen()
    const v = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, beleg))
    expect(v).toBeNull()
  })

  it('faellt auf den Kontovorschlag der Kategorie zurueck -- orange', async () => {
    await alsEigentuemer((c) =>
      c.query('update ordnungsgruppe set konto_vorschlag_id = $2 where id = $1', [
        BETRIEBSKOSTEN,
        KONTO_4200,
      ]),
    )
    const beleg = await belegAnlegen()
    const v = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, beleg))
    expect(v?.kontoId).toBe(KONTO_4200)
    expect(v?.quelle).toBe('kategorie')
    expect(v?.sicherheit).toBe('orange')
    // Umlagefaehigkeit kommt vom Konto: 4200 ist im Seed umlagefaehig.
    expect(v?.umlagefaehig).toBe(true)
  })

  it('leitet den Steuersatz aus dem Beleg ab', async () => {
    await musterSetzen(KONTO_4200, 3)
    const neunzehn = await belegAnlegen({ netto: 1000, brutto: 1190 })
    const sieben = await belegAnlegen({ netto: 1000, brutto: 1070 })
    const a = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, neunzehn))
    const b = await alsBenutzer(ANNA, (c) => kontierungVorschlagen(c, sieben))
    expect(a?.steuersatz).toBe(19)
    expect(b?.steuersatz).toBe(7)
  })
})

describe('Lernen', () => {
  async function kontieren(beleg: string, kontoId: string, brutto: number): Promise<void> {
    await alsBenutzer(ANNA, (c) =>
      zeileHinzufuegen(c, beleg, { kontoId, betragBrutto: brutto, steuersatz: 19 }),
    )
  }

  async function muster(): Promise<Array<{ konto_id: string; trefferzahl: number }>> {
    return alsEigentuemer(async (c) => {
      const { rows } = await c.query<{ konto_id: string; trefferzahl: number }>(
        'select konto_id, trefferzahl from kontierungs_muster where aktiv',
      )
      return rows
    })
  }

  it('legt beim ersten Mal ein Muster an und zaehlt danach hoch', async () => {
    const eins = await belegAnlegen()
    await kontieren(eins, KONTO_4200, 1190)
    await alsBenutzer(ANNA, (c) => musterLernen(c, eins))
    expect(await muster()).toEqual([{ konto_id: KONTO_4200, trefferzahl: 1 }])

    const zwei = await belegAnlegen()
    await kontieren(zwei, KONTO_4200, 1190)
    await alsBenutzer(ANNA, (c) => musterLernen(c, zwei))
    expect(await muster()).toEqual([{ konto_id: KONTO_4200, trefferzahl: 2 }])
  })

  it('setzt bei einem anderen Konto neu an statt zu mischen', async () => {
    await musterSetzen(KONTO_4200, 7)
    const anderes = await alsEigentuemer(async (c) => {
      // Ein zweites Konto im Kontenrahmen von Objekt 42, damit die Kontierung
      // nicht am Kontenrahmen scheitert.
      const { rows } = await c.query<{ id: string }>(
        `insert into konto (kontenrahmen_id, kontonummer, bezeichnung)
         select kontenrahmen_id, '4999', 'Testkonto Abweichung' from konto where id = $1
         returning id`,
        [KONTO_4200],
      )
      return rows[0].id
    })
    try {
      const beleg = await belegAnlegen()
      await kontieren(beleg, anderes, 1190)
      await alsBenutzer(ANNA, (c) => musterLernen(c, beleg))
      expect(await muster()).toEqual([{ konto_id: anderes, trefferzahl: 1 }])
    } finally {
      await alsEigentuemer(async (c) => {
        await c.query('delete from kontierung where konto_id = $1', [anderes])
        await c.query('delete from kontierungs_muster where konto_id = $1', [anderes])
        await c.query('delete from konto where id = $1', [anderes])
      })
    }
  })

  it('lernt aus einem Split nichts', async () => {
    const anderes = await alsEigentuemer(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into konto (kontenrahmen_id, kontonummer, bezeichnung)
         select kontenrahmen_id, '4998', 'Testkonto Split' from konto where id = $1
         returning id`,
        [KONTO_4200],
      )
      return rows[0].id
    })
    try {
      const beleg = await belegAnlegen()
      await kontieren(beleg, KONTO_4200, 700)
      await kontieren(beleg, anderes, 490)
      await alsBenutzer(ANNA, (c) => musterLernen(c, beleg))
      expect(await muster()).toEqual([])
    } finally {
      await alsEigentuemer(async (c) => {
        await c.query('delete from kontierung where konto_id = $1', [anderes])
        await c.query('delete from konto where id = $1', [anderes])
      })
    }
  })
})

describe('Mandantentrennung', () => {
  it('traegt kein Muster ueber die Mandantengrenze', async () => {
    await musterSetzen(KONTO_4200, 10, null)
    const fremd = await belegAnlegen({ mandant: MANDANT_SUED })
    const v = await alsBenutzer(DORIS, (c) => kontierungVorschlagen(c, fremd))
    expect(v).toBeNull()
  })
})

describe('Uebernehmen tut, was der Vorschlag sagt', () => {
  it('haelt die Umlagefaehigkeit des Vorschlags, nicht die Kontovorgabe', async () => {
    // Konto 4200 ist im Seed umlagefaehig; der Vorschlag sagt: nicht.
    const beleg = await belegAnlegen()
    const { restVerteilen, kontierungLaden } = await import('../src/kontierung/kontierung')
    await alsBenutzer(ANNA, (c) => restVerteilen(c, beleg, KONTO_4200, 19, null, false))
    const stand = await alsBenutzer(ANNA, (c) => kontierungLaden(c, beleg))
    expect(stand.zeilen).toHaveLength(1)
    expect(stand.zeilen[0]?.umlagefaehig).toBe(false)
    expect(stand.stimmt).toBe(true)
  })
})
