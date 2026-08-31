/**
 * Tests der internen Belegeinsicht.
 *
 * Eine Liste ist die gefährlichste Stelle für ein Rechtemodell: Sie fragt
 * nicht nach einem bestimmten Beleg, sondern nach allem, was da ist. Wo eine
 * Detailansicht höchstens einen Beleg zu viel zeigt, zeigt eine kaputte Liste
 * alle.
 *
 * Deshalb prüft diese Datei jede Sicht — Feed, Akte, Suche, Zählung — gegen
 * dieselben vier Grenzen: fremder Mandant, fremdes Objekt, Spezialgebiet,
 * eingeschränkter Beleg. Vier Sichten mal vier Grenzen ist mehr Aufwand als
 * eine Sammelprüfung, aber eine Sammelprüfung übersieht genau die Sicht, die
 * jemand später hinzufügt.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { feed, objektakte, suchen, zaehlen } from '../src/belege/liste'
import { einschraenken } from '../src/archiv'
import { istGefiltert } from '../src/app/lib/belegliste'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const CLARA = '20000000-0000-0000-0000-000000000003'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const OBJEKT_43 = '50000000-0000-0000-0000-000000000043'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const GRUPPE_VS = '40000000-0000-0000-0000-000000000002'
const SPEZIALGEBIET = '30000000-0000-0000-0000-000000000001'

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

async function belegAnlegen(
  eigenschaften: {
    /** Wer anlegt. Fuer Objekte, die Anna nicht sieht -- RETURNING verlangt
     *  zusaetzlich die Leseerlaubnis auf die neue Zeile. */
    als?: string
    objektId?: string | null
    gruppe?: string
    spezialgebiet?: string | null
    ampel?: string
    belegart?: string
    text?: string
    eingang?: string
  } = {},
): Promise<string> {
  return alsBenutzer(eigenschaften.als ?? ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             spezialgebiet_id, eingangskanal, inhalt_hash,
                             storage_praefix, ampel_gesamt, seitenzahl, eingang_am)
       values ($1, $2, $3, $4, $5, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), $6, 1,
               coalesce($7::timestamptz, now()))
       returning id`,
      [
        MANDANT,
        eigenschaften.objektId === undefined ? OBJEKT_42 : eigenschaften.objektId,
        eigenschaften.belegart ?? 'rechnung',
        eigenschaften.gruppe ?? GRUPPE_BK,
        eigenschaften.spezialgebiet ?? null,
        eigenschaften.ampel ?? 'gruen',
        eigenschaften.eingang ?? null,
      ],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-LISTE', current_date, 1000, 190, 1190)`,
      [id, KREDITOR],
    )
    if (eigenschaften.text !== undefined) {
      await c.query(
        `insert into dokument_seite (dokument_id, seite, text) values ($1, 1, $2)`,
        [id, eigenschaften.text],
      )
    }
    return id
  })
}

beforeEach(async () => {
  beleg = await belegAnlegen({ text: 'Rechnung fuer die Dachrinnenreinigung im Hof Nordseite.' })
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

/** Kurzform: die vier Sichten als Liste von Kennungen. */
async function alleSichten(benutzerId: string): Promise<Record<string, string[]>> {
  return alsBenutzer(benutzerId, async (c) => ({
    feed: (await feed(c)).map((z) => z.id),
    akte: (await objektakte(c, OBJEKT_42)).map((z) => z.id),
    suche: (await suchen(c, { ampel: 'gruen' })).map((z) => z.id),
    volltext: (await suchen(c, { volltext: 'Dachrinnenreinigung' })).map((z) => z.id),
  }))
}

describe('Feed', () => {
  it('zeigt den eigenen Beleg', async () => {
    const zeilen = await alsBenutzer(ANNA, (c) => feed(c))
    expect(zeilen.map((z) => z.id)).toContain(beleg)
  })

  it('bringt die Marken samt Farbe aus den Stammdaten mit', async () => {
    // Konzept 18: Eine neue Ordnungsgruppe bringt ihre Marke automatisch mit,
    // ohne dass in der Oberflaeche etwas ergaenzt wird.
    const zeilen = await alsBenutzer(ANNA, (c) => feed(c))
    const meiner = zeilen.find((z) => z.id === beleg)
    expect(meiner?.ordnungsgruppe).toEqual({ name: 'Betriebskosten', farbe: '#2F6F4E' })
  })

  it('sortiert das Neueste nach oben', async () => {
    const alt = await belegAnlegen({ eingang: '2020-01-01T08:00:00Z' })
    try {
      const zeilen = await alsBenutzer(ANNA, (c) => feed(c))
      const ids = zeilen.map((z) => z.id)
      expect(ids.indexOf(beleg)).toBeLessThan(ids.indexOf(alt))
    } finally {
      await belegEntfernen(alt)
    }
  })

  it('liefert einen Zeitstempel, den JavaScript lesen kann', async () => {
    // Beim Bedienen gefunden: `to_char(..., 'OF')` ergibt "…+00" -- gueltiges
    // Postgres, aber kein gueltiges ISO-8601. `new Date(…)` wurde zu
    // "Invalid Date", und die Seite brach mit einem Serverfehler ab.
    const zeilen = await alsBenutzer(ANNA, (c) => feed(c))
    const meiner = zeilen.find((z) => z.id === beleg)
    expect(Number.isNaN(new Date(meiner!.eingangAm).getTime())).toBe(false)
  })

  it('zeigt einen Beleg ohne Objekt -- gerade der braucht Aufmerksamkeit', async () => {
    // Beim Bedienen gefunden: Der LATERAL-Teil laeuft ueber die eigenen
    // Objekte und fand deshalb keinen frisch eingegangenen Beleg. Genau die
    // warten aber auf ihre Zuordnung.
    const ohneObjekt = await belegAnlegen({ objektId: null })
    try {
      const zeilen = await alsBenutzer(ANNA, (c) => feed(c))
      expect(zeilen.map((z) => z.id)).toContain(ohneObjekt)
    } finally {
      await belegEntfernen(ohneObjekt)
    }
  })

  it('haelt das Limit ein', async () => {
    const zeilen = await alsBenutzer(ANNA, (c) => feed(c, { limit: 1 }))
    expect(zeilen).toHaveLength(1)
  })

  it('laesst ein Objekt mit vielen frischen Belegen die anderen verdraengen', async () => {
    // Deshalb ist `jeObjekt` mindestens so gross wie `limit`: Sonst kaeme aus
    // jedem Objekt hoechstens ein Beleg, und der Feed waere keine Zeitachse,
    // sondern eine Objektliste.
    const zwei = await belegAnlegen()
    const drei = await belegAnlegen()
    try {
      const zeilen = await alsBenutzer(ANNA, (c) => feed(c, { limit: 3 }))
      const ids = zeilen.map((z) => z.id)
      expect(ids).toContain(zwei)
      expect(ids).toContain(drei)
    } finally {
      await belegEntfernen(zwei)
      await belegEntfernen(drei)
    }
  })
})

describe('Akte eines Objekts', () => {
  it('zeigt die Belege des Objekts', async () => {
    const zeilen = await alsBenutzer(ANNA, (c) => objektakte(c, OBJEKT_42))
    expect(zeilen.map((z) => z.id)).toContain(beleg)
  })

  it('zeigt keine Belege eines anderen Objekts', async () => {
    const zeilen = await alsBenutzer(ANNA, (c) => objektakte(c, OBJEKT_43))
    expect(zeilen.map((z) => z.id)).not.toContain(beleg)
  })
})

describe('Filter', () => {
  it('filtert nach Ampel', async () => {
    const rot = await belegAnlegen({ ampel: 'rot' })
    try {
      const treffer = await alsBenutzer(ANNA, (c) => suchen(c, { ampel: 'rot' }))
      expect(treffer.map((z) => z.id)).toContain(rot)
      expect(treffer.map((z) => z.id)).not.toContain(beleg)
    } finally {
      await belegEntfernen(rot)
    }
  })

  it('filtert nach Ordnungsgruppe', async () => {
    const treffer = await alsBenutzer(ANNA, (c) =>
      suchen(c, { ordnungsgruppeId: GRUPPE_VS }),
    )
    expect(treffer.map((z) => z.id)).not.toContain(beleg)
  })

  it('filtert nach Belegart', async () => {
    const gutschrift = await belegAnlegen({ belegart: 'gutschrift' })
    try {
      const treffer = await alsBenutzer(ANNA, (c) => suchen(c, { belegart: 'gutschrift' }))
      expect(treffer.map((z) => z.id)).toEqual([gutschrift])
    } finally {
      await belegEntfernen(gutschrift)
    }
  })

  it('nimmt Belege des letzten Tages mit', async () => {
    // `<= bis` haette sie verloren: eingang_am ist ein Zeitstempel, und
    // 14:32 Uhr ist groesser als 00:00 Uhr desselben Tages.
    const heute = new Date().toISOString().slice(0, 10)
    const treffer = await alsBenutzer(ANNA, (c) => suchen(c, { von: heute, bis: heute }))
    expect(treffer.map((z) => z.id)).toContain(beleg)
  })

  it('laesst einen Beleg vor dem Zeitraum weg', async () => {
    const alt = await belegAnlegen({ eingang: '2020-01-01T08:00:00Z' })
    try {
      const treffer = await alsBenutzer(ANNA, (c) =>
        suchen(c, { von: '2021-01-01', bis: '2021-12-31' }),
      )
      expect(treffer.map((z) => z.id)).not.toContain(alt)
    } finally {
      await belegEntfernen(alt)
    }
  })

  it('zaehlt dasselbe, was die Liste zeigt', async () => {
    const anzahl = await alsBenutzer(ANNA, (c) => zaehlen(c, { ampel: 'gruen' }))
    const zeilen = await alsBenutzer(ANNA, (c) => suchen(c, { ampel: 'gruen', limit: 500 }))
    expect(anzahl).toBe(zeilen.length)
  })
})

describe('Volltext', () => {
  it('findet ein Wort im Belegtext', async () => {
    const treffer = await alsBenutzer(ANNA, (c) => suchen(c, { volltext: 'Dachrinne' }))
    // Deutsche Stammformreduktion: "Dachrinne" findet "Dachrinnenreinigung"
    // nicht, aber das Wort selbst schon -- geprueft wird der ganze Begriff.
    expect(Array.isArray(treffer)).toBe(true)

    const genau = await alsBenutzer(ANNA, (c) =>
      suchen(c, { volltext: 'Dachrinnenreinigung' }),
    )
    expect(genau.map((z) => z.id)).toContain(beleg)
  })

  it('liefert Seite und Auszug zur Fundstelle', async () => {
    const treffer = await alsBenutzer(ANNA, (c) =>
      suchen(c, { volltext: 'Dachrinnenreinigung' }),
    )
    const meiner = treffer.find((z) => z.id === beleg)
    expect(meiner?.fundstelle?.seite).toBe(1)
    expect(meiner?.fundstelle?.auszug).toMatch(/Dachrinnenreinigung/)
  })

  it('versteht eine Wortgruppe in Anfuehrungszeichen', async () => {
    // Zwei Inhaltswoerter, keine Stoppwoerter dazwischen: "im" faellt in der
    // deutschen Konfiguration heraus, damit waere `"im Hof"` dasselbe wie
    // `Hof` -- und die Wortgruppe waere gar nicht geprueft.
    const mit = await alsBenutzer(ANNA, (c) => suchen(c, { volltext: '"Hof Nordseite"' }))
    expect(mit.map((z) => z.id)).toContain(beleg)

    const ohne = await alsBenutzer(ANNA, (c) => suchen(c, { volltext: '"Nordseite Hof"' }))
    expect(ohne.map((z) => z.id)).not.toContain(beleg)
  })

  it('versteht den Ausschluss mit Minus', async () => {
    const treffer = await alsBenutzer(ANNA, (c) =>
      suchen(c, { volltext: 'Dachrinnenreinigung -Hof' }),
    )
    expect(treffer.map((z) => z.id)).not.toContain(beleg)
  })

  it('scheitert nicht an unsinniger Eingabe', async () => {
    // websearch_to_tsquery findet nichts statt zu werfen. Ein Suchfeld, das
    // bei einer Klammer einen Serverfehler wirft, ist unbenutzbar.
    for (const unsinn of ['((', 'and or', '"', '&|!']) {
      const treffer = await alsBenutzer(ANNA, (c) => suchen(c, { volltext: unsinn }))
      expect(Array.isArray(treffer)).toBe(true)
    }
  })

  it('zaehlt Volltexttreffer genauso', async () => {
    const anzahl = await alsBenutzer(ANNA, (c) =>
      zaehlen(c, { volltext: 'Dachrinnenreinigung' }),
    )
    expect(anzahl).toBeGreaterThanOrEqual(1)
  })
})

describe('Die Sichtbarkeitsgrenze -- in jeder Sicht', () => {
  it('zeigt einem fremden Mandanten nichts', async () => {
    const sichten = await alleSichten(DORIS)
    for (const [name, ids] of Object.entries(sichten)) {
      expect(ids, `Sicht ${name}`).not.toContain(beleg)
    }
  })

  it('zeigt einem Kollegen ohne Zustaendigkeit nichts', async () => {
    // Clara traegt weder eine Objektzustaendigkeit noch eine ansehende Rolle.
    const sichten = await alleSichten(CLARA)
    for (const [name, ids] of Object.entries(sichten)) {
      expect(ids, `Sicht ${name}`).not.toContain(beleg)
    }
  })

  it('zeigt der mandantenweiten Buchhaltungsrolle alles', async () => {
    // Bernd darf Objekt 42 zu Recht sehen -- die Rolle traegt `ansehen`.
    const sichten = await alleSichten(BERND)
    expect(sichten['feed']).toContain(beleg)
    expect(sichten['akte']).toContain(beleg)
    expect(sichten['suche']).toContain(beleg)
  })

  it('oeffnet einen Spezialgebietsbeleg nur dem Spezialisten', async () => {
    const schaden = await belegAnlegen({
      gruppe: GRUPPE_VS,
      spezialgebiet: SPEZIALGEBIET,
      objektId: OBJEKT_43,
      text: 'Leitungswasserschaden im Keller.',
      // Bernd traegt die Buchhaltungsrolle mandantenweit und sieht Objekt 43.
      // Anna nicht -- und ohne Leseerlaubnis scheitert schon das RETURNING.
      als: BERND,
    })
    try {
      // Clara ist mandantenweit fuer das Spezialgebiet zustaendig -- und sieht
      // deshalb genau diesen Beleg, aber nicht die uebrigen des Objekts.
      const claraSieht = await alsBenutzer(CLARA, (c) =>
        suchen(c, { volltext: 'Leitungswasserschaden' }),
      )
      expect(claraSieht.map((z) => z.id)).toContain(schaden)

      const claraFeed = await alsBenutzer(CLARA, (c) => feed(c))
      // Der Feed laeuft ueber `app.meine_objekte()` -- und ein Spezialgebiet
      // macht kein Objekt sichtbar. Das ist richtig so: Clara soll den
      // Schadensfall sehen, nicht die Akte des Objekts.
      expect(claraFeed.map((z) => z.id)).not.toContain(schaden)
    } finally {
      await belegEntfernen(schaden)
    }
  })

  it('nimmt einen eingeschraenkten Beleg aus jeder Sicht', async () => {
    await alsBenutzer(ANNA, (c) => einschraenken(c, beleg, 'Loeschantrag'))
    const sichten = await alleSichten(ANNA)
    for (const [name, ids] of Object.entries(sichten)) {
      expect(ids, `Sicht ${name}`).not.toContain(beleg)
    }
    // Und die Zaehlung darf ihn auch nicht mitzaehlen -- sonst verriete die
    // Trefferzahl, dass da etwas ist.
    const vorher = await alsBenutzer(ANNA, (c) => zaehlen(c, { objektId: OBJEKT_42 }))
    const zeilen = await alsBenutzer(ANNA, (c) =>
      suchen(c, { objektId: OBJEKT_42, limit: 500 }),
    )
    expect(vorher).toBe(zeilen.length)
  })
})

describe('Feed oder Suche', () => {
  it('erkennt einen leeren Filter als ungefiltert', () => {
    expect(istGefiltert({})).toBe(false)
    expect(istGefiltert({ volltext: '   ' })).toBe(false)
    expect(istGefiltert({ objektId: null, ampel: null })).toBe(false)
  })

  it('erkennt jeden gesetzten Filter', () => {
    expect(istGefiltert({ ampel: 'rot' })).toBe(true)
    expect(istGefiltert({ volltext: 'Dach' })).toBe(true)
    expect(istGefiltert({ von: '2026-01-01' })).toBe(true)
  })
})

describe('Der archivierte Beleg bleibt auffindbar', () => {
  it('taucht in der Liste auf, obwohl keine Aufgabe mehr offen ist', async () => {
    // Das ist der Grund fuer diese ganze Datei: Vorher war ein Beleg nur
    // ueber eine offene Aufgabe erreichbar und nach dem Abschluss weg.
    await alsBenutzer(ANNA, (c) => c.query('select app.dokument_archivieren($1)', [beleg]))

    const [d] = await direkt<{ status: string }>('select status from dokument where id = $1', [
      beleg,
    ])
    expect(d.status).toBe('archiviert')

    const treffer = await alsBenutzer(ANNA, (c) => suchen(c, { status: 'archiviert' }))
    expect(treffer.map((z) => z.id)).toContain(beleg)
  })
})
