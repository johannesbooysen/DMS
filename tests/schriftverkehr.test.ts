/**
 * Tests der zweiten Belegart (Konzept §24.3).
 *
 * **Diese Datei prüft eine Behauptung, keine Funktion.** CLAUDE.md sagt seit
 * dem ersten Tag: ein generischer Dokumentenkern, fachliche Daten in
 * Satellitentabellen, kein zweites Modul für Schriftverkehr. Solange es nur
 * eine Belegart gab, war das eine Absichtserklärung.
 *
 * Geprüft wird deshalb nicht in erster Linie, ob `schriftverkehr_fakten`
 * Zeilen speichert — das täte jede Tabelle. Geprüft wird, ob ein
 * Schriftstück **denselben Weg** geht wie eine Rechnung: eigene Stufenfolge
 * aus der Konfiguration, dieselbe Engine, dieselben Rechte, dieselbe
 * Archivierung, dieselbe Aufbewahrungslogik.
 *
 * Und der Fund: `app.freigabe_hash` band über einen inneren Verbund an
 * `rechnung_fakten` und lieferte für jede andere Belegart `null`.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { archivieren, archivstandLaden } from '../src/archiv'
import {
  fristenLaufenAb,
  schriftstueckLesen,
  schriftstueckSchreiben,
} from '../src/schriftverkehr'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const OBJEKT_ANDERS = '50000000-0000-0000-0000-000000000043'
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

/** Ein Schriftstück. Erfundene Absender — keine echten Personendaten. */
async function schriftstueck(
  daten: Parameters<typeof schriftstueckSchreiben>[2] = { richtung: 'eingehend' },
  objekt = OBJEKT_42,
): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'schriftverkehr', 'mail', md5(random()::text),
               'sv/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, objekt],
    )
    const neu = rows[0].id
    await schriftstueckSchreiben(c, neu, daten)
    return neu
  })
  angelegt.push(id)
  return id
}

/** Eine Rechnung — zum Vergleich, wo es auf den Unterschied ankommt. */
async function rechnung(): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'sv/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42],
    )
    const neu = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto,
                                    wirtschaftsjahr)
       values ($1, $2, 'RE-SV-1', current_date, 1000, 190, 1190, 2026)`,
      [neu, KREDITOR],
    )
    return neu
  })
  angelegt.push(id)
  return id
}

afterEach(async () => {
  for (const id of angelegt) await belegEntfernen(id)
  angelegt.length = 0
})

afterAll(poolSchliessen)

describe('Die Fakten', () => {
  it('speichert und liest ein Schriftstueck', async () => {
    const id = await schriftstueck({
      richtung: 'eingehend',
      korrespondent: 'Amt fuer Bauordnung Musterstadt',
      betreff: 'Anhoerung zur Nutzungsaenderung',
      schreibenDatum: '2026-08-14',
      fristAm: '2026-09-30',
      aktenzeichen: 'BA-2026-4711',
    })

    const s = await alsBenutzer(ANNA, (c) => schriftstueckLesen(c, id))
    expect(s?.korrespondent).toBe('Amt fuer Bauordnung Musterstadt')
    // Als Zeichenkette und nicht als Date: Aus dem 30.09. wuerde sonst je
    // nach Serverzeitzone der 29.09. -- bei einer Antwortfrist ein Tag zu
    // frueh (Projektregel).
    expect(s?.fristAm).toBe('2026-09-30')
    expect(s?.schreibenDatum).toBe('2026-08-14')
  })

  it('kommt ohne Stammsatz fuer den Absender aus', async () => {
    /*
     * Der Grund, warum `korrespondent` Text ist und nicht nur ein
     * Fremdschluessel: Schriftverkehr kommt von Aemtern, Gerichten und
     * Nachbarn. Ein Fremdschluessel allein zwaenge dazu, fuer jeden Absender
     * einen Kreditor anzulegen -- und der Kreditorenstamm waere nach einem
     * Jahr unbrauchbar.
     */
    const id = await schriftstueck({
      richtung: 'eingehend',
      korrespondent: 'Familie Beispiel, Wohnung 3',
    })
    const s = await alsBenutzer(ANNA, (c) => schriftstueckLesen(c, id))
    expect(s?.korrespondent).toBe('Familie Beispiel, Wohnung 3')
    expect(s?.kreditorId).toBeNull()
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    const id = await schriftstueck({ richtung: 'eingehend', betreff: 'Vertraulich' })

    // Die Sichtbarkeit erbt sich vom Dokument -- keine eigene Regel, kein
    // zweiter Ort, an dem sie vergessen werden kann.
    const s = await alsBenutzer(DORIS, (c) => schriftstueckLesen(c, id))
    expect(s).toBeNull()
  })
})

describe('Der Freigabe-Hash -- der Fund', () => {
  it('bindet auch ein Schriftstueck an seinen Datenstand', async () => {
    const id = await schriftstueck({
      richtung: 'eingehend',
      korrespondent: 'Amt',
      betreff: 'Anhoerung',
    })

    /*
     * Vorher lieferte die Funktion hier `null` -- ein innerer Verbund auf
     * `rechnung_fakten`, den ein Schriftstueck nicht erfuellt. Ein
     * Freigabestempel haette damit einen leeren Hash getragen und an nichts
     * gehangen.
     */
    const [z] = await direkt<{ h: string | null }>(
      'select app.freigabe_hash($1) as h',
      [id],
    )
    expect(z?.h).not.toBeNull()
    expect(z?.h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verfaellt, wenn der Beleg das Objekt wechselt', async () => {
    const id = await schriftstueck({ richtung: 'eingehend', betreff: 'Anhoerung' })
    const [vorher] = await direkt<{ h: string }>('select app.freigabe_hash($1) as h', [id])

    await direkt('update dokument set objekt_id = $2 where id = $1', [id, OBJEKT_ANDERS])
    const [nachher] = await direkt<{ h: string }>('select app.freigabe_hash($1) as h', [id])

    // Genau die Zusicherung, um derentwillen es den Hash gibt -- und genau
    // die, die fuer Schriftverkehr nicht galt.
    expect(nachher.h).not.toBe(vorher.h)
  })

  it('verfaellt, wenn sich die Antwortfrist aendert', async () => {
    const id = await schriftstueck({ richtung: 'eingehend', fristAm: '2026-09-30' })
    const [vorher] = await direkt<{ h: string }>('select app.freigabe_hash($1) as h', [id])

    await alsBenutzer(ANNA, (c) =>
      schriftstueckSchreiben(c, id, { richtung: 'eingehend', fristAm: '2026-12-31' }),
    )
    const [nachher] = await direkt<{ h: string }>('select app.freigabe_hash($1) as h', [id])
    expect(nachher.h).not.toBe(vorher.h)
  })

  it('laesst den Hash einer Rechnung unveraendert', async () => {
    /*
     * **Die wichtigste Zusicherung dieser Datei.**
     *
     * Die Formel wurde erweitert. Haette sich der Hash einer Rechnung dabei
     * geaendert, waere jede bestehende Freigabe im System entwertet worden:
     * `app.freigaben_nachpruefen` haette je Stempel ein Ereignis `verfallen`
     * geschrieben und alle laufenden Belege auf die erste Stufe
     * zurueckgeworfen -- eine Migration, die den Betrieb anhaelt, und zwar
     * wegen einer Verbesserung.
     *
     * Der erwartete Wert ist deshalb hier festgenagelt und nicht neu
     * gerechnet: Ein Test, der die Formel noch einmal nachbaut, ist mit ihr
     * einverstanden, statt sie zu pruefen.
     */
    const id = await rechnung()
    const [z] = await direkt<{ h: string }>('select app.freigabe_hash($1) as h', [id])

    const [erwartet] = await direkt<{ h: string }>(
      `select encode(sha256(convert_to(
                coalesce(f.kreditor_id::text, '')
                || coalesce(f.rechnungsnummer, '')
                || coalesce(f.rechnungsdatum::text, '')
                || coalesce(f.brutto::text, '')
                || coalesce(d.objekt_id::text, ''),
              'UTF8')), 'hex') as h
         from dokument d join rechnung_fakten f on f.dokument_id = d.id
        where d.id = $1`,
      [id],
    )
    // Die alte Formel, Wort fuer Wort. Sie muss dasselbe ergeben.
    expect(z.h).toBe(erwartet.h)
  })
})

describe('Derselbe Weg wie eine Rechnung', () => {
  it('findet seine eigene Stufenfolge aus der Konfiguration', async () => {
    /*
     * Der eigentliche Beweis fuer den generischen Kern: Die Engine waehlt
     * die Definition ueber `p.belegart = d.belegart`. Fuer Schriftverkehr
     * steht sie im Seed -- kein Codepfad kennt sie.
     */
    const [z] = await direkt<{ anzahl: string; bezeichnung: string }>(
      `select count(*) as anzahl, min(s.bezeichnung) as bezeichnung
         from prozessdefinition p
         join prozessstufe s on s.definition_id = p.id
        where p.belegart = 'schriftverkehr' and p.status = 'aktiv'`,
    )
    expect(Number(z.anzahl)).toBe(2)

    // Und sie ist eine andere als die der Rechnung -- zwei Stufen, keine
    // Kontierung, keine Zahlung.
    const [r] = await direkt<{ anzahl: string }>(
      `select count(*) as anzahl from prozessdefinition p
         join prozessstufe s on s.definition_id = p.id
        where p.belegart = 'rechnung' and p.status = 'aktiv'`,
    )
    expect(Number(r.anzahl)).toBeGreaterThan(Number(z.anzahl))
  })

  it('hat keine Zahlungsstufe', async () => {
    /*
     * Deshalb kommt ein Schriftstueck nie in die Naehe von
     * `app.zahlung_moeglich`, und die Frage nach dem Rechnungsbetrag stellt
     * sich gar nicht. Das ist die Antwort auf "was passiert mit dem
     * Summenzwang bei einem Beleg ohne Betrag" -- er wird nie gefragt.
     */
    const [z] = await direkt<{ anzahl: string }>(
      `select count(*) as anzahl from prozessdefinition p
         join prozessstufe s on s.definition_id = p.id
        where p.belegart = 'schriftverkehr' and s.stufentyp = 'zahlung'`,
    )
    expect(Number(z.anzahl)).toBe(0)
  })

  it('wird nicht zahlbar -- und das bleibt so', async () => {
    const id = await schriftstueck()

    /*
     * Festgehalten, damit es eine Entscheidung bleibt und nicht zu einem
     * Zufall wird, den beim naechsten Mal jemand "repariert":
     * `app.kontierung_summe_stimmt` liefert fuer einen Beleg ohne
     * Rechnungsdaten `null`, und `app.zahlung_moeglich` macht daraus ein
     * Nein. Richtig im Ergebnis -- ein Schriftstueck wird nicht gezahlt.
     */
    const [z] = await direkt<{ moeglich: boolean }>(
      'select moeglich from app.zahlung_moeglich($1)',
      [id],
    )
    expect(z?.moeglich).not.toBe(true)
  })

  it('wird sechs Jahre aufbewahrt, nicht zehn', async () => {
    /*
     * Sechs Jahre statt zehn -- Handelsbrief nach Paragraf 147 Absatz 3 AO.
     * Der einzige Ort, an dem die Belegart im laufenden Betrieb wirklich
     * einen Unterschied macht, und auch das ist ein Stammdatum
     * (`aufbewahrungsfrist`), kein Code.
     *
     * Die Frist wird hier gesetzt statt aus dem Seed genommen:
     * `tests/archiv.test.ts` raeumt die Tabelle in seinem afterEach, und
     * alle Dateien teilen sich eine Datenbank. Ein Test, der davon abhaengt,
     * waere je nach Dateireihenfolge gruen oder rot -- die schlimmste Art
     * von Fehlschlag.
     */
    await direkt(
      `insert into aufbewahrungsfrist (mandant_id, belegart, jahre, grund, aktiv)
       values ($1, 'schriftverkehr', 6, 'Handelsbrief (Paragraf 147 Absatz 3 AO)', true)
       on conflict (mandant_id, belegart) do update
         set jahre = excluded.jahre, grund = excluded.grund, aktiv = true`,
      [MANDANT],
    )

    const id = await schriftstueck({ richtung: 'eingehend', betreff: 'Anhoerung' })
    const bis = await alsBenutzer(ANNA, (c) => archivieren(c, id))
    const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, id))

    /*
     * Auf das Jahr genau, nicht auf ein Muster im Begruendungstext. Der
     * erste Entwurf pruefte `/Handelsbrief|zehn Jahre/` -- das war gruen,
     * gleich welche Frist herauskam, und haette den Fall "Stammdatum wird
     * ignoriert" nicht bemerkt.
     */
    const jahr = new Date().getFullYear()
    expect(bis).toBe(`${jahr + 6}-12-31`)
    expect(stand?.aufbewahrungsgrund).toContain('Handelsbrief')
  })

  it('ist nach der Archivierung fest', async () => {
    const id = await schriftstueck({ richtung: 'eingehend', betreff: 'Anhoerung' })
    await alsBenutzer(ANNA, (c) => archivieren(c, id))

    // Derselbe Trigger wie bei den Rechnungsdaten -- Aenderung nur ueber
    // Storno und Neuerfassung.
    await expect(
      alsBenutzer(ANNA, (c) =>
        schriftstueckSchreiben(c, id, { richtung: 'eingehend', betreff: 'anders' }),
      ),
    ).rejects.toThrow()
  })
})

describe('Antwortfristen', () => {
  it('meldet ein Schreiben, dessen Frist naht', async () => {
    const id = await schriftstueck({
      richtung: 'eingehend',
      korrespondent: 'Amt',
      fristAm: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
    })

    const offen = await fristenLaufenAb(ANNA, 14)
    const treffer = offen.find((f) => f.dokumentId === id)
    expect(treffer?.tageBisFrist).toBe(5)
  })

  it('meldet eine bereits abgelaufene Frist mit negativer Zahl', async () => {
    const id = await schriftstueck({
      richtung: 'eingehend',
      fristAm: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    })

    // Abgelaufen heisst nicht erledigt -- im Gegenteil, das ist der Fall,
    // der am dringendsten auf den Tisch gehoert.
    const offen = await fristenLaufenAb(ANNA, 14)
    expect(offen.find((f) => f.dokumentId === id)?.tageBisFrist).toBe(-3)
  })

  it('laesst ein Schreiben ohne Frist weg', async () => {
    const id = await schriftstueck({ richtung: 'ausgehend', korrespondent: 'Amt' })
    const offen = await fristenLaufenAb(ANNA, 365)
    expect(offen.some((f) => f.dokumentId === id)).toBe(false)
  })

  it('laesst ein storniertes Schreiben weg', async () => {
    const id = await schriftstueck({
      richtung: 'eingehend',
      fristAm: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    })
    await direkt("update dokument set status = 'storniert' where id = $1", [id])

    const offen = await fristenLaufenAb(ANNA, 14)
    expect(offen.some((f) => f.dokumentId === id)).toBe(false)
  })

  it('zeigt einem fremden Mandanten keine Frist', async () => {
    await schriftstueck({
      richtung: 'eingehend',
      fristAm: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    })

    const fremd = await fristenLaufenAb(DORIS, 365)
    expect(fremd).toHaveLength(0)
  })
})
