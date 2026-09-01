/**
 * Tests der externen Belegeinsicht.
 *
 * Dies ist der einzige Weg, auf dem Belege das Haus verlassen — an einen
 * Empfänger ohne Benutzerkonto, über einen Link, der per Mail geht und
 * weitergereicht werden kann. Entsprechend prüft diese Datei drei Dinge
 * besonders gründlich:
 *
 *   * **Der harte Ablauf.** Nach `gueltig_bis` liefert der Token nichts mehr,
 *     unabhängig davon, wer ihn hat. Benutzung verlängert nicht.
 *   * **Die gerechnete Mietersicht.** Der Mieter sieht umlagefähige Belege
 *     aus seiner Mietzeit — nicht mehr, und ohne dass jemand etwas freigibt.
 *   * **Der Umfang je Aufruf.** Wer eine Dokumentkennung kennt, darf sie
 *     nicht abrufen können, indem er die Liste überspringt.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  EinsichtAbgelehnt,
  einsichtAufloesen,
  einsichtBelege,
  einsichtDarfBeleg,
  einsichtDatei,
  einsichtGewaehren,
  einsichtProtokollieren,
  einsichtWiderrufen,
  gewaehrungenLaden,
  protokollLaden,
  tokenErzeugen,
  tokenHash,
} from '../src/einsicht'

const ANNA = '20000000-0000-0000-0000-000000000001'
const CLARA = '20000000-0000-0000-0000-000000000003'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

const MEIKE_BIS_MAERZ = '85000000-0000-0000-0000-000000000001'
const NICO_AB_APRIL = '85000000-0000-0000-0000-000000000002'

const D1_JAN_BIS_MAERZ = '70000000-0000-0000-0000-000000000001'
const D4_MAI = '70000000-0000-0000-0000-000000000004'
const D5_NICHT_UMLAGEFAEHIG = '70000000-0000-0000-0000-000000000005'

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/** Legt eine Gewährung an und liefert Token und Kennung. */
async function gewaehren(
  eigenschaften: Partial<Parameters<typeof einsichtGewaehren>[1]> = {},
) {
  return einsichtGewaehren(ANNA, {
    objektId: OBJEKT_42,
    personId: MEIKE_BIS_MAERZ,
    empfaengerTyp: 'mieter',
    umfang: 'belegliste',
    tage: 7,
    ...eigenschaften,
  })
}

afterEach(async () => {
  // Das Protokoll ist append-only -- auch die Kaskade von der Gewaehrung
  // bricht daran. Genau das soll es: Ein Nachweis, den man wegräumen kann,
  // ist keiner. Für den Test wird der Schutz kurz ausgesetzt.
  const c = await verbindungspool().connect()
  try {
    await c.query('alter table zugriff_protokoll disable trigger zugriff_protokoll_unveraenderlich')
    await c.query('delete from zugriff_protokoll')
    await c.query('delete from einsicht_gewaehrung')
    await c.query('delete from ausgang')
  } finally {
    await c.query('alter table zugriff_protokoll enable trigger zugriff_protokoll_unveraenderlich')
    c.release()
  }
})

afterAll(poolSchliessen)

describe('Token', () => {
  it('loest die Gewaehrung auf', async () => {
    const { token, gewaehrungId } = await gewaehren()
    const g = await einsichtAufloesen(token)
    expect(g?.gewaehrungId).toBe(gewaehrungId)
    expect(g?.objektnummer).toBe('42')
    expect(g?.personName).toBe('Meike Meier')
  })

  it('liegt in der Datenbank nur als Hash', async () => {
    const { token } = await gewaehren()
    const [zeile] = await direkt<{ token_hash: Buffer }>(
      'select token_hash from einsicht_gewaehrung',
    )
    expect(zeile.token_hash).toHaveLength(32)
    expect(zeile.token_hash.toString('utf8')).not.toContain(token)
    expect(zeile.token_hash.equals(tokenHash(token))).toBe(true)
  })

  it('kennt einen erfundenen Token nicht', async () => {
    await gewaehren()
    expect(await einsichtAufloesen(tokenErzeugen())).toBeNull()
  })

  it('kennt den leeren Token nicht', async () => {
    expect(await einsichtAufloesen('')).toBeNull()
  })

  it('liefert Datumsangaben, die ein Datum ergeben', async () => {
    // Beim Bedienen gefunden: `String(date).slice(0, 10)` ergibt "Mon Sep 07",
    // und `new Date("Mon Sep 07")` macht daraus das Jahr **2001**. Auf dem
    // Bildschirm der Mieterin stand "Gueltig bis 07.09.2001".
    const { token, gewaehrungId } = await gewaehren({ tage: 7 })

    const g = await einsichtAufloesen(token)
    expect(g?.gueltigBis).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(g!.gueltigBis).getFullYear()).toBe(new Date().getFullYear())

    const belege = await einsichtBelege(gewaehrungId)
    for (const b of belege) {
      if (b.leistungVon !== null) {
        expect(b.leistungVon).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(new Date(b.leistungVon).getFullYear()).toBeGreaterThan(2020)
      }
    }
  })
})

describe('Der Ablauf ist hart', () => {
  it('liefert nach gueltig_bis nichts mehr', async () => {
    const { token, gewaehrungId } = await gewaehren()
    expect(await einsichtAufloesen(token)).not.toBeNull()

    await direkt(
      `update einsicht_gewaehrung set gueltig_von = current_date - 30,
                                      gueltig_bis = current_date - 1
        where id = $1`,
      [gewaehrungId],
    )
    expect(await einsichtAufloesen(token)).toBeNull()
  })

  it('verlaengert sich nicht durch Benutzung', async () => {
    // Eine Sitzung wuerde sich beim Zugriff auffrischen. Genau das darf hier
    // nicht passieren -- der Token ist der Zugang, nicht der Beginn einer
    // Sitzung.
    const { token, gewaehrungId } = await gewaehren({ tage: 1 })
    await einsichtAufloesen(token)
    await einsichtAufloesen(token)

    const [zeile] = await direkt<{ tage: number }>(
      'select (gueltig_bis - current_date)::integer as tage from einsicht_gewaehrung where id = $1',
      [gewaehrungId],
    )
    expect(zeile.tage).toBe(1)
  })

  it('gilt vor gueltig_von noch nicht', async () => {
    const { token, gewaehrungId } = await gewaehren()
    await direkt(
      `update einsicht_gewaehrung set gueltig_von = current_date + 1,
                                      gueltig_bis = current_date + 30
        where id = $1`,
      [gewaehrungId],
    )
    expect(await einsichtAufloesen(token)).toBeNull()
  })

  it('endet mit dem Widerruf sofort', async () => {
    const { token, gewaehrungId } = await gewaehren()
    expect(await einsichtWiderrufen(ANNA, gewaehrungId)).toBe(true)
    expect(await einsichtAufloesen(token)).toBeNull()
  })

  it('laesst sich nicht zweimal widerrufen', async () => {
    const { gewaehrungId } = await gewaehren()
    await einsichtWiderrufen(ANNA, gewaehrungId)
    expect(await einsichtWiderrufen(ANNA, gewaehrungId)).toBe(false)
  })

  it('weist eine unsinnige Gueltigkeit ab', async () => {
    await expect(gewaehren({ tage: 0 })).rejects.toBeInstanceOf(EinsichtAbgelehnt)
    await expect(gewaehren({ tage: 400 })).rejects.toBeInstanceOf(EinsichtAbgelehnt)
  })
})

describe('Mietersicht -- gerechnet, nicht freigegeben', () => {
  it('zeigt den Beleg aus der Mietzeit', async () => {
    const { gewaehrungId } = await gewaehren()
    const belege = await einsichtBelege(gewaehrungId)
    expect(belege.map((b) => b.dokumentId)).toContain(D1_JAN_BIS_MAERZ)
  })

  it('zeigt den Beleg nach dem Auszug nicht', async () => {
    const { gewaehrungId } = await gewaehren()
    const belege = await einsichtBelege(gewaehrungId)
    expect(belege.map((b) => b.dokumentId)).not.toContain(D4_MAI)
  })

  it('zeigt dem Nachmieter nur seine Zeit', async () => {
    const { gewaehrungId } = await gewaehren({ personId: NICO_AB_APRIL })
    const belege = await einsichtBelege(gewaehrungId)
    expect(belege.map((b) => b.dokumentId)).toEqual([D4_MAI])
  })

  it('zeigt keinen Beleg ohne umlagefaehige Zeile', async () => {
    const { gewaehrungId } = await gewaehren()
    const belege = await einsichtBelege(gewaehrungId)
    expect(belege.map((b) => b.dokumentId)).not.toContain(D5_NICHT_UMLAGEFAEHIG)
  })

  it('aendert sich mit den Daten, nicht mit einer Freigabe', async () => {
    // Der Kern von Konzept 7: Wird die Zeile nicht mehr als umlagefaehig
    // gefuehrt, ist der Beleg fuer den Mieter weg -- ohne dass jemand die
    // Gewaehrung anfasst.
    const { gewaehrungId } = await gewaehren()
    expect((await einsichtBelege(gewaehrungId)).map((b) => b.dokumentId)).toContain(
      D1_JAN_BIS_MAERZ,
    )

    await direkt('update kontierung set umlagefaehig = false where dokument_id = $1', [
      D1_JAN_BIS_MAERZ,
    ])
    try {
      expect((await einsichtBelege(gewaehrungId)).map((b) => b.dokumentId)).not.toContain(
        D1_JAN_BIS_MAERZ,
      )
    } finally {
      await direkt('update kontierung set umlagefaehig = true where dokument_id = $1', [
        D1_JAN_BIS_MAERZ,
      ])
    }
  })

  it('verweigert einem Mieter einen Umfang, der nicht zu ihm passt', async () => {
    // Ein Vorgang oder ein Wirtschaftsjahr wuerde die Rechnung verwaessern --
    // die Schemabedingung laesst das gar nicht erst zu.
    await expect(gewaehren({ umfang: 'wirtschaftsjahr', wirtschaftsjahr: 2026 })).rejects.toThrow()
  })
})

describe('Eigentuemer und Beirat', () => {
  it('sieht das gewaehlte Wirtschaftsjahr', async () => {
    const { gewaehrungId } = await gewaehren({
      empfaengerTyp: 'eigentuemer',
      umfang: 'wirtschaftsjahr',
      wirtschaftsjahr: 2026,
    })
    const belege = await einsichtBelege(gewaehrungId)
    expect(belege.length).toBeGreaterThan(0)
    // Auch den nicht umlagefaehigen -- er ist Eigentuemer, nicht Mieter.
    expect(belege.map((b) => b.dokumentId)).toContain(D5_NICHT_UMLAGEFAEHIG)
  })

  it('sieht ein anderes Wirtschaftsjahr nicht', async () => {
    const { gewaehrungId } = await gewaehren({
      empfaengerTyp: 'eigentuemer',
      umfang: 'wirtschaftsjahr',
      wirtschaftsjahr: 2019,
    })
    expect(await einsichtBelege(gewaehrungId)).toEqual([])
  })

  it('braucht fuer den Umfang Vorgang einen Vorgang', async () => {
    await expect(
      gewaehren({ empfaengerTyp: 'beirat', umfang: 'vorgang' }),
    ).rejects.toThrow()
  })
})

describe('Was nie nach draussen geht', () => {
  it('ein eingeschraenkter Beleg', async () => {
    const { gewaehrungId } = await gewaehren()
    await alsBenutzer(ANNA, (c) =>
      c.query('select app.verarbeitung_einschraenken($1, $2)', [
        D1_JAN_BIS_MAERZ,
        'Loeschantrag',
      ]),
    )
    try {
      const belege = await einsichtBelege(gewaehrungId)
      // Was im Haus niemand mehr sehen darf, darf erst recht nicht hinaus.
      expect(belege.map((b) => b.dokumentId)).not.toContain(D1_JAN_BIS_MAERZ)
      expect(await einsichtDarfBeleg(gewaehrungId, D1_JAN_BIS_MAERZ)).toBe(false)
    } finally {
      await direkt('delete from einschraenkung where dokument_id = $1', [D1_JAN_BIS_MAERZ])
    }
  })

  it('ein stornierter Beleg', async () => {
    const { gewaehrungId } = await gewaehren()
    await direkt(`update dokument set status = 'storniert' where id = $1`, [D1_JAN_BIS_MAERZ])
    try {
      const belege = await einsichtBelege(gewaehrungId)
      expect(belege.map((b) => b.dokumentId)).not.toContain(D1_JAN_BIS_MAERZ)
    } finally {
      await direkt(`update dokument set status = 'laufend' where id = $1`, [D1_JAN_BIS_MAERZ])
    }
  })

  it('ein Beleg eines anderen Objekts', async () => {
    const { gewaehrungId } = await gewaehren({
      empfaengerTyp: 'eigentuemer',
      umfang: 'belegliste',
    })
    // d2 gehoert zu Objekt 43.
    expect(await einsichtDarfBeleg(gewaehrungId, '70000000-0000-0000-0000-000000000002'))
      .toBe(false)
  })
})

describe('Der Umfang wird je Aufruf geprueft', () => {
  it('laesst einen Beleg ausserhalb des Umfangs nicht durch', async () => {
    const { gewaehrungId } = await gewaehren()
    expect(await einsichtDarfBeleg(gewaehrungId, D1_JAN_BIS_MAERZ)).toBe(true)
    expect(await einsichtDarfBeleg(gewaehrungId, D4_MAI)).toBe(false)
  })

  it('antwortet nach dem Widerruf mit nein', async () => {
    const { gewaehrungId } = await gewaehren()
    await einsichtWiderrufen(ANNA, gewaehrungId)
    expect(await einsichtDarfBeleg(gewaehrungId, D1_JAN_BIS_MAERZ)).toBe(false)
  })

  it('antwortet nach Ablauf mit nein', async () => {
    const { gewaehrungId } = await gewaehren()
    await direkt(
      `update einsicht_gewaehrung set gueltig_von = current_date - 30,
                                      gueltig_bis = current_date - 1 where id = $1`,
      [gewaehrungId],
    )
    expect(await einsichtDarfBeleg(gewaehrungId, D1_JAN_BIS_MAERZ)).toBe(false)
  })
})

describe('Die Datei selbst', () => {
  it('liefert die Leseansicht, nicht die Miniatur', async () => {
    // Beide liegen als `ansicht_webp` mit seite = 1. Wer hier die Miniatur
    // erwischt, zeigt dem Empfaenger ein 240 Pixel breites Bild.
    const { gewaehrungId } = await gewaehren()
    const datei = await einsichtDatei(gewaehrungId, D1_JAN_BIS_MAERZ, 'ansicht_webp', 1)
    if (datei !== null) expect(datei.storageKey).not.toContain('miniatur')
  })

  it('liefert nichts fuer einen Beleg ausserhalb des Umfangs', async () => {
    // Beim Bedienen gefunden: Der erste Entwurf pruefte erst und holte danach
    // ueber eine gewoehnliche Abfrage -- die ohne angemeldeten Benutzer nichts
    // lieferte. Jetzt tut die Datenbankfunktion beides in einem Zug.
    const { gewaehrungId } = await gewaehren()
    expect(await einsichtDatei(gewaehrungId, D4_MAI, 'ansicht_webp', 1)).toBeNull()
  })

  it('liefert nach dem Widerruf nichts mehr', async () => {
    const { gewaehrungId } = await gewaehren()
    await einsichtWiderrufen(ANNA, gewaehrungId)
    expect(await einsichtDatei(gewaehrungId, D1_JAN_BIS_MAERZ, 'ansicht_webp', 1)).toBeNull()
    expect(await einsichtDatei(gewaehrungId, D1_JAN_BIS_MAERZ, 'original')).toBeNull()
  })
})

describe('Zugriffsprotokoll', () => {
  it('haelt jeden Abruf fest', async () => {
    const { gewaehrungId } = await gewaehren()
    await einsichtProtokollieren(gewaehrungId, null, 'liste')
    await einsichtProtokollieren(gewaehrungId, D1_JAN_BIS_MAERZ, 'ansicht', '203.0.113.7')

    const eintraege = await protokollLaden(ANNA, gewaehrungId)
    expect(eintraege.map((e) => e.aktion).sort()).toEqual(['ansicht', 'liste'])
  })

  it('haelt auch den abgelehnten Versuch fest', async () => {
    // Der interessantere Eintrag: Jemand hat eine Kennung ausprobiert.
    const { gewaehrungId } = await gewaehren()
    await einsichtProtokollieren(gewaehrungId, null, 'abgelehnt')
    const eintraege = await protokollLaden(ANNA, gewaehrungId)
    expect(eintraege.map((e) => e.aktion)).toContain('abgelehnt')
  })

  it('laesst sich nicht nachtraeglich aendern', async () => {
    const { gewaehrungId } = await gewaehren()
    await einsichtProtokollieren(gewaehrungId, null, 'liste')
    await expect(
      direkt(`update zugriff_protokoll set aktion = 'liste'`),
    ).rejects.toThrow(/append-only/)
    await expect(direkt('delete from zugriff_protokoll')).rejects.toThrow(/append-only/)
  })

  it('zaehlt die Zugriffe in der Uebersicht', async () => {
    const { gewaehrungId } = await gewaehren()
    await einsichtProtokollieren(gewaehrungId, null, 'liste')
    await einsichtProtokollieren(gewaehrungId, D1_JAN_BIS_MAERZ, 'ansicht')

    const zeilen = await gewaehrungenLaden(ANNA)
    const meine = zeilen.find((z) => z.id === gewaehrungId)
    expect(meine?.zugriffe).toBe(2)
    expect(meine?.letzterZugriff).not.toBeNull()
  })
})

describe('Die Grenze im Haus', () => {
  it('laesst niemanden Einsicht auf ein fremdes Objekt gewaehren', async () => {
    // Clara ist fuer Objekt 42 nicht zustaendig.
    await expect(
      einsichtGewaehren(CLARA, {
        objektId: OBJEKT_42,
        personId: MEIKE_BIS_MAERZ,
        empfaengerTyp: 'mieter',
        umfang: 'belegliste',
        tage: 7,
      }),
    ).rejects.toBeInstanceOf(EinsichtAbgelehnt)
  })

  it('zeigt einem fremden Mandanten die Gewaehrung nicht', async () => {
    await gewaehren()
    expect(await gewaehrungenLaden(DORIS)).toEqual([])
  })

  it('zeigt einem nicht zustaendigen Kollegen die Gewaehrung nicht', async () => {
    await gewaehren()
    expect(await gewaehrungenLaden(CLARA)).toEqual([])
  })

  it('laesst einen Fremden nicht widerrufen', async () => {
    const { gewaehrungId, token } = await gewaehren()
    expect(await einsichtWiderrufen(CLARA, gewaehrungId)).toBe(false)
    // Und die Gewaehrung gilt weiter.
    expect(await einsichtAufloesen(token)).not.toBeNull()
  })
})

describe('Rechte', () => {
  it('gibt standardmaessig nur Ansicht', async () => {
    const { token } = await gewaehren()
    const g = await einsichtAufloesen(token)
    expect(g?.rechte).toEqual(['ansicht'])
  })

  it('nimmt den Download nur, wenn er ausdruecklich dabeisteht', async () => {
    const { token } = await gewaehren({ rechte: ['ansicht', 'download'] })
    const g = await einsichtAufloesen(token)
    expect(g?.rechte).toContain('download')
  })

  it('setzt das Wasserzeichen als Vorgabe', async () => {
    const { token } = await gewaehren()
    expect((await einsichtAufloesen(token))?.wasserzeichen).toBe(true)
  })
})

describe('Link per Mail', () => {
  async function ausgang(): Promise<
    Array<{ empfaenger: string; text: string; fluechtig: boolean; anlass: string }>
  > {
    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query(
        'select empfaenger, text, fluechtig, anlass from ausgang',
      )
      return rows
    } finally {
      c.release()
    }
  }

  it('legt ohne Adresse nichts ins Ausgangsbuch', async () => {
    await gewaehren()
    expect(await ausgang()).toEqual([])
  })

  it('legt mit Adresse einen fluechtigen Eintrag an, der den Link traegt', async () => {
    const { token } = await gewaehren({
      mailAn: { adresse: 'meike@example.invalid', basisUrl: 'https://dms.example.invalid/' },
    })

    const [eintrag] = await ausgang()
    expect(eintrag.empfaenger).toBe('meike@example.invalid')
    expect(eintrag.anlass).toBe('einsicht')
    expect(eintrag.fluechtig).toBe(true)
    // Ein Schraegstrich, nicht zwei -- die Basis-URL kommt aus der Umgebung
    // und traegt dort gern einen am Ende.
    expect(eintrag.text).toContain(`https://dms.example.invalid/einsicht/${token}`)
    expect(eintrag.text).toContain('Meike Meier')
    expect(eintrag.text).toContain('42')
  })

  it('legt keinen Eintrag an, wenn die Gewaehrung scheitert', async () => {
    // Doris ist im anderen Mandanten -- sie sieht Objekt 42 nicht.
    await expect(
      einsichtGewaehren(DORIS, {
        objektId: OBJEKT_42,
        personId: MEIKE_BIS_MAERZ,
        empfaengerTyp: 'mieter',
        umfang: 'belegliste',
        tage: 7,
        mailAn: { adresse: 'doris@example.invalid', basisUrl: 'https://x.invalid' },
      }),
    ).rejects.toThrow(EinsichtAbgelehnt)

    // Kein Ausgang ohne Gewaehrung -- beides liegt in einer Transaktion.
    expect(await ausgang()).toEqual([])
  })
})
