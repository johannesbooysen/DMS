/**
 * Tests der Postfächer und des Stempelns.
 *
 * Der Schwerpunkt liegt auf der Berechtigung: Die Oberfläche zeigt nur
 * mögliche Schaltflächen, aber die Entscheidung fällt serverseitig. Ein
 * untergeschobener Stempeltyp muss scheitern, auch wenn er in der Datenbank
 * existiert und der Benutzer die Aufgabe sehen darf.
 *
 * Anders als die übrigen Tests kann dieser nicht zurückrollen: Die geprüften
 * Funktionen führen ihre eigenen Transaktionen und schreiben fest. Deshalb
 * legt jeder Test seinen **eigenen** Beleg an und räumt ihn danach weg — die
 * Seed-Daten bleiben unberührt, und die Reihenfolge der Testdateien spielt
 * keine Rolle.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  aufgabeLaden,
  klaerungsPostfach,
  persoenlichesPostfach,
  poolPostfach,
  StempelAbgelehnt,
  stempelSetzen,
} from '../src/app/lib/postfach'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const CLARA = '20000000-0000-0000-0000-000000000003'
const EVA = '20000000-0000-0000-0000-000000000005'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'

const SACHLICH_RICHTIG = '60000000-0000-0000-0000-000000000001'
const ZUR_KLAERUNG = '60000000-0000-0000-0000-000000000002'
const RECHNERISCH_RICHTIG = '60000000-0000-0000-0000-000000000003'
const FREIGEGEBEN = '60000000-0000-0000-0000-000000000004'

let beleg = ''

beforeEach(async () => {
  beleg = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, ORDNUNGSGRUPPE_BK],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-POSTFACH', current_date, 1000, 190, 1190)`,
      [id, KREDITOR],
    )
    await laufStarten(c, id)
    return id
  })
})

afterEach(async () => {
  // Aufraeumen ist hier aufwendiger als erwartet, und das ist gut so: Der
  // Append-only-Schutz auf stempel_ereignis verhindert auch das Loeschen
  // ueber die Kaskade. Ein Beleg, an dem gestempelt wurde, laesst sich im
  // Betrieb nicht entfernen -- genau das verlangt das Konzept. Fuer den Test
  // wird der Trigger kurz ausgesetzt; im Betrieb tut das niemand.
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

/** Die offene Aufgabe des Testbelegs im Postfach des Benutzers. */
async function meineAufgabe(benutzer: string) {
  const zeilen = await persoenlichesPostfach(benutzer)
  const zeile = zeilen.find((z) => z.dokumentId === beleg)
  if (zeile === undefined) throw new Error('Aufgabe zum Testbeleg nicht im Postfach')
  return zeile
}

describe('Persoenliches Postfach', () => {
  it('zeigt dem Objektverantwortlichen die neue Aufgabe', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    expect(aufgabe.stufe).toBe('Sachliche Pruefung')
    expect(aufgabe.brutto).toBe(1190)
  })

  it('zeigt sie einem anderen Benutzer nicht', async () => {
    const zeilen = await persoenlichesPostfach(BERND)
    expect(zeilen.map((z) => z.dokumentId)).not.toContain(beleg)
  })

  it('nimmt eine erledigte Aufgabe aus dem Postfach', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    const nachher = await persoenlichesPostfach(ANNA)
    expect(nachher.map((z) => z.aufgabeId)).not.toContain(aufgabe.aufgabeId)
  })
})

describe('Uebergabe zwischen den Rollen', () => {
  it('reicht den Beleg von der Objektbearbeitung an die Buchhaltung weiter', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    // Die naechste Stufe gehoert einer Rolle, nicht einer Person: Sie
    // erscheint im Pool aller, die die Rolle fuer dieses Objekt tragen.
    const beiBernd = (await poolPostfach(BERND)).find((z) => z.dokumentId === beleg)
    expect(beiBernd?.stufe).toBe('Rechnerische Pruefung')

    // Und nicht bei jemandem ohne diese Rolle.
    expect((await poolPostfach(ANNA)).map((z) => z.dokumentId)).not.toContain(beleg)
  })

  it('fuehrt den Beleg ueber drei Rollen bis zum Abschluss', async () => {
    const anna = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, { aufgabeId: anna.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    const bernd = (await poolPostfach(BERND)).find((z) => z.dokumentId === beleg)!
    await stempelSetzen(BERND, { aufgabeId: bernd.aufgabeId, stempeltypId: RECHNERISCH_RICHTIG })

    const eva = (await poolPostfach(EVA)).find((z) => z.dokumentId === beleg)!
    expect(eva.stufe).toBe('Freigabe Geschaeftsleitung')
    await stempelSetzen(EVA, { aufgabeId: eva.aufgabeId, stempeltypId: FREIGEGEBEN })

    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query<{ status: string; stempel: string }>(
        `select l.status,
                (select count(*) from stempel_ereignis e where e.lauf_id = l.id) as stempel
           from dokument_lauf l where l.dokument_id = $1`,
        [beleg],
      )
      expect(rows[0].status).toBe('abgeschlossen')
      expect(Number(rows[0].stempel)).toBe(3)
    } finally {
      c.release()
    }
  })

  it('gibt die Freigabestufe niemandem ausserhalb der Geschaeftsleitung', async () => {
    const anna = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, { aufgabeId: anna.aufgabeId, stempeltypId: SACHLICH_RICHTIG })
    const bernd = (await poolPostfach(BERND)).find((z) => z.dokumentId === beleg)!
    await stempelSetzen(BERND, { aufgabeId: bernd.aufgabeId, stempeltypId: RECHNERISCH_RICHTIG })

    expect((await poolPostfach(BERND)).map((z) => z.dokumentId)).not.toContain(beleg)
    expect((await persoenlichesPostfach(ANNA)).map((z) => z.dokumentId)).not.toContain(beleg)
  })
})

describe('Moegliche Stempel', () => {
  it('bietet dem Objektbearbeiter genau seine drei Entscheidungen', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    const geladen = await aufgabeLaden(ANNA, aufgabe.aufgabeId)

    expect(geladen?.stempel.map((s) => s.name).sort()).toEqual([
      'Abgelehnt',
      'Sachlich richtig',
      'Zur Klaerung',
    ])
  })

  it('bietet dem Buchhalter an derselben Stufe nur die Klaerung', async () => {
    // Bernd sieht den Beleg (mandantenweite Rolle), darf hier aber nur eines.
    const aufgabe = await meineAufgabe(ANNA)
    const geladen = await aufgabeLaden(BERND, aufgabe.aufgabeId)

    expect(geladen?.stempel.map((s) => s.name)).toEqual(['Zur Klaerung'])
  })

  it('zeigt einem Benutzer ohne Sicht auf den Beleg gar nichts', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    // Clara sieht nur ihr Spezialgebiet, nicht Objekt 42.
    expect(await aufgabeLaden(CLARA, aufgabe.aufgabeId)).toBeNull()
  })
})

describe('Stempeln', () => {
  it('rueckt den Lauf zur naechsten Stufe', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query<{ bezeichnung: string }>(
        `select s.bezeichnung from aufgabe a
           join prozessstufe s on s.id = a.stufe_id
          where a.lauf_id = $1 and a.status = 'offen'`,
        [aufgabe.laufId],
      )
      expect(rows.map((r) => r.bezeichnung)).toEqual(['Rechnerische Pruefung'])
    } finally {
      c.release()
    }
  })

  it('weist einen Stempel ab, der an dieser Stufe nicht vorgesehen ist', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    // "Freigegeben" gibt es, aber erst an der Freigabestufe.
    await expect(
      stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: FREIGEGEBEN }),
    ).rejects.toThrow(StempelAbgelehnt)
  })

  it('weist einen Stempel ab, fuer den dem Benutzer das Recht fehlt', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await expect(
      stempelSetzen(BERND, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG }),
    ).rejects.toThrow(StempelAbgelehnt)
  })

  it('verlangt bei Klaerung einen Kommentar', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await expect(
      stempelSetzen(ANNA, {
        aufgabeId: aufgabe.aufgabeId,
        stempeltypId: ZUR_KLAERUNG,
        wiedervorlageAm: '2026-09-30',
      }),
    ).rejects.toThrow(/Kommentar/)
  })

  it('verlangt bei Klaerung ein Wiedervorlagedatum', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await expect(
      stempelSetzen(ANNA, {
        aufgabeId: aufgabe.aufgabeId,
        stempeltypId: ZUR_KLAERUNG,
        kommentar: 'Rueckfrage beim Lieferanten',
      }),
    ).rejects.toThrow(/Wiedervorlage/)
  })

  it('legt bei Klaerung einen Eintrag im Klaerungspostfach an', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, {
      aufgabeId: aufgabe.aufgabeId,
      stempeltypId: ZUR_KLAERUNG,
      kommentar: 'Position 3 unklar',
      wiedervorlageAm: '2026-09-30',
    })

    const klaerungen = await klaerungsPostfach(ANNA)
    expect(klaerungen.find((k) => k.dokumentId === beleg)?.kommentar).toBe('Position 3 unklar')
  })

  it('haelt die Aufgabe bei Klaerung offen -- die Stempel bleiben gueltig', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, {
      aufgabeId: aufgabe.aufgabeId,
      stempeltypId: ZUR_KLAERUNG,
      kommentar: 'Position 3 unklar',
      wiedervorlageAm: '2026-09-30',
    })

    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query<{ status: string; lauf: string }>(
        `select a.status, l.status as lauf from aufgabe a
           join dokument_lauf l on l.id = a.lauf_id
          where a.id = $1`,
        [aufgabe.aufgabeId],
      )
      expect(rows[0].status).toBe('offen')
      expect(rows[0].lauf).toBe('klaerung')
    } finally {
      c.release()
    }
  })

  it('macht den Beleg unloeschbar, sobald gestempelt wurde', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    // Auch als Tabelleneigentuemer und auch ueber die Kaskade: Das Ereignis
    // haelt den Beleg fest. "Nie loeschen" ist damit nicht nur eine Regel im
    // Handbuch, sondern eine Eigenschaft der Datenbank.
    const c = await verbindungspool().connect()
    try {
      await expect(
        c.query('delete from dokument where id = $1', [beleg]),
      ).rejects.toThrow(/append-only/i)
    } finally {
      c.release()
    }
  })

  it('schreibt zu jedem Stempel ein Ereignis mit dem handelnden Benutzer', async () => {
    const aufgabe = await meineAufgabe(ANNA)
    await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query<{ benutzer_id: string; stempeltyp_id: string }>(
        'select benutzer_id, stempeltyp_id from stempel_ereignis where lauf_id = $1',
        [aufgabe.laufId],
      )
      expect(rows).toEqual([{ benutzer_id: ANNA, stempeltyp_id: SACHLICH_RICHTIG }])
    } finally {
      c.release()
    }
  })
})
