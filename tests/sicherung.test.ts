/**
 * Tests der Sicherungsprüfungen (Konzept §24.7).
 *
 * „Ein Archiv ohne getesteten Restore ist kein Archiv." Geprüft wird hier
 * nicht `pg_dump` — das ist ein gelöstes Problem —, sondern die Frage
 * danach: **Merkt die Prüfung es, wenn etwas kaputt ist?**
 *
 * Das ist die eigentliche Gefahr bei einer Restore-Probe. Eine, die immer
 * grün ist, erzieht dazu, ihr zu glauben; sie ist schlimmer als keine.
 * Deshalb beschädigt jeder Test hier etwas gezielt und sieht nach, ob es
 * auffällt.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { archivieren } from '../src/archiv'
import {
  dateienPruefen,
  kettePruefen,
  manifestErstellen,
  manifestVergleichen,
  schutzPruefen,
  type Manifest,
} from '../src/sicherung'
import type { Ablage } from '../src/ablage'
import { inhaltHash } from '../src/ablage'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'

const angelegt: string[] = []

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

/** Ein archivierter Beleg mit Datei — das, was die Prüfung ansieht. */
async function archivierterBeleg(
  ablage: Merkablage,
  inhalt = Buffer.from('%PDF-1.4 Beleg'),
): Promise<{ id: string; schluessel: string }> {
  const schluessel = `sicherung/${crypto.randomUUID()}/original.pdf`
  await ablage.schreiben(schluessel, inhalt)

  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', 'mail', $3, 'sicherung/' || gen_random_uuid(), 'gruen')
       returning id`,
      // Der Inhaltshash ist das, was der Archiveintrag uebernimmt -- er muss
      // zur Datei passen, sonst prueft der Test seine eigene Fixture.
      [MANDANT, OBJEKT_42, inhaltHash(inhalt)],
    )
    const neu = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto, wirtschaftsjahr)
       values ($1, $2, 'RE-SICH', current_date, 100, 19, 119, 2026)`,
      [neu, KREDITOR],
    )
    await c.query(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
       values ($1, 'original', $2, 'application/pdf', $3)`,
      [neu, schluessel, inhalt.byteLength],
    )
    await archivieren(c, neu)
    return neu
  })
  angelegt.push(id)
  return { id, schluessel }
}

/** Ein Lauf mit zwei Stempeln — damit es eine Kette zu prüfen gibt. */
async function laufMitKette(): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows: d } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'sicherung/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42],
    )
    const dok = d[0].id
    const { rows: s } = await c.query<{ id: string; definition_id: string }>(
      'select id, definition_id from prozessstufe order by reihenfolge limit 1',
    )
    const { rows: l } = await c.query<{ id: string }>(
      `insert into dokument_lauf (dokument_id, definition_id, definition_version,
                                  aktuelle_stufe_id, status)
       values ($1, $2, 1, $3, 'laufend') returning id`,
      [dok, s[0].definition_id, s[0].id],
    )
    for (const e of ['freigabe', 'freigabe']) {
      await c.query(
        `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung)
         values ($1, $2, $3, $4)`,
        [l[0].id, s[0].id, ANNA, e],
      )
    }
    return dok
  })
  angelegt.push(id)
  return id
}

afterEach(async () => {
  for (const id of angelegt) await belegEntfernen(id)
  angelegt.length = 0
})

afterAll(poolSchliessen)

describe('Die Hash-Kette', () => {
  it('meldet nichts, solange sie unversehrt ist', async () => {
    await laufMitKette()
    const befunde = await alsBenutzer(ANNA, kettePruefen)
    expect(befunde).toHaveLength(0)
  })

  it('merkt es, wenn ein Ereignis nachtraeglich veraendert wurde', async () => {
    await laufMitKette()

    /*
     * Am Trigger vorbei -- der laesst kein `update` zu. Genau deshalb ist
     * dieser Test moeglich und noetig: Ein Angreifer mit
     * Datenbankzugriff kann den Trigger abschalten, und was dann bleibt,
     * ist der nachgerechnete Hash.
     */
    await direkt('alter table stempel_ereignis disable trigger user')
    try {
      await direkt(
        `update stempel_ereignis set entscheidung = 'ablehnung'
          where id = (select id from stempel_ereignis order by folge desc limit 1)`,
      )
      const befunde = await alsBenutzer(ANNA, kettePruefen)
      expect(befunde.some((b) => b.art === 'hash_falsch')).toBe(true)
    } finally {
      await direkt('alter table stempel_ereignis enable trigger user')
    }
  })

  it('merkt es, wenn ein Ereignis herausgeschnitten wurde', async () => {
    await laufMitKette()

    await direkt('alter table stempel_ereignis disable trigger user')
    try {
      // Den ersten von zweien loeschen: Der zweite zeigt dann auf einen
      // Vorgaenger, den es nicht mehr gibt.
      await direkt(
        `delete from stempel_ereignis
          where id = (select id from stempel_ereignis order by folge asc limit 1)`,
      )
      const befunde = await alsBenutzer(ANNA, kettePruefen)
      expect(befunde.some((b) => b.art === 'verkettung_lose')).toBe(true)
    } finally {
      await direkt('alter table stempel_ereignis enable trigger user')
    }
  })

  it('rechnet unabhaengig von der Zeitzone des Servers', async () => {
    await laufMitKette()

    /*
     * **Der Fund dieses Blocks.** Der Kettenhash geht ueber
     * `zeitpunkt::text`, und dessen Darstellung haengt an `TimeZone` und
     * `DateStyle` der Sitzung. Vor der Reparatur stimmten alle Eintraege
     * unter UTC und **keiner** unter Europe/Berlin.
     *
     * Ein Restore geht selten auf denselben Rechner. Landete die Datenbank
     * auf einem Server mit deutscher Zeitzone -- fuer eine deutsche
     * Verwaltung die naheliegende Einstellung --, erschiene die gesamte
     * Kette gebrochen. Unter Zeitdruck wuerde daraus "das Archiv ist
     * zerstoert" oder, schlimmer, "die Pruefung ist kaputt, schalten wir
     * sie ab".
     */
    for (const zone of ['UTC', 'Europe/Berlin', 'America/New_York']) {
      const c = await verbindungspool().connect()
      try {
        await c.query(`set timezone = '${zone}'`)
        await c.query("set datestyle = 'German, DMY'")
        const { rows } = await c.query('select count(*) as n from app.kette_pruefen(500)')
        expect(Number(rows[0].n), zone).toBe(0)
      } finally {
        await c.query('reset all')
        c.release()
      }
    }
  })
})

describe('Die Schutzmechanismen', () => {
  it('meldet nichts, solange alles greift', async () => {
    const befunde = await alsBenutzer(ANNA, schutzPruefen)
    expect(befunde).toHaveLength(0)
  })

  it('merkt es, wenn die RLS an einer Tabelle abgeschaltet ist', async () => {
    /*
     * Die stillste Art, ein Archiv zu verlieren. Ein System ohne RLS sieht
     * im Betrieb voellig normal aus -- es faellt erst auf, wenn jemand
     * Daten sieht, die ihn nichts angehen.
     */
    await direkt('alter table dokument disable row level security')
    try {
      const befunde = await alsBenutzer(ANNA, schutzPruefen)
      expect(befunde.some((b) => b.art === 'rls_aus' && b.gegenstand === 'dokument')).toBe(true)
    } finally {
      await direkt('alter table dokument enable row level security')
    }
  })

  it('merkt es, wenn ein Unveraenderlichkeits-Trigger fehlt', async () => {
    await direkt('drop trigger archiv_eintrag_unveraenderlich on archiv_eintrag')
    try {
      const befunde = await alsBenutzer(ANNA, schutzPruefen)
      expect(
        befunde.some(
          (b) => b.art === 'trigger_fehlt' && b.gegenstand === 'archiv_eintrag_unveraenderlich',
        ),
      ).toBe(true)
    } finally {
      await direkt(
        `create trigger archiv_eintrag_unveraenderlich
           before update or delete on archiv_eintrag
           for each row execute function app.archiv_eintrag_schutz()`,
      )
    }
  })
})

describe('Die Dateien', () => {
  it('meldet nichts, solange Datei und Hash zusammenpassen', async () => {
    const ablage = new Merkablage()
    await archivierterBeleg(ablage)

    const { befunde, geprueft } = await alsBenutzer(ANNA, (c) => dateienPruefen(c, ablage))
    expect(befunde).toHaveLength(0)
    expect(geprueft).toBeGreaterThanOrEqual(1)
  })

  it('merkt es, wenn die Datei fehlt', async () => {
    const ablage = new Merkablage()
    const { id, schluessel } = await archivierterBeleg(ablage)
    ablage.dateien.delete(schluessel)

    const { befunde } = await alsBenutzer(ANNA, (c) => dateienPruefen(c, ablage))
    expect(befunde.some((b) => b.art === 'datei_fehlt' && b.gegenstand === id)).toBe(true)
  })

  it('merkt es, wenn die Datei eine andere geworden ist', async () => {
    const ablage = new Merkablage()
    const { id, schluessel } = await archivierterBeleg(ablage)

    // Untergeschoben -- genau der Fall, gegen den Hash-Kette und
    // Objektsperre zusammen stehen.
    await ablage.schreiben(schluessel, Buffer.from('%PDF-1.4 etwas anderes'))

    const { befunde } = await alsBenutzer(ANNA, (c) => dateienPruefen(c, ablage))
    expect(befunde.some((b) => b.art === 'hash_weicht_ab' && b.gegenstand === id)).toBe(true)
  })

  it('nennt keinen Ablageschluessel in der Meldung', async () => {
    const ablage = new Merkablage()
    const { schluessel } = await archivierterBeleg(ablage)
    ablage.dateien.delete(schluessel)

    // Der Schluessel traegt Mandant und Objekt -- er gehoert nicht in eine
    // Meldung, die in einem Protokoll landet (Projektregel).
    const { befunde } = await alsBenutzer(ANNA, (c) => dateienPruefen(c, ablage))
    expect(befunde.every((b) => !b.text.includes(schluessel))).toBe(true)
  })
})

describe('Das Manifest', () => {
  it('zaehlt den Bestand, nicht die Sicht eines Benutzers', async () => {
    const m = await alsBenutzer(ANNA, manifestErstellen)
    // Der Seed bringt Belege mit; eine Null hier hiesse, dass unter RLS
    // gezaehlt wurde -- und dann ginge jeder Vergleich immer auf.
    expect(m.zaehler['dokument']).toBeGreaterThan(0)
  })

  it('meldet fehlende Zeilen nach dem Zurueckholen', () => {
    const vorher: Manifest = { erstellt: 'x', zaehler: { dokument: 100, kontierung: 40 } }
    const nachher: Manifest = { erstellt: 'y', zaehler: { dokument: 97, kontierung: 40 } }

    const befunde = manifestVergleichen(vorher, nachher)
    expect(befunde).toHaveLength(1)
    expect(befunde[0].gegenstand).toBe('dokument')
    expect(befunde[0].text).toContain('3 von 100')
  })

  it('meldet zusaetzliche Zeilen nicht', () => {
    /*
     * Eine Sicherung wird im laufenden Betrieb gezogen: Bis zum Ende des
     * Abbilds koennen Belege dazugekommen sein. Fehlende dagegen kann es
     * nicht geben -- deshalb ist nur "weniger" ein Befund.
     */
    const vorher: Manifest = { erstellt: 'x', zaehler: { dokument: 100 } }
    const nachher: Manifest = { erstellt: 'y', zaehler: { dokument: 103 } }
    expect(manifestVergleichen(vorher, nachher)).toHaveLength(0)
  })
})
