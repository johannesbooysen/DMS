/**
 * Tests des Löschens nach Fristablauf (Konzept §24.5).
 *
 * **Hier wird eine Ausnahme von der wichtigsten Regel des Systems geprüft.**
 * „Nach der Archivierung ist der Beleg fest" gilt überall — außer wenn die
 * Aufbewahrungsfrist abgelaufen ist. Genau diese eine Ausnahme darf nicht
 * weiter reichen, als sie soll.
 *
 * Die Trigger fragen dafür eine **nachprüfbare Tatsache**
 * (`app.loeschung_faellig`) und keine Fahne, die jemand setzen kann. Ein
 * Sitzungsschalter wäre bequemer und wäre genau die Hintertür, gegen die es
 * die Trigger gibt. Diese Datei prüft, dass es keine gibt.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  endgueltigLoeschen,
  loeschdateienAbraeumen,
  loeschfaellige,
  loeschprotokoll,
  NichtLoeschbar,
} from '../src/archiv'
import type { Ablage } from '../src/ablage'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const EVA = '20000000-0000-0000-0000-000000000005'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

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
  async entfernen(schluessel: string): Promise<void> {
    this.dateien.delete(schluessel)
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

/**
 * Ein archivierter Beleg. `jahr` steuert die Frist — 2010 heißt: Aufbewahrung
 * bis Ende 2020, also längst abgelaufen.
 */
async function archivierterBeleg(
  jahr: number,
  ablage?: Merkablage,
  mitKontierung = false,
): Promise<{ id: string; schluessel: string }> {
  const schluessel = `loeschtest/${crypto.randomUUID()}/original.pdf`
  await ablage?.schreiben(schluessel, Buffer.from('%PDF-1.4 alt'))

  const id = await alsBenutzer(EVA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'loeschtest/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42],
    )
    const neu = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, rechnungsnummer, brutto, wirtschaftsjahr)
       values ($1, 'RE-LOESCH', 100, $2)`,
      [neu, jahr],
    )
    await c.query(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
       values ($1, 'original', $2, 'application/pdf', 12)`,
      [neu, schluessel],
    )
    if (mitKontierung) {
      await c.query(
        `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                                 steuersatz, betrag_brutto, umlagefaehig, quelle)
         values ($1, 1, '37000000-0000-0000-0000-000000000001', 100, 0, 100, false, 'mensch')`,
        [neu],
      )
    }
    await c.query('select app.dokument_archivieren($1)', [neu])
    return neu
  })
  return { id, schluessel }
}

afterEach(async () => {
  /*
   * Aufgeräumt wird über den gemeinsamen Helfer: Er setzt die Schutztrigger
   * kurz aus. Ohne das scheitert das Aufräumen an genau der Sperre, die
   * diese Datei prüft — mein erster Entwurf tat das, und alle 21 Tests
   * fielen an ihrer eigenen Nachbereitung.
   */
  const belege = await direkt<{ id: string }>(
    "select id from dokument where storage_praefix like 'loeschtest/%'",
  )
  for (const b of belege) await belegEntfernen(b.id)

  await direkt('alter table loeschung disable trigger loeschung_unveraenderlich')
  await direkt('delete from loeschung')
  await direkt('alter table loeschung enable trigger loeschung_unveraenderlich')
  await direkt("delete from einschraenkung where grund like 'Antrag%'")
})

afterAll(poolSchliessen)

describe('Wann geloescht werden darf', () => {
  it('haelt einen Beleg auf, dessen Frist noch laeuft', async () => {
    const { id } = await archivierterBeleg(2026)

    await expect(endgueltigLoeschen(EVA, id)).rejects.toBeInstanceOf(NichtLoeschbar)

    // Und er ist noch da -- die Ausnahme hat nicht gegriffen.
    const [z] = await direkt<{ n: string }>('select count(*) as n from dokument where id = $1', [id])
    expect(Number(z.n)).toBe(1)
  })

  it('nennt dabei das Datum, bis zu dem aufbewahrt wird', async () => {
    const { id } = await archivierterBeleg(2026)
    await expect(endgueltigLoeschen(EVA, id)).rejects.toThrow(/2036-12-31/)
  })

  it('loescht einen Beleg, dessen Frist abgelaufen ist', async () => {
    const { id } = await archivierterBeleg(2010)
    await endgueltigLoeschen(EVA, id)

    const [z] = await direkt<{ n: string }>('select count(*) as n from dokument where id = $1', [id])
    expect(Number(z.n)).toBe(0)
  })

  it('nimmt den Archiveintrag mit', async () => {
    const { id } = await archivierterBeleg(2010)
    await endgueltigLoeschen(EVA, id)

    // Ein Archiveintrag ohne Beleg waere ein Zeiger ins Leere -- und die
    // Aussage "dieser Beleg ist archiviert" ueber einen, den es nicht gibt.
    const [z] = await direkt<{ n: string }>(
      'select count(*) as n from archiv_eintrag where dokument_id = $1',
      [id],
    )
    expect(Number(z.n)).toBe(0)
  })

  it('haelt einen Beleg mit Loeschsperre auf', async () => {
    const { id } = await archivierterBeleg(2010)
    await direkt(
      `update archiv_eintrag set loeschsperre = true, loeschsperre_grund = 'Pruefung'
        where dokument_id = $1`,
      [id],
    )

    /*
     * Ein laufendes Verfahren haelt den Beleg, auch wenn die Frist abgelaufen
     * ist. Das ist der Sinn der Loeschsperre -- und sie muss staerker sein
     * als der Fristablauf, sonst waere sie wirkungslos.
     */
    await expect(endgueltigLoeschen(EVA, id)).rejects.toBeInstanceOf(NichtLoeschbar)
  })
})

describe('Die Ausnahme reicht nicht weiter, als sie soll', () => {
  it('laesst ein direktes delete am nicht faelligen Beleg nicht zu', async () => {
    const { id } = await archivierterBeleg(2026)

    /*
     * Der Kern. Die Schutztrigger fragen `app.loeschung_faellig` -- eine
     * Tatsache, keine Fahne. Wer die Funktion umgeht, kommt trotzdem nicht
     * durch.
     */
    await expect(direkt('delete from dokument where id = $1', [id])).rejects.toThrow(
      /Archivierte Belege werden nicht geloescht/,
    )
  })

  it('laesst die Kontierung eines nicht faelligen Belegs nicht loeschen', async () => {
    /*
     * Die Kontierung entsteht **vor** dem Archivieren — danach lässt der
     * Satellitenschutz sie gar nicht mehr anlegen. Mein erster Entwurf legte
     * sie danach an, fing den Fehler weg und prüfte dann das Löschen einer
     * Zeile, die es nie gab: grün, ohne etwas zu belegen.
     */
    const { id } = await archivierterBeleg(2026, undefined, true)

    await expect(direkt('delete from kontierung where dokument_id = $1', [id])).rejects.toThrow(
      /archiviert/,
    )
  })

  it('laesst einen Archiveintrag ohne faelligen Beleg nicht loeschen', async () => {
    const { id } = await archivierterBeleg(2026)
    await expect(
      direkt('delete from archiv_eintrag where dokument_id = $1', [id]),
    ).rejects.toThrow(/Archiveintraege werden nicht geloescht/)
  })

  it('laesst eine Objektbearbeiterin nicht loeschen', async () => {
    const { id } = await archivierterBeleg(2010)

    // Endgueltiges Loeschen ist Teil der Stammdatenpflege -- Anna hat das
    // Recht nicht.
    await expect(endgueltigLoeschen(ANNA, id)).rejects.toThrow(/Recht/)

    const [z] = await direkt<{ n: string }>('select count(*) as n from dokument where id = $1', [id])
    expect(Number(z.n)).toBe(1)
  })

  it('laesst nicht ueber die Mandantengrenze loeschen', async () => {
    const { id } = await archivierterBeleg(2010)

    // Doris gehoert zu einem anderen Mandanten. Ein Loeschen ueber die
    // Grenze waere der schlimmste denkbare Fehler.
    await expect(endgueltigLoeschen(DORIS, id)).rejects.toBeInstanceOf(NichtLoeschbar)

    const [z] = await direkt<{ n: string }>('select count(*) as n from dokument where id = $1', [id])
    expect(Number(z.n)).toBe(1)
  })
})

describe('Das Loeschprotokoll', () => {
  it('haelt fest, dass es den Beleg gab', async () => {
    const { id } = await archivierterBeleg(2010)
    await endgueltigLoeschen(EVA, id)

    const protokoll = await loeschprotokoll(EVA)
    const zeile = protokoll.find((p) => p.dokumentId === id)

    /*
     * Ohne Protokoll waere eine Luecke im Archiv nicht von einem Verlust zu
     * unterscheiden: Ein Pruefer, der einen Beleg sucht und nicht findet,
     * kann nicht wissen, ob er geloescht wurde oder abhanden kam.
     */
    expect(zeile?.grund).toBe('fristablauf')
    expect(zeile?.geloeschtVon).toBe('Eva Ebert')
    expect(zeile?.aufbewahrungBis).toBe('2020-12-31')
  })

  it('unterscheidet Loeschanspruch von blossem Fristablauf', async () => {
    const { id } = await archivierterBeleg(2010)
    await direkt(
      `insert into einschraenkung (dokument_id, mandant_id, grund, beantragt_am, loeschbar_ab)
       values ($1, $2, 'Antrag der betroffenen Person', current_date - 30, current_date - 1)`,
      [id, MANDANT],
    )

    await endgueltigLoeschen(EVA, id)
    const zeile = (await loeschprotokoll(EVA)).find((p) => p.dokumentId === id)

    /*
     * Fachlich verschieden: Der eine erfuellt einen Anspruch, der andere
     * eine Pflicht. In einem Topf waere nicht mehr zu sehen, ob jemand auf
     * eine Antwort gewartet hat.
     */
    expect(zeile?.grund).toBe('loeschanspruch')
  })

  it('enthaelt keine personenbezogenen Daten', async () => {
    const { id } = await archivierterBeleg(2010)
    await endgueltigLoeschen(EVA, id)

    const [spalten] = await direkt<{ spalten: string[] }>(
      `select array_agg(column_name::text) as spalten
         from information_schema.columns
        where table_name = 'loeschung'`,
    )

    /*
     * Ein Loeschprotokoll, das den Namen des Kreditors behaelt, hat nicht
     * geloescht. Was bleibt, sind Kennung, Fristen und Hash.
     */
    for (const verboten of ['kreditor', 'name', 'betreff', 'iban', 'rechnungsnummer']) {
      expect(spalten.spalten.some((s) => s.includes(verboten))).toBe(false)
    }
  })

  it('laesst sich nicht loeschen', async () => {
    const { id } = await archivierterBeleg(2010)
    await endgueltigLoeschen(EVA, id)

    await expect(
      direkt('delete from loeschung where dokument_id = $1', [id]),
    ).rejects.toThrow(/nicht geloescht/)
  })

  it('laesst sich nicht umschreiben', async () => {
    const { id } = await archivierterBeleg(2010)
    await endgueltigLoeschen(EVA, id)

    await expect(
      direkt("update loeschung set grund = 'fristablauf', hash_sha256 = 'x' where dokument_id = $1", [id]),
    ).rejects.toThrow(/nur vermerken/)
  })
})

describe('Die Dateien werden abgeraeumt', () => {
  it('entfernt die Datei erst im Durchgang, nicht beim Loeschen', async () => {
    const ablage = new Merkablage()
    const { id, schluessel } = await archivierterBeleg(2010, ablage)

    await endgueltigLoeschen(EVA, id)

    /*
     * Der Beleg ist mit dem Commit geloescht. Ob der Objektspeicher gerade
     * erreichbar ist, darf daran nichts aendern -- deshalb liegt die Datei
     * noch.
     */
    expect(ablage.dateien.has(schluessel)).toBe(true)
    expect((await loeschprotokoll(EVA)).find((p) => p.dokumentId === id)?.dateiOffen).toBe(true)

    const bilanz = await loeschdateienAbraeumen(ablage)
    expect(bilanz.entfernt).toBeGreaterThanOrEqual(1)
    expect(ablage.dateien.has(schluessel)).toBe(false)
    expect((await loeschprotokoll(EVA)).find((p) => p.dokumentId === id)?.dateiOffen).toBe(false)
  })

  it('greift dieselbe Datei kein zweites Mal auf', async () => {
    const ablage = new Merkablage()
    const { id } = await archivierterBeleg(2010, ablage)
    await endgueltigLoeschen(EVA, id)

    await loeschdateienAbraeumen(ablage)
    // Der Vermerk ist die Erledigung -- ein zweiter Durchgang findet nichts
    // mehr, sonst liefe er ewig ueber dieselben Zeilen.
    expect((await loeschdateienAbraeumen(ablage)).entfernt).toBe(0)
  })
})

describe('Die Kandidatenliste', () => {
  it('zeigt nur Belege mit abgelaufener Frist', async () => {
    const alt = await archivierterBeleg(2010)
    const frisch = await archivierterBeleg(2026)

    const faellig = await loeschfaellige(EVA)
    expect(faellig.some((f) => f.dokumentId === alt.id)).toBe(true)
    expect(faellig.some((f) => f.dokumentId === frisch.id)).toBe(false)
  })

  it('zeigt auch Belege ohne Loeschanspruch', async () => {
    const { id } = await archivierterBeleg(2010)

    /*
     * Der Fund dieses Blocks: `app.loeschkandidaten` verbindet auf
     * `einschraenkung` und kannte deshalb nur Belege mit Anspruch. Belege,
     * nach denen niemand gefragt hat, deren Frist aber vorbei ist, fielen
     * durch -- und die Loeschpflicht nach Fristablauf war unerfuellbar.
     */
    const faellig = await loeschfaellige(EVA)
    expect(faellig.find((f) => f.dokumentId === id)?.grund).toBe('fristablauf')

    const alt = await direkt<{ dokument_id: string }>(
      'select dokument_id from app.loeschkandidaten()',
    )
    expect(alt.some((z) => z.dokument_id === id)).toBe(false)
  })

  it('laesst eine Loeschsperre die Frist ueberdauern', async () => {
    const { id } = await archivierterBeleg(2010)
    await direkt(
      `update archiv_eintrag set loeschsperre = true, loeschsperre_grund = 'Rechtsstreit'
        where dokument_id = $1`,
      [id],
    )

    expect((await loeschfaellige(EVA)).some((f) => f.dokumentId === id)).toBe(false)
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    await archivierterBeleg(2010)
    expect(await loeschfaellige(DORIS)).toHaveLength(0)
  })
})
