/**
 * Tests der Verfahrensdokumentation — des dritten Stücks der
 * Revisionssicherheit (Konzept §24.4).
 *
 * Hash-Kette und Objektsperre belegen, dass ein Beleg seit dem Archivieren
 * derselbe ist. Sie belegen nicht, **nach welchem Verfahren** er dorthin kam.
 * Genau das ist hier zu prüfen, und die Frage lautet immer gleich: Ist die
 * Auskunft ein Befund oder eine Behauptung?
 *
 * Drei Dinge machen den Unterschied:
 *
 *   * Die Fassung wird beim Archivieren **abgeleitet**, nicht mitgegeben.
 *   * Eine freigegebene Fassung ist unveränderlich.
 *   * Der Hash belegt, dass der vorgelegte Text der freigegebene ist.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { archivieren, archivstandLaden } from '../src/archiv'
import {
  fassungFreigeben,
  fassungPruefen,
  fassungen,
  luecken,
  textHash,
} from '../src/verfahrensdoku'
import type { Ablage } from '../src/ablage'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const KONTO = '37000000-0000-0000-0000-000000000001'

let beleg = ''

class Merkablage implements Ablage {
  readonly dateien = new Map<string, Buffer>()
  async schreiben(schluessel: string, inhalt: Buffer): Promise<void> {
    this.dateien.set(schluessel, inhalt)
  }
  async lesen(schluessel: string): Promise<Buffer> {
    const treffer = this.dateien.get(schluessel)
    if (treffer === undefined) throw new Error('nicht gefunden')
    return treffer
  }
}

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

async function belegAnlegen(): Promise<string> {
  return alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto,
                                    wirtschaftsjahr)
       values ($1, $2, 'RE-VFD', current_date, 1000, 190, 1190, 2026)`,
      [id, KREDITOR],
    )
    await c.query(
      `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                               steuersatz, betrag_brutto, umlagefaehig, quelle)
       values ($1, 1, $2, 1000, 19, 1190, true, 'mensch')`,
      [id, KONTO],
    )
    return id
  })
}

const TEXT = '# Verfahrensdokumentation\n\nSo wird hier gearbeitet.\n'

async function freigeben(
  ablage: Ablage,
  version: string,
  gueltigAb: string,
  text = TEXT,
): Promise<void> {
  await alsBenutzer(ANNA, (c) =>
    fassungFreigeben(c, ablage, { version, gueltigAb, titel: 'Verfahrensdokumentation', text }),
  )
}

beforeEach(async () => {
  beleg = await belegAnlegen()
})

afterEach(async () => {
  await belegEntfernen(beleg)
  // Die Tabelle ist append-only -- der Trigger laesst kein delete zu. Fuer
  // den Testaufraeumer wird er kurz ausgesetzt; im Betrieb gibt es diesen
  // Weg nicht.
  await direkt('alter table verfahrensdokumentation disable trigger verfahrensdoku_unveraenderlich')
  await direkt('delete from verfahrensdokumentation')
  await direkt('alter table verfahrensdokumentation enable trigger verfahrensdoku_unveraenderlich')
})

afterAll(poolSchliessen)

describe('Die geltende Fassung', () => {
  it('steht am archivierten Beleg', async () => {
    await freigeben(new Merkablage(), '2026-01-01', '2026-01-01')

    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

    const [z] = await direkt<{ verfahrensdoku_version: string | null }>(
      'select verfahrensdoku_version from archiv_eintrag where dokument_id = $1',
      [beleg],
    )
    expect(z?.verfahrensdoku_version).toBe('2026-01-01')
  })

  it('ist die zum Zeitpunkt geltende, nicht die neueste', async () => {
    const ablage = new Merkablage()
    await freigeben(ablage, '2026-01-01', '2026-01-01')
    // Eine Fassung, die erst naechstes Jahr in Kraft tritt, gilt heute nicht.
    await freigeben(ablage, '2027-06-01', '2027-06-01')

    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

    const [z] = await direkt<{ verfahrensdoku_version: string }>(
      'select verfahrensdoku_version from archiv_eintrag where dokument_id = $1',
      [beleg],
    )
    /*
     * Das ist der eigentliche Zweck der Tabelle. Bei einem Beleg aus 2026
     * muss beantwortbar sein, nach welchem Verfahren er *damals* verarbeitet
     * wurde -- nicht nach welchem heute.
     */
    expect(z.verfahrensdoku_version).toBe('2026-01-01')
  })

  it('bleibt leer, wenn es keine gibt -- und haelt das Archivieren nicht auf', async () => {
    const frist = await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

    // Archiviert wurde trotzdem. Den Betrieb wegen einer Luecke in der
    // Dokumentation anzuhalten hilft niemandem -- die Luecke bliebe ja.
    expect(frist).toBe('2036-12-31')

    const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
    expect(stand?.archiviertAm).not.toBeNull()

    const offen = await alsBenutzer(ANNA, luecken)
    // Sichtbar statt still: Sonst faellt es erst in der Pruefung auf, also
    // dann, wenn es sich nicht mehr beheben laesst.
    expect(offen.some((l) => l.dokumentId === beleg)).toBe(true)
  })

  it('laesst sich nicht vom Aufrufer bestimmen', async () => {
    /*
     * Die alte Signatur nahm die Fassung entgegen. Eine mitgegebene Fassung
     * ist eine Behauptung -- der Aufrufer koennte jede Nummer eintragen.
     * Die Funktion mit drei Parametern darf es nicht mehr geben.
     */
    await expect(
      direkt("select app.dokument_archivieren($1, null, 'erfunden')", [beleg]),
    ).rejects.toThrow(/does not exist|existiert nicht/)
  })
})

describe('Eine freigegebene Fassung', () => {
  it('laesst sich nicht aendern', async () => {
    await freigeben(new Merkablage(), '2026-01-01', '2026-01-01')

    // Wer eine Fassung nachtraeglich anpassen kann, beweist mit ihr nichts --
    // und ein Pruefer fragt genau danach.
    await expect(
      direkt("update verfahrensdokumentation set titel = 'anders'"),
    ).rejects.toThrow()
    await expect(direkt('delete from verfahrensdokumentation')).rejects.toThrow()
  })

  it('braucht einen Hash', async () => {
    // Ueber alsBenutzer und nicht ueber `direkt`: Ohne gesetzten Benutzer
    // greift zuerst die Mandantenpruefung, und der Test pruefte dann eine
    // andere Zusicherung als die, die er im Namen traegt.
    await expect(
      alsBenutzer(ANNA, (c) =>
        c.query("select app.verfahrensdoku_freigeben('x', current_date, 't', '', 'k')"),
      ),
    ).rejects.toThrow(/beweist nichts/)
  })

  it('gehoert zu einem Mandanten', async () => {
    // Ohne Benutzerkontext gibt es keinen Mandanten -- und eine
    // Verfahrensdokumentation ohne Haus beschreibt niemandes Verfahren.
    await expect(
      direkt("select app.verfahrensdoku_freigeben('x', current_date, 't', 'h', 'k')"),
    ).rejects.toThrow(/gehoert zu einem Mandanten/)
  })

  it('kann nicht vor ihrer Vorgaengerin in Kraft treten', async () => {
    const ablage = new Merkablage()
    await freigeben(ablage, '2026-06-01', '2026-06-01')

    /*
     * Sonst gaebe es zwei Fassungen, die an einem Tag gelten, und die Frage
     * "nach welchem Verfahren wurde dieser Beleg verarbeitet" haette zwei
     * Antworten. Genau die Frage soll die Tabelle beantworten.
     */
    await expect(freigeben(ablage, '2026-03-01', '2026-03-01')).rejects.toThrow(
      /nicht vor der zuletzt freigegebenen/,
    )
  })

  it('darf am selben Tag ersetzt werden', async () => {
    const ablage = new Merkablage()
    await freigeben(ablage, '2026-06-01', '2026-06-01')
    // Gleicher Tag ist erlaubt -- ein Fehler am Vormittag soll sich am
    // Nachmittag richtigstellen lassen, ohne die Historie zu verbiegen.
    await freigeben(ablage, '2026-06-01.2', '2026-06-01')

    const alle = await alsBenutzer(ANNA, fassungen)
    expect(alle).toHaveLength(2)
  })
})

describe('Der Nachweis am Text', () => {
  it('erkennt den unveraenderten Text', async () => {
    const ablage = new Merkablage()
    await freigeben(ablage, '2026-01-01', '2026-01-01')

    const befund = await alsBenutzer(ANNA, (c) => fassungPruefen(c, ablage, '2026-01-01'))
    expect(befund.befund).toBe('unveraendert')
  })

  it('erkennt einen veraenderten Text', async () => {
    const ablage = new Merkablage()
    await freigeben(ablage, '2026-01-01', '2026-01-01')

    // Jemand schreibt die abgelegte Fassung um. Der Hash in der Datenbank
    // ist unveraenderlich -- daran faellt es auf.
    await ablage.schreiben(
      'verfahrensdoku/2026-01-01.md',
      Buffer.from('# Etwas ganz anderes\n', 'utf8'),
    )

    const befund = await alsBenutzer(ANNA, (c) => fassungPruefen(c, ablage, '2026-01-01'))
    expect(befund.befund).toBe('veraendert')
  })

  it('unterscheidet fehlend von veraendert', async () => {
    const ablage = new Merkablage()
    await freigeben(ablage, '2026-01-01', '2026-01-01')
    ablage.dateien.delete('verfahrensdoku/2026-01-01.md')

    /*
     * Zwei verschiedene Befunde, zwei verschiedene Handlungen: Eine fehlende
     * Datei wird gesucht, eine veraenderte untersucht. In einen Wert gepresst
     * schickt es jemanden auf die falsche Suche.
     */
    expect((await alsBenutzer(ANNA, (c) => fassungPruefen(c, ablage, '2026-01-01'))).befund).toBe(
      'fehlt',
    )
    expect((await alsBenutzer(ANNA, (c) => fassungPruefen(c, ablage, 'gibt-es-nicht'))).befund).toBe(
      'unbekannt',
    )
  })

  it('haengt nur am Inhalt, nicht am Zeitpunkt', () => {
    // Der Erzeuger arbeitet ohne Zeitstempel. Nur deshalb hat der Hash einer
    // Fassung ueberhaupt eine Bedeutung -- sonst waere jede Erzeugung eine
    // andere Fassung.
    expect(textHash(TEXT)).toBe(textHash(TEXT))
    expect(textHash(TEXT)).not.toBe(textHash(`${TEXT} `))
  })
})

describe('Mandantentrennung', () => {
  it('zeigt einem fremden Mandanten keine Fassung', async () => {
    await freigeben(new Merkablage(), '2026-01-01', '2026-01-01')

    const fremd = await alsBenutzer(DORIS, fassungen)
    // Doris gehoert zu einem anderen Mandanten. Die Verfahrensdokumentation
    // beschreibt, wie in *einem* Haus gearbeitet wird (Projektregel: keine
    // Datenabfrage ohne Mandantenfilter).
    expect(fremd).toHaveLength(0)
  })

  it('haelt am Beleg die Fassung des eigenen Mandanten fest', async () => {
    await freigeben(new Merkablage(), '2026-01-01', '2026-01-01')
    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

    const [z] = await direkt<{ verfahrensdoku_version: string | null }>(
      'select verfahrensdoku_version from archiv_eintrag where dokument_id = $1',
      [beleg],
    )
    expect(z?.verfahrensdoku_version).toBe('2026-01-01')

    // Und keine fremde: `app.verfahrensdoku_gueltig` bekommt den Mandanten
    // des Belegs, nicht den des Handelnden -- beim Archivieren ist das
    // dasselbe, in einer spaeteren Systemaufgabe waere es das nicht.
    const fremde = await direkt<{ v: string | null }>(
      'select app.verfahrensdoku_gueltig($1, current_date) as v',
      [randomUUID()],
    )
    expect(fremde[0]?.v).toBeNull()
  })
})
