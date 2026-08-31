/**
 * Tests des Lernspeichers.
 *
 * Konzept 15 macht drei Zusagen, und alle drei werden hier geprüft:
 *
 *   * Deterministische Merkmale ordnen eindeutig zu — auch wenn derselbe
 *     Lieferant für viele Objekte tätig ist.
 *   * Mehrere Kandidaten sind schlechter als keiner: rot, nicht orange.
 *   * Gelernt wird strikt mandantenbezogen. Kein Wissenstransfer.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  kandidatenAusText,
  merkmalLernen,
  nachlaufOhneZuordnung,
  normalisieren,
  objektVorschlagen,
  zuordnungKorrigieren,
} from '../src/lernen/zuordnung'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const MANDANT_SUED = '10000000-0000-0000-0000-000000000002'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const OBJEKT_43 = '50000000-0000-0000-0000-000000000043'
const OBJEKT_99 = '50000000-0000-0000-0000-000000000099'
const KREDITOR = '55000000-0000-0000-0000-000000000001'

const angelegt: string[] = []

/** Beleg ohne Objektzuordnung, mit dem angegebenen Seitentext. */
async function belegAnlegen(
  text: string,
  mandantId = MANDANT,
  kreditorId: string | null = KREDITOR,
): Promise<string> {
  const benutzer = mandantId === MANDANT ? ANNA : DORIS
  const id = await alsBenutzer(benutzer, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, belegart, eingangskanal, inhalt_hash,
                             storage_praefix, erfasst_von)
       values ($1, 'rechnung', 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), $2)
       returning id`,
      [mandantId, benutzer],
    )
    const dokumentId = rows[0].id
    await c.query(
      `insert into dokument_seite (dokument_id, seite, text) values ($1, 1, $2)`,
      [dokumentId, text],
    )
    if (kreditorId !== null) {
      await c.query(
        `insert into rechnung_fakten (dokument_id, kreditor_id) values ($1, $2)`,
        [dokumentId, kreditorId],
      )
    }
    return dokumentId
  })
  angelegt.push(id)
  return id
}

beforeEach(async () => {
  angelegt.length = 0
  const c = await verbindungspool().connect()
  try {
    await c.query('delete from zuordnungs_merkmal')
  } finally {
    c.release()
  }
})

afterEach(async () => {
  const c = await verbindungspool().connect()
  try {
    await c.query('alter table korrektur_ereignis disable trigger korrektur_ereignis_unveraenderlich')
    await c.query('delete from dokument where id = any($1)', [angelegt])
    await c.query('delete from zuordnungs_merkmal')
  } finally {
    await c.query('alter table korrektur_ereignis enable trigger korrektur_ereignis_unveraenderlich')
    c.release()
  }
})

afterAll(poolSchliessen)

describe('Normalisieren', () => {
  it('macht aus Schreibweisen denselben Wert', () => {
    expect(normalisieren('12 345-6')).toBe('123456')
    expect(normalisieren('de02 1203 0000 0000 2020 51')).toBe('DE0212030000000020 2051'.replace(/\s/g, ''))
    expect(normalisieren('ab-12/34.56')).toBe('AB123456')
  })
})

describe('Kandidaten aus dem Text', () => {
  it('findet Nummern ab vier Zeichen', () => {
    const gefunden = kandidatenAusText('Kundennummer 12345-6 zum Vertrag 4711')
    expect(gefunden).toContain('123456')
    expect(gefunden).toContain('4711')
  })

  it('findet eine IBAN', () => {
    const gefunden = kandidatenAusText('Bitte an DE02 1203 0000 0000 2020 51 zahlen')
    expect(gefunden.some((k) => k.startsWith('DE02'))).toBe(true)
  })

  it('uebergeht zu kurze Folgen', () => {
    // Eine Hausnummer oder ein Steuersatz wuerde sonst zufaellig treffen.
    const gefunden = kandidatenAusText('Weg 3, 19 % USt')
    expect(gefunden).not.toContain('3')
    expect(gefunden).not.toContain('19')
  })
})

describe('Zuordnung aus gelernten Merkmalen', () => {
  it('ordnet ueber die Kundennummer eindeutig zu', async () => {
    await alsBenutzer(ANNA, (c) =>
      merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'kundennummer',
        wert: '12345-6',
        objektId: OBJEKT_42,
      }),
    )
    const beleg = await belegAnlegen('Rechnung zu Kundennummer 12345-6, Reinigung')

    const vorschlag = await alsBenutzer(ANNA, (c) => objektVorschlagen(c, beleg))
    expect(vorschlag.sicherheit).toBe('gruen')
    expect(vorschlag.objektId).toBe(OBJEKT_42)
    expect(vorschlag.begruendung).toContain('kundennummer')
  })

  it('ordnet zu, auch wenn derselbe Lieferant viele Objekte betreut', async () => {
    // Genau der Fall aus Konzept 15: Der Lieferant allein sagt nichts, die
    // Kundennummer schon.
    await alsBenutzer(ANNA, async (c) => {
      await merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'kundennummer',
        wert: '111111',
        objektId: OBJEKT_42,
      })
      await merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'kundennummer',
        wert: '222222',
        objektId: OBJEKT_43,
      })
    })
    const beleg = await belegAnlegen('Kundennummer 222222')

    const vorschlag = await alsBenutzer(ANNA, (c) => objektVorschlagen(c, beleg))
    expect(vorschlag.objektId).toBe(OBJEKT_43)
  })

  it('wird bei mehreren Kandidaten rot, nicht orange', async () => {
    await alsBenutzer(ANNA, async (c) => {
      await merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'kundennummer',
        wert: '111111',
        objektId: OBJEKT_42,
      })
      await merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'zaehlernummer',
        wert: '222222',
        objektId: OBJEKT_43,
      })
    })
    const beleg = await belegAnlegen('Kundennummer 111111, Zaehler 222222')

    const vorschlag = await alsBenutzer(ANNA, (c) => objektVorschlagen(c, beleg))
    expect(vorschlag.sicherheit).toBe('rot')
    expect(vorschlag.mehrdeutig).toBe(true)
    expect(vorschlag.objektId).toBeNull()
  })

  it('schlaegt nichts vor, wenn kein Merkmal bekannt ist', async () => {
    const beleg = await belegAnlegen('Rechnung 998877 ohne bekanntes Merkmal')
    const vorschlag = await alsBenutzer(ANNA, (c) => objektVorschlagen(c, beleg))
    expect(vorschlag.objektId).toBeNull()
    expect(vorschlag.sicherheit).toBe('rot')
  })

  it('nimmt ein Merkmal ohne Kreditorbezug fuer jeden Lieferanten', async () => {
    // Eine Zaehlernummer gehoert zum Objekt, nicht zum Lieferanten.
    await alsBenutzer(ANNA, (c) =>
      merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: null,
        merkmalstyp: 'zaehlernummer',
        wert: '778899',
        objektId: OBJEKT_42,
      }),
    )
    const beleg = await belegAnlegen('Zaehlerstand zu 778899', MANDANT, null)

    const vorschlag = await alsBenutzer(ANNA, (c) => objektVorschlagen(c, beleg))
    expect(vorschlag.objektId).toBe(OBJEKT_42)
  })
})

describe('Mandantengrenze', () => {
  it('lernt nichts ueber die Mandantengrenze hinweg', async () => {
    await alsBenutzer(ANNA, (c) =>
      merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'kundennummer',
        wert: '555555',
        objektId: OBJEKT_42,
      }),
    )
    // Derselbe Wert im anderen Mandanten: Dort ist er unbekannt.
    const fremd = await belegAnlegen('Kundennummer 555555', MANDANT_SUED, null)

    const vorschlag = await alsBenutzer(DORIS, (c) => objektVorschlagen(c, fremd))
    expect(vorschlag.objektId).toBeNull()
  })
})

describe('Korrektur', () => {
  it('deaktiviert die alte Regel und schreibt eine neue', async () => {
    await alsBenutzer(ANNA, (c) =>
      merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'kundennummer',
        wert: '424242',
        objektId: OBJEKT_42,
      }),
    )
    const beleg = await belegAnlegen('Kundennummer 424242')

    await alsBenutzer(ANNA, (c) =>
      zuordnungKorrigieren(c, {
        dokumentId: beleg,
        benutzerId: ANNA,
        merkmalstyp: 'kundennummer',
        wert: '424242',
        richtigesObjekt: OBJEKT_43,
        falschesObjekt: OBJEKT_42,
      }),
    )

    const stand = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ objekt_id: string; aktiv: boolean }>(
        `select objekt_id, aktiv from zuordnungs_merkmal
          where wert_normalisiert = '424242' order by aktiv`,
        [],
      )
      return rows
    })

    expect(stand).toHaveLength(2)
    expect(stand.find((s) => s.objekt_id === OBJEKT_42)?.aktiv).toBe(false)
    expect(stand.find((s) => s.objekt_id === OBJEKT_43)?.aktiv).toBe(true)
  })

  it('haelt die Korrektur als Ereignis fest', async () => {
    const beleg = await belegAnlegen('Kundennummer 313131')
    await alsBenutzer(ANNA, (c) =>
      zuordnungKorrigieren(c, {
        dokumentId: beleg,
        benutzerId: ANNA,
        merkmalstyp: 'kundennummer',
        wert: '313131',
        richtigesObjekt: OBJEKT_42,
      }),
    )

    const ereignis = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ feld: string; wirkung: string; korrektur: string }>(
        'select feld, wirkung, korrektur from korrektur_ereignis where dokument_id = $1',
        [beleg],
      )
      return rows[0]
    })
    expect(ereignis.feld).toBe('objekt_id')
    expect(ereignis.wirkung).toBe('regel_neu')
    expect(ereignis.korrektur).toBe(OBJEKT_42)
  })

  it('ordnet den Beleg selbst gleich mit zu', async () => {
    const beleg = await belegAnlegen('Kundennummer 626262')
    await alsBenutzer(ANNA, (c) =>
      zuordnungKorrigieren(c, {
        dokumentId: beleg,
        benutzerId: ANNA,
        merkmalstyp: 'kundennummer',
        wert: '626262',
        richtigesObjekt: OBJEKT_42,
      }),
    )
    const objekt = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ objekt_id: string }>(
        'select objekt_id from dokument where id = $1',
        [beleg],
      )
      return rows[0].objekt_id
    })
    expect(objekt).toBe(OBJEKT_42)
  })
})

describe('Nachlauf', () => {
  it('ordnet offene Belege nach einer neuen Regel zu', async () => {
    // Zuerst liegt der Beleg ohne Zuordnung da.
    const beleg = await belegAnlegen('Vertragsnummer 909090')
    expect((await alsBenutzer(ANNA, (c) => objektVorschlagen(c, beleg))).objektId).toBeNull()

    // Dann lernt jemand das Merkmal.
    await alsBenutzer(ANNA, (c) =>
      merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'vertragsnummer',
        wert: '909090',
        objektId: OBJEKT_42,
      }),
    )

    const zugeordnet = await alsBenutzer(ANNA, (c) => nachlaufOhneZuordnung(c, MANDANT))
    expect(zugeordnet.map((z) => z.dokumentId)).toContain(beleg)
  })

  it('laesst mehrdeutige Belege liegen, statt zu raten', async () => {
    await alsBenutzer(ANNA, async (c) => {
      await merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'kundennummer',
        wert: '818181',
        objektId: OBJEKT_42,
      })
      await merkmalLernen(c, {
        mandantId: MANDANT,
        kreditorId: KREDITOR,
        merkmalstyp: 'zaehlernummer',
        wert: '828282',
        objektId: OBJEKT_43,
      })
    })
    const beleg = await belegAnlegen('Kunde 818181, Zaehler 828282')

    const zugeordnet = await alsBenutzer(ANNA, (c) => nachlaufOhneZuordnung(c, MANDANT))
    expect(zugeordnet.map((z) => z.dokumentId)).not.toContain(beleg)
    expect(OBJEKT_99).toBeTruthy()
  })
})
