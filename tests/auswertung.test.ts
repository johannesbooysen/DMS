/**
 * Tests der Auswertungen (Konzept §24.11).
 *
 * Eine Kennzahl wird geglaubt. Das macht sie gefährlicher als eine Liste:
 * Eine falsche Liste fällt beim Durchsehen auf, eine falsche Zahl nicht.
 * Geprüft wird deshalb dreierlei:
 *
 *   * **Rechnet sie richtig** — an Fällen mit bekanntem Ergebnis.
 *   * **Zählt sie das Richtige** — Klärung hält eine Stufe an, statt sie zu
 *     beenden; ein Storno ist kein Skontoverlust.
 *   * **Sieht ein fremder Mandant nichts** — aus einer Summe lässt sich
 *     zurückrechnen (Projektregel: keine Datenabfrage ohne Mandantenfilter).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { aeltesteOffene, durchlaufzeiten, skonto } from '../src/auswertung'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'

const angelegt: string[] = []

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/**
 * Ein Beleg mit Rechnungsdaten.
 *
 * `tageAlt` steuert den Eingang, die Skontoangaben steuern den Verlust.
 * Erfundene Namen und Nummern -- keine echten Personendaten in Fixtures
 * (Projektregel).
 */
async function belegAnlegen(angaben: {
  tageAlt?: number
  brutto?: number
  skontoProzent?: number | null
  skontoBisTage?: number | null
  status?: string
}): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt,
                             eingang_am, status)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'auswertung/' || gen_random_uuid(), 'gruen',
               now() - ($3 || ' days')::interval, $4)
       returning id`,
      [MANDANT, OBJEKT_42, angaben.tageAlt ?? 1, angaben.status ?? 'laufend'],
    )
    const neu = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto,
                                    wirtschaftsjahr, skonto_prozent, skonto_bis)
       values ($1, $2, 'RE-AUSW-' || substr(md5(random()::text), 1, 6),
               current_date - 30, $3, 0, $3, 2026, $4,
               case when $5::int is null then null
                    else current_date - $5::int end)`,
      [
        neu,
        KREDITOR,
        angaben.brutto ?? 1000,
        angaben.skontoProzent ?? null,
        angaben.skontoBisTage ?? null,
      ],
    )
    return neu
  })
  angelegt.push(id)
  return id
}

/**
 * Ein Lauf mit Stempeln. `stunden` ist der Abstand je Stempel zum Start,
 * `startVorTagen` verschiebt den Start -- nur damit laesst sich pruefen,
 * dass der Vorgabezeitraum wirklich abschneidet.
 */
async function laufMitStempeln(
  dokumentId: string,
  stempel: Array<{ stunden: number; entscheidung: string }>,
  startVorTagen = 30,
): Promise<void> {
  await alsBenutzer(ANNA, async (c) => {
    const { rows: stufen } = await c.query<{ id: string; definition_id: string }>(
      'select id, definition_id from prozessstufe order by reihenfolge limit 1',
    )
    const stufe = stufen[0]
    const { rows: laeufe } = await c.query<{ id: string }>(
      `insert into dokument_lauf (dokument_id, definition_id, definition_version,
                                  aktuelle_stufe_id, status, gestartet_am)
       values ($1, $2, 1, $3, 'laufend', now() - ($4 || ' days')::interval)
       returning id`,
      [dokumentId, stufe.definition_id, stufe.id, startVorTagen],
    )
    const lauf = laeufe[0].id

    for (const s of stempel) {
      await c.query(
        `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id,
                                       entscheidung, zeitpunkt, eintrag_hash)
         values ($1, $2, $3, $4,
                 (now() - ($6 || ' days')::interval) + ($5 || ' hours')::interval,
                 md5(random()::text))`,
        [lauf, stufe.id, ANNA, s.entscheidung, s.stunden, startVorTagen],
      )
    }
  })
}

beforeEach(() => {
  angelegt.length = 0
})

afterEach(async () => {
  for (const id of angelegt) await belegEntfernen(id)
})

afterAll(poolSchliessen)

describe('Durchlaufzeiten', () => {
  it('misst vom Eintritt in die Stufe bis zum beendenden Stempel', async () => {
    const beleg = await belegAnlegen({})
    // Erster Stempel nach 10 Stunden -- gerechnet ab Start des Laufs.
    await laufMitStempeln(beleg, [{ stunden: 10, entscheidung: 'freigabe' }])

    const zeiten = await durchlaufzeiten(ANNA, { von: null, bis: null })
    const zeile = zeiten.find((z) => z.anzahl > 0)
    expect(zeile).toBeDefined()
    expect(zeile?.medianStunden).toBeCloseTo(10, 0)
  })

  it('rechnet den zweiten Stempel ab dem ersten, nicht ab dem Start', async () => {
    const beleg = await belegAnlegen({})
    await laufMitStempeln(beleg, [
      { stunden: 10, entscheidung: 'freigabe' },
      { stunden: 14, entscheidung: 'freigabe' },
    ])

    /*
     * Zwei Stempel, 10 und 4 Stunden. Der Median ueber beide ist 7 -- waere
     * der Eintritt immer der Start des Laufs, waere er 12. Genau dieser
     * Unterschied ist der Grund fuer die Fensterfunktion.
     */
    const zeiten = await durchlaufzeiten(ANNA, { von: null, bis: null })
    const zeile = zeiten.find((z) => z.anzahl >= 2)
    expect(zeile?.medianStunden).toBeCloseTo(7, 0)
  })

  it('zaehlt Klaerung und Rueckgabe nicht als Abschluss', async () => {
    const beleg = await belegAnlegen({})
    await laufMitStempeln(beleg, [
      { stunden: 2, entscheidung: 'klaerung' },
      { stunden: 4, entscheidung: 'rueckgabe' },
      { stunden: 30, entscheidung: 'freigabe' },
    ])

    const zeiten = await durchlaufzeiten(ANNA, { von: null, bis: null })
    const zeile = zeiten.find((z) => z.anzahl > 0)

    /*
     * Ein Abschluss, nicht drei. Und die Dauer ist 26 Stunden -- der Abstand
     * zur Rueckgabe, nicht zum Start: Die Zeit davor ist beim Eintritt in die
     * Klaerung schon gezaehlt worden. Wer alle drei zaehlte, bekaeme eine
     * kurze Durchlaufzeit gerade fuer die Belege, die am meisten Muehe
     * gemacht haben.
     */
    expect(zeile?.anzahl).toBe(1)
    expect(zeile?.medianStunden).toBeCloseTo(26, 0)
  })

  it('zaehlt verfallene Stempel nicht mit', async () => {
    const beleg = await belegAnlegen({})
    await laufMitStempeln(beleg, [{ stunden: 1, entscheidung: 'verfallen' }])

    // `verfallen` schreibt die Engine, wenn ein Freigabe-Hash bricht. Kein
    // Mensch hat gehandelt -- als Durchlaufzeit von einer Stunde gezaehlt,
    // beschoenigte es den Schnitt.
    const zeiten = await durchlaufzeiten(ANNA, { von: null, bis: null })
    expect(zeiten.every((z) => z.anzahl === 0 || z.medianStunden !== 1)).toBe(true)
  })

  it('laesst ohne Angabe alles aelter als 90 Tage weg', async () => {
    const alt = await belegAnlegen({})
    await laufMitStempeln(alt, [{ stunden: 5, entscheidung: 'freigabe' }], 300)

    /*
     * Die Vorgabe ist kein Schoenheitsfehler, sondern die Messung: Der
     * unbegrenzte Lauf war dreimal so teuer und ging auf die Platte. Ein
     * Test, der nur prueft "es kommen Zeilen", haette das nicht gehalten --
     * er waere auch gruen, wenn die Vorgabe stillschweigend wegfiele.
     */
    expect((await durchlaufzeiten(ANNA)).every((z) => z.anzahl === 0)).toBe(true)

    /*
     * Auch `null` faellt auf die Vorgabe zurueck: Vom Modul aus gibt es die
     * unbegrenzte Abfrage nicht. Von einer Oberflaeche aus entstuende sie
     * sonst aus einem leeren Eingabefeld -- also genau dann, wenn niemand
     * sie gewollt hat.
     */
    const mitNull = await durchlaufzeiten(ANNA, { von: null, bis: null })
    expect(mitNull.every((z) => z.anzahl === 0)).toBe(true)

    // In SQL geht sie sehr wohl -- dort hat man sie dann entschieden.
    const roh = await direkt<{ anzahl: string }>(
      'select anzahl from app.durchlaufzeiten(null, null)',
    )
    expect(roh.some((z) => Number(z.anzahl) > 0)).toBe(true)
  })

  it('nimmt einen frischen Stempel in den Vorgabezeitraum', async () => {
    const frisch = await belegAnlegen({})
    await laufMitStempeln(frisch, [{ stunden: 5, entscheidung: 'freigabe' }], 10)

    expect((await durchlaufzeiten(ANNA)).some((z) => z.anzahl > 0)).toBe(true)
  })
})

describe('Verfallene Skonti', () => {
  it('rechnet den Verlust aus Brutto und Prozentsatz', async () => {
    await belegAnlegen({ brutto: 10_000, skontoProzent: 2, skontoBisTage: 10 })

    const { summe, faelle } = await skonto(ANNA)
    const treffer = faelle.find((f) => f.brutto === 10_000)
    expect(treffer?.verlust).toBe(200)
    expect(summe.find((s) => s.lage === 'verfallen')?.verlust).toBeGreaterThanOrEqual(200)
  })

  it('trennt zu spaet gezahlt von gar nicht gezahlt', async () => {
    const offen = await belegAnlegen({ brutto: 1000, skontoProzent: 3, skontoBisTage: 20 })
    const gezahlt = await belegAnlegen({ brutto: 2000, skontoProzent: 1, skontoBisTage: 20 })

    // Eine Zahlung, uebergeben *nach* Ablauf der Skontofrist.
    await direkt(
      `insert into zahlung (dokument_id, betrag, art, status, uebergeben_am)
       values ($1, 2000, 'voll', 'uebergeben', now() - interval '5 days')`,
      [gezahlt],
    )

    const { faelle } = await skonto(ANNA)
    expect(faelle.find((f) => f.dokumentId === offen)?.lage).toBe('verfallen')
    expect(faelle.find((f) => f.dokumentId === gezahlt)?.lage).toBe('zu_spaet')

    /*
     * Zusammengefasst waere die Zahl groesser und die Auskunft kleiner: Man
     * wuesste nicht mehr, ob das Haus zu langsam zahlt oder zu langsam
     * freigibt -- und das sind zwei verschiedene Abhilfen.
     */
  })

  it('zaehlt eine rechtzeitige Zahlung nicht als Verlust', async () => {
    const beleg = await belegAnlegen({ brutto: 5000, skontoProzent: 2, skontoBisTage: 10 })
    await direkt(
      `insert into zahlung (dokument_id, betrag, art, status, uebergeben_am)
       values ($1, 5000, 'voll', 'uebergeben', now() - interval '20 days')`,
      [beleg],
    )

    const { faelle } = await skonto(ANNA)
    expect(faelle.some((f) => f.dokumentId === beleg)).toBe(false)
  })

  it('zaehlt einen stornierten Beleg nicht', async () => {
    const beleg = await belegAnlegen({
      brutto: 9000,
      skontoProzent: 3,
      skontoBisTage: 30,
      status: 'storniert',
    })

    // Ein Skonto auf eine Rechnung, die es nicht mehr gibt, ist kein Verlust.
    const { faelle } = await skonto(ANNA)
    expect(faelle.some((f) => f.dokumentId === beleg)).toBe(false)
  })

  it('zaehlt einen Beleg ohne Skontovereinbarung nicht', async () => {
    const beleg = await belegAnlegen({ brutto: 4000 })
    const { faelle } = await skonto(ANNA)
    expect(faelle.some((f) => f.dokumentId === beleg)).toBe(false)
  })

  it('haelt Summe und Einzelfaelle zusammen', async () => {
    await belegAnlegen({ brutto: 1000, skontoProzent: 2, skontoBisTage: 5 })
    await belegAnlegen({ brutto: 2000, skontoProzent: 2, skontoBisTage: 5 })

    const { summe, faelle } = await skonto(ANNA, {}, 500)
    const ausFaellen = faelle.reduce((s, f) => s + f.verlust, 0)
    const ausSumme = summe.reduce((s, z) => s + z.verlust, 0)

    // Beide kommen aus derselben Definition -- eine zweite Abfrage mit
    // denselben Bedingungen waere eine zweite Gelegenheit, sie
    // auseinanderlaufen zu lassen.
    expect(ausFaellen).toBeCloseTo(ausSumme, 2)
  })
})

describe('Aelteste offene Belege', () => {
  it('rechnet ab Eingang im Haus', async () => {
    const beleg = await belegAnlegen({ tageAlt: 45 })
    await laufMitStempeln(beleg, [])

    const offene = await aeltesteOffene(ANNA, 200)
    const treffer = offene.find((o) => o.dokumentId === beleg)
    // Nicht ab Start des Laufs (30 Tage), sondern ab Eingang (45) -- danach
    // fragt der Lieferant, wenn er anruft.
    expect(treffer?.tage).toBe(45)
  })

  it('zaehlt einen Beleg in Klaerung als offen', async () => {
    const beleg = await belegAnlegen({ tageAlt: 60 })
    await laufMitStempeln(beleg, [])
    await direkt("update dokument_lauf set status = 'klaerung' where dokument_id = $1", [
      beleg,
    ])

    // Wer Klaerung ausblendet, verliert genau die Faelle, die am laengsten
    // liegen.
    const offene = await aeltesteOffene(ANNA, 200)
    expect(offene.find((o) => o.dokumentId === beleg)?.laufStatus).toBe('klaerung')
  })

  it('zaehlt einen abgeschlossenen Lauf nicht', async () => {
    const beleg = await belegAnlegen({ tageAlt: 90 })
    await laufMitStempeln(beleg, [])
    await direkt(
      "update dokument_lauf set status = 'abgeschlossen' where dokument_id = $1",
      [beleg],
    )

    const offene = await aeltesteOffene(ANNA, 200)
    expect(offene.some((o) => o.dokumentId === beleg)).toBe(false)
  })

  it('haelt sich an die Grenze', async () => {
    const offene = await aeltesteOffene(ANNA, 1)
    expect(offene.length).toBeLessThanOrEqual(1)
  })
})

describe('Mandantentrennung', () => {
  it('zeigt einem fremden Mandanten keinen Skontoverlust', async () => {
    await belegAnlegen({ brutto: 100_000, skontoProzent: 3, skontoBisTage: 10 })

    /*
     * Doris gehoert zu einem anderen Mandanten. Das ist die wichtigste
     * Zusicherung dieser Datei: Aus einer Kennzahl laesst sich
     * zurueckrechnen -- bei einem Objekt mit drei Rechnungen im Monat ist
     * "Summe der verlorenen Skonti" fast schon der Einzelbetrag.
     */
    const { summe, faelle } = await skonto(DORIS)
    expect(faelle).toHaveLength(0)
    expect(summe).toHaveLength(0)
  })

  it('zeigt einem fremden Mandanten keine Durchlaufzeit', async () => {
    const beleg = await belegAnlegen({})
    await laufMitStempeln(beleg, [{ stunden: 8, entscheidung: 'freigabe' }])

    const zeiten = await durchlaufzeiten(DORIS, { von: null, bis: null })
    expect(zeiten.every((z) => z.anzahl === 0)).toBe(true)
  })

  it('zeigt einem fremden Mandanten keinen offenen Beleg', async () => {
    const beleg = await belegAnlegen({ tageAlt: 120 })
    await laufMitStempeln(beleg, [])

    const offene = await aeltesteOffene(DORIS, 200)
    expect(offene.some((o) => o.dokumentId === beleg)).toBe(false)
  })
})
