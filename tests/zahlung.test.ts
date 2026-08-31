/**
 * Tests der Zahlungsübergabe und der harten Sperre davor.
 *
 * Der Schwerpunkt liegt auf dem Wort **gültig** aus Konzept 8.2: „Vor der
 * Bankübergabe prüft die Engine, dass jede Pflichtstufe einen gültigen
 * Stempel hat." Ein gesetzter Stempel ist nicht dasselbe wie ein gültiger —
 * wird nach der Freigabe der Betrag korrigiert, war die Freigabe für eine
 * andere Rechnung. Genau das ist der teuerste Fehler, den ein solches System
 * machen kann, und er sieht in keiner Liste verdächtig aus.
 *
 * Der zweite Schwerpunkt: Eine gescheiterte Übergabe darf **keine** Zahlung
 * als übergeben hinterlassen. Der Beleg verschwände aus allen Listen, und das
 * Geld flösse nie.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  exportzeile,
  istLastschrift,
  UebergabeNichtMoeglich,
  wegFuer,
  zahlungMoeglich,
  zahlungUebergeben,
  zahlungenLaden,
  type Postablage,
} from '../src/zahlung'
import { freigabenNachpruefen } from '../src/zahlung/sperre'
import type { Ablage } from '../src/ablage'
import { stempelSetzen, StempelAbgelehnt, persoenlichesPostfach } from '../src/app/lib/postfach'
import { laufStarten } from '../src/workflow/engine'
import { ibanMaskieren, zahlungsansichtLaden } from '../src/app/lib/zahlung-daten'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const KONTO_HAUSREINIGUNG = '37000000-0000-0000-0000-000000000001'
const SACHLICH_RICHTIG = '60000000-0000-0000-0000-000000000001'
const WEG_SCAN2BANK = '45000000-0000-0000-0000-000000000001'

/* Eigener Ablauf: eine Prüfstufe, danach die Zahlungsstufe. Zwei Stufen,
 * weil die Sperre genau das prüft -- ist die Pflichtstufe davor durch? */
const GRUPPE = '40000000-0000-0000-0000-0000000000e0'
const DEFINITION = '65000000-0000-0000-0000-0000000000e0'
const STUFE_PRUEFUNG = '66000000-0000-0000-0000-0000000000e0'
const STUFE_ZAHLUNG = '66000000-0000-0000-0000-0000000000e1'
const WURZEL = '67000000-0000-0000-0000-0000000000e0'
const BLATT_PRUEFUNG = '67000000-0000-0000-0000-0000000000e1'
const BLATT_ZAHLUNG = '67000000-0000-0000-0000-0000000000e2'

/* Ein zweiter Weg mit Dateiexport -- damit "Weg ist ein Stammdatum" auch
 * geprüft und nicht nur behauptet ist. */
const WEG_EXPORT = '45000000-0000-0000-0000-0000000000e0'

const BRUTTO = 1190

let beleg = ''

/** Ablage, die im Speicher bleibt. Der Test soll keine Dateien hinterlassen. */
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

/** Sammelt Ausgangseintraege, statt sie in die Datenbank zu legen. */
class Merkpost implements Postablage {
  readonly eintraege: Array<{ empfaenger: string; schluessel: string }> = []
  async anlegen(eingabe: { empfaenger: string; schluessel: string }): Promise<string> {
    this.eintraege.push({ empfaenger: eingabe.empfaenger, schluessel: eingabe.schluessel })
    return 'test'
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

beforeEach(async () => {
  await alsBenutzer(ANNA, async (c) => {
    await c.query(
      `insert into ordnungsgruppe (id, mandant_id, name, kurzcode, sortierung)
       values ($1, $2, 'Zahlungstest', 'ZTT', 920)
       on conflict (id) do update set aktiv = true`,
      [GRUPPE, MANDANT],
    )
    await c.query(
      `insert into prozessdefinition (id, mandant_id, belegart, ordnungsgruppe_id,
                                      version, status, aktiv_ab)
       values ($1, $2, 'rechnung', $3, 1, 'aktiv', now())
       on conflict (id) do update set status = 'aktiv'`,
      [DEFINITION, MANDANT, GRUPPE],
    )
    await c.query(
      `insert into prozessstufe (id, definition_id, reihenfolge, stufentyp,
                                 bezeichnung, zustaendigkeit_typ, sla_stunden)
       values ($1, $3, 1, 'sachlich', 'Sachliche Pruefung', 'objektverantwortlich', 48),
              ($2, $3, 2, 'zahlung', 'Bankuebergabe', 'objektverantwortlich', 24)
       on conflict (id) do nothing`,
      [STUFE_PRUEFUNG, STUFE_ZAHLUNG, DEFINITION],
    )
    await c.query(
      `insert into prozessknoten (id, definition_id, eltern_id, reihenfolge,
                                  knotentyp, stufe_id)
       values ($1, $2, null, 0, 'nacheinander', null),
              ($3, $2, $1, 0, 'stufe', $5),
              ($4, $2, $1, 1, 'stufe', $6)
       on conflict (id) do nothing`,
      [WURZEL, DEFINITION, BLATT_PRUEFUNG, BLATT_ZAHLUNG, STUFE_PRUEFUNG, STUFE_ZAHLUNG],
    )
    await c.query(
      `insert into prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung)
       values ($1, $3, 0), ($2, $3, 0)
       on conflict do nothing`,
      [STUFE_PRUEFUNG, STUFE_ZAHLUNG, SACHLICH_RICHTIG],
    )
    await c.query(
      `insert into zahlungsweg (id, mandant_id, name, art, ziel, bankdaten_pflicht,
                                archiviert_sofort)
       values ($1, $2, 'Dateiexport (Test)', 'datei_export', 'ausgang/', true, false)
       -- Reaktivieren, nicht nur anlegen: Das Aufraeumen am Ende setzt den Weg
       -- inaktiv (geloescht wird nichts), und beim naechsten Lauf haette ein
       -- blosses "do nothing" einen toten Weg hinterlassen.
       on conflict (id) do update set aktiv = true`,
      [WEG_EXPORT, MANDANT],
    )

    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, GRUPPE],
    )
    beleg = rows[0].id

    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto, zahlungsziel)
       values ($1, $2, 'RE-ZAHLUNG', current_date, 1000, 190, $3,
               current_date + 14)`,
      [beleg, KREDITOR, BRUTTO],
    )
    // Vollstaendig kontiert -- sonst blockiert schon der Summenzwang, und der
    // Test prüfte etwas anderes als er behauptet.
    await c.query(
      `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                               steuersatz, betrag_brutto, umlagefaehig, quelle)
       values ($1, 1, $2, 1000, 19, $3, true, 'mensch')`,
      [beleg, KONTO_HAUSREINIGUNG, BRUTTO],
    )
    await laufStarten(c, beleg)
  })
})

afterEach(async () => {
  await belegEntfernen(beleg)
  await direkt('delete from ausgang')
  await direkt('update objekt set zahlungsweg_id = $2 where id = $1', [
    OBJEKT_42,
    WEG_SCAN2BANK,
  ])
  await direkt(`update kreditor_bankverbindung set status = 'verifiziert'
                 where kreditor_id = $1`, [KREDITOR])
})

afterAll(async () => {
  await alsBenutzer(ANNA, async (c) => {
    await c.query(`update prozessdefinition set status = 'abgeloest' where id = $1`, [DEFINITION])
    await c.query('update ordnungsgruppe set aktiv = false where id = $1', [GRUPPE])
    await c.query('update zahlungsweg set aktiv = false where id = $1', [WEG_EXPORT])
  })
  await poolSchliessen()
})

/** Die erste Stufe abstempeln, damit die Zahlungsstufe an der Reihe ist. */
async function pruefungAbschliessen(): Promise<void> {
  const offen = await persoenlichesPostfach(ANNA)
  const aufgabe = offen.find((z) => z.dokumentId === beleg && z.stufentyp === 'sachlich')
  if (aufgabe === undefined) throw new Error('Pruefaufgabe nicht gefunden')
  await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })
}

async function zahlungsaufgabe() {
  const offen = await persoenlichesPostfach(ANNA)
  const aufgabe = offen.find((z) => z.dokumentId === beleg && z.stufentyp === 'zahlung')
  if (aufgabe === undefined) throw new Error('Zahlungsaufgabe nicht gefunden')
  return aufgabe
}

async function sperre() {
  return alsBenutzer(ANNA, (c) => zahlungMoeglich(c, beleg))
}

describe('Die harte Sperre', () => {
  it('haelt den Beleg auf, solange eine Pflichtstufe offen ist', async () => {
    const ergebnis = await sperre()
    expect(ergebnis.moeglich).toBe(false)
    expect(ergebnis.hindernis).toMatch(/Pflichtstufen offen/)
  })

  it('gibt ihn frei, wenn alle Pflichtstufen durch sind', async () => {
    await pruefungAbschliessen()
    expect(await sperre()).toMatchObject({ moeglich: true, hindernis: null })
  })

  it('haelt ihn auf, wenn die Kontierung nicht mehr aufgeht', async () => {
    await pruefungAbschliessen()
    await direkt('delete from kontierung where dokument_id = $1', [beleg])
    const ergebnis = await sperre()
    expect(ergebnis.moeglich).toBe(false)
    expect(ergebnis.hindernis).toMatch(/Kontierung/)
  })

  it('haelt ihn auf bei einem harten Plausibilitaetsbefund', async () => {
    await pruefungAbschliessen()
    await direkt(
      `insert into plausibilitaet_befund (dokument_id, pruefung, schwere, hinweis)
       values ($1, 'iban_fremd', 'hart', 'Die IBAN gehoert nicht zum Kreditor.')`,
      [beleg],
    )
    expect((await sperre()).hindernis).toMatch(/IBAN/)
  })

  it('haelt ihn auf ohne verifizierte Bankverbindung', async () => {
    await pruefungAbschliessen()
    await direkt(`update kreditor_bankverbindung set status = 'neu' where kreditor_id = $1`, [
      KREDITOR,
    ])
    expect((await sperre()).hindernis).toMatch(/Bankverbindung/)
  })

  it('haelt ihn auf ohne Zahlungsweg am Objekt', async () => {
    await pruefungAbschliessen()
    await direkt('update objekt set zahlungsweg_id = null where id = $1', [OBJEKT_42])
    expect((await sperre()).hindernis).toMatch(/kein Zahlungsweg/)
  })
})

describe('Ein Stempel ist nicht dasselbe wie ein gueltiger Stempel', () => {
  it('haelt jeden Freigabestempel am Datenstand fest', async () => {
    await pruefungAbschliessen()
    const [zeile] = await direkt<{ freigabe_hash: string | null }>(
      `select e.freigabe_hash from stempel_ereignis e
         join dokument_lauf l on l.id = e.lauf_id
        where l.dokument_id = $1 and e.entscheidung = 'freigabe'`,
      [beleg],
    )
    expect(zeile.freigabe_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('laesst die Freigabe verfallen, wenn der Betrag sich aendert', async () => {
    await pruefungAbschliessen()
    expect((await sperre()).moeglich).toBe(true)

    // Der teuerste Fehler: Freigegeben wurden 1190, gezahlt wuerden 11900.
    await direkt('update rechnung_fakten set brutto = 11900 where dokument_id = $1', [beleg])

    const ergebnis = await sperre()
    expect(ergebnis.moeglich).toBe(false)
    expect(ergebnis.hindernis).toMatch(/nach der Freigabe geaendert/)
    expect(ergebnis.verfallen).toBe(1)
  })

  it('laesst sie auch verfallen, wenn der Beleg umgruppiert wird', async () => {
    await pruefungAbschliessen()
    await direkt('update dokument set objekt_id = $2 where id = $1', [
      beleg,
      '50000000-0000-0000-0000-000000000043',
    ])
    expect((await sperre()).moeglich).toBe(false)
  })

  it('schreibt das Verfallen als Ereignis, nicht stillschweigend', async () => {
    await pruefungAbschliessen()
    await direkt('update rechnung_fakten set brutto = 11900 where dokument_id = $1', [beleg])
    await sperre()

    const ereignisse = await direkt<{ entscheidung: string; kommentar: string | null }>(
      `select e.entscheidung, e.kommentar from stempel_ereignis e
         join dokument_lauf l on l.id = e.lauf_id
        where l.dokument_id = $1 order by e.folge`,
      [beleg],
    )
    expect(ereignisse.map((e) => e.entscheidung)).toContain('verfallen')
    // Ohne Kommentar staende spaeter im Protokoll ein Ruecksprung, den
    // niemand erklaeren kann.
    const verfallen = ereignisse.find((e) => e.entscheidung === 'verfallen')
    expect(verfallen?.kommentar).toMatch(/geaendert/)
  })

  it('oeffnet die betroffene Aufgabe wieder', async () => {
    await pruefungAbschliessen()
    await direkt('update rechnung_fakten set brutto = 11900 where dokument_id = $1', [beleg])
    await sperre()

    const offen = await persoenlichesPostfach(ANNA)
    expect(offen.some((z) => z.dokumentId === beleg && z.stufentyp === 'sachlich')).toBe(true)
  })

  it('laesst gueltige Stempel in Ruhe', async () => {
    await pruefungAbschliessen()
    const verfallen = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'select id from dokument_lauf where dokument_id = $1',
        [beleg],
      )
      return freigabenNachpruefen(c, rows[0].id)
    })
    expect(verfallen).toBe(0)
  })
})

describe('Uebergabe', () => {
  it('legt beim Dateiexport eine Datei an und vermerkt sie', async () => {
    await pruefungAbschliessen()
    await direkt('update objekt set zahlungsweg_id = $2 where id = $1', [OBJEKT_42, WEG_EXPORT])

    const ablage = new Merkablage()
    const ergebnis = await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(c, { ablage }, { dokumentId: beleg, benutzerId: ANNA }),
    )

    expect(ergebnis.status).toBe('uebergeben')
    expect(ablage.dateien.size).toBe(1)

    const inhalt = [...ablage.dateien.values()][0].toString('utf8')
    expect(inhalt).toContain('Musterreinigung GmbH')
    expect(inhalt).toContain('RE-ZAHLUNG')
    expect(inhalt).toContain('1190,00')
  })

  it('vermerkt die Zahlung als uebergeben, mit Zeitpunkt und Person', async () => {
    await pruefungAbschliessen()
    await direkt('update objekt set zahlungsweg_id = $2 where id = $1', [OBJEKT_42, WEG_EXPORT])
    await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(c, { ablage: new Merkablage() }, { dokumentId: beleg, benutzerId: ANNA }),
    )

    const [zahlung] = await direkt<{
      status: string
      uebergeben_von: string
      betrag: string
      art: string
    }>('select status, uebergeben_von, betrag, art from zahlung where dokument_id = $1', [beleg])

    expect(zahlung.status).toBe('uebergeben')
    expect(zahlung.uebergeben_von).toBe(ANNA)
    expect(Number(zahlung.betrag)).toBe(BRUTTO)
    expect(zahlung.art).toBe('voll')
  })

  it('uebergibt per Mail an das Ziel des Weges', async () => {
    await pruefungAbschliessen()
    const post = new Merkpost()
    const ergebnis = await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(
        c,
        { ablage: new Merkablage(), post },
        { dokumentId: beleg, benutzerId: ANNA },
      ),
    )

    expect(ergebnis.status).toBe('uebergeben')
    // Der Mailweg sendet nicht selbst, er legt einen Ausgang an. Gesendet
    // wird im Worker -- ein haengender Mailserver blockiert keinen Stempel.
    expect(post.eintraege).toHaveLength(1)
    expect(post.eintraege[0].empfaenger).toBe('zahlungen@bank.example.invalid')
    expect(post.eintraege[0].schluessel).toBe('zahlungsauftrag')
    expect(ergebnis.protokoll).toMatch(/Ausgangsbuch/)
  })

  it('uebergibt nichts, wenn kein Postausgang eingerichtet ist', async () => {
    await pruefungAbschliessen()
    await expect(
      alsBenutzer(ANNA, (c) =>
        zahlungUebergeben(
          c,
          { ablage: new Merkablage(), post: null },
          { dokumentId: beleg, benutzerId: ANNA },
        ),
      ),
    ).rejects.toBeInstanceOf(UebergabeNichtMoeglich)

    // Der entscheidende Teil bleibt: keine Zahlung, die als uebergeben gilt.
    expect(await direkt('select 1 from zahlung where dokument_id = $1', [beleg])).toHaveLength(0)
  })

  it('legt bei gesperrtem Beleg keine Zahlung an', async () => {
    // Ohne abgeschlossene Pruefstufe.
    const ergebnis = await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(c, { ablage: new Merkablage() }, { dokumentId: beleg, benutzerId: ANNA }),
    )
    expect(ergebnis.status).toBe('gesperrt')
    expect(await direkt('select 1 from zahlung where dokument_id = $1', [beleg])).toHaveLength(0)
  })
})

describe('Lastschrift', () => {
  it('erkennt sie am Beleg', () => {
    expect(istLastschrift({ zahlungsart: 'lastschrift', vertrag_zahlungsart: null })).toBe(true)
  })

  it('erkennt sie am Vertrag, wenn der Beleg nichts sagt', () => {
    expect(istLastschrift({ zahlungsart: null, vertrag_zahlungsart: 'lastschrift' })).toBe(true)
  })

  it('laesst den Beleg gewinnen', () => {
    // Eine einmalige Rechnung eines Lieferanten mit Lastschriftvertrag kann
    // trotzdem zu ueberweisen sein.
    expect(
      istLastschrift({ zahlungsart: 'ueberweisung', vertrag_zahlungsart: 'lastschrift' }),
    ).toBe(false)
  })

  it('uebergibt nichts, vermerkt aber die Faelligkeit', async () => {
    await pruefungAbschliessen()
    await direkt(`update rechnung_fakten set zahlungsart = 'lastschrift' where dokument_id = $1`, [
      beleg,
    ])

    const post = new Merkpost()
    const ergebnis = await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(
        c,
        { ablage: new Merkablage(), post },
        { dokumentId: beleg, benutzerId: ANNA },
      ),
    )

    expect(ergebnis.status).toBe('lastschrift')
    expect(post.eintraege).toHaveLength(0)

    const [zahlung] = await direkt<{ status: string; faellig_am: string | null }>(
      'select status, faellig_am from zahlung where dokument_id = $1',
      [beleg],
    )
    expect(zahlung.status).toBe('lastschrift')
    expect(zahlung.faellig_am).not.toBeNull()
  })

  it('ist kein Zahlungsweg', () => {
    expect(() => wegFuer('lastschrift', { ablage: new Merkablage(), post: null })).toThrow(
      UebergabeNichtMoeglich,
    )
  })
})

describe('Eigenanteil bei Selbstbeteiligung', () => {
  it('legt eine zweite Zahlung an, ohne den Summenzwang zu verletzen', async () => {
    // Konzept 13.1: Der Beleg bleibt einer, die Zahlung wird zweimal
    // ausgeloest. Die Summenpruefung laeuft ueber die Kontierung -- liefe sie
    // ueber die Zahlungszeilen, wuerde dieser Fall sie verletzen.
    await pruefungAbschliessen()
    await direkt('update objekt set zahlungsweg_id = $2 where id = $1', [OBJEKT_42, WEG_EXPORT])
    const ablage = new Merkablage()

    await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(c, { ablage }, { dokumentId: beleg, benutzerId: ANNA, betrag: 890 }),
    )
    await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(c, { ablage }, {
        dokumentId: beleg,
        benutzerId: ANNA,
        art: 'eigenanteil',
        betrag: 300,
      }),
    )

    const zahlungen = await alsBenutzer(ANNA, (c) => zahlungenLaden(c, beleg))
    expect(zahlungen.map((z) => z.art)).toEqual(['voll', 'eigenanteil'])
    expect(zahlungen.reduce((s, z) => s + z.betrag, 0)).toBe(BRUTTO)

    // Und der Summenzwang stimmt weiterhin -- er kennt die Zahlungen nicht.
    const [{ stimmt }] = await direkt<{ stimmt: boolean }>(
      'select app.kontierung_summe_stimmt($1) as stimmt',
      [beleg],
    )
    expect(stimmt).toBe(true)
  })
})

describe('Stempeln an der Zahlungsstufe', () => {
  it('weist den Stempel ab, solange die Sperre greift', async () => {
    await pruefungAbschliessen()
    await direkt('delete from kontierung where dokument_id = $1', [beleg])
    const aufgabe = await zahlungsaufgabe()
    await expect(
      stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG }),
    ).rejects.toBeInstanceOf(StempelAbgelehnt)
  })

  it('haelt die Aufgabe dabei offen', async () => {
    await pruefungAbschliessen()
    await direkt('delete from kontierung where dokument_id = $1', [beleg])
    const aufgabe = await zahlungsaufgabe()
    await expect(
      stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG }),
    ).rejects.toThrow()

    const nachher = await persoenlichesPostfach(ANNA)
    expect(nachher.map((z) => z.aufgabeId)).toContain(aufgabe.aufgabeId)
  })

  it('legt den Auftrag ins Ausgangsbuch, statt am Mailversand zu haengen', async () => {
    /*
     * Das war vorher umgekehrt, und die Umkehrung ist Absicht.
     *
     * Vorher: kein Versand eingerichtet -> Stempel abgelehnt, damit keine
     * Zahlung als uebergeben gilt, die nie jemanden erreicht. Das Argument
     * war, dass der Beleg sonst aus allen Listen verschwindet.
     *
     * Mit dem Ausgangsbuch verschwindet er nicht: Der Eintrag steht dort
     * offen und sichtbar. Dafuer blockiert ein haengender Mailserver keinen
     * Stempel mehr.
     */
    await pruefungAbschliessen()
    const aufgabe = await zahlungsaufgabe()
    await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    const [zahlung] = await direkt<{ status: string }>(
      'select status from zahlung where dokument_id = $1',
      [beleg],
    )
    expect(zahlung.status).toBe('uebergeben')

    const [ausgang] = await direkt<{ status: string; empfaenger: string; anlass: string }>(
      'select status, empfaenger, anlass from ausgang where dokument_id = $1',
      [beleg],
    )
    expect(ausgang.status).toBe('offen')
    expect(ausgang.anlass).toBe('zahlung')
    expect(ausgang.empfaenger).toBe('zahlungen@bank.example.invalid')
  })

  it('sagt in der Ansicht, dass die Mail liegen bleibt', async () => {
    // Kein Hindernis mehr, aber auch nicht verschwiegen: Wer stempelt, soll
    // wissen, dass noch nichts hinausgeht.
    await pruefungAbschliessen()
    const ansicht = await zahlungsansichtLaden(ANNA, beleg)
    expect(ansicht.moeglich).toBe(true)
    expect(ansicht.versandfehlt).toMatch(/Ausgangsbuch/)
  })

  it('maskiert die IBAN in der Ansicht', () => {
    // Die vollstaendige IBAN gehoert nicht auf einen Bildschirm, an dem viele
    // vorbeigehen. Zum Wiedererkennen genuegen vier Stellen.
    expect(ibanMaskieren('DE02120300000000202051')).toBe('…2051')
    expect(ibanMaskieren(null)).toBeNull()
  })

  it('uebergibt und schliesst den Lauf ab, wenn alles stimmt', async () => {
    await pruefungAbschliessen()
    await direkt('update objekt set zahlungsweg_id = $2 where id = $1', [OBJEKT_42, WEG_EXPORT])

    const aufgabe = await zahlungsaufgabe()
    await stempelSetzen(ANNA, { aufgabeId: aufgabe.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    const [zahlung] = await direkt<{ status: string }>(
      'select status from zahlung where dokument_id = $1',
      [beleg],
    )
    expect(zahlung.status).toBe('uebergeben')

    const nachher = await persoenlichesPostfach(ANNA)
    expect(nachher.map((z) => z.aufgabeId)).not.toContain(aufgabe.aufgabeId)
  })
})

describe('Exportzeile', () => {
  const auftrag = {
    dokumentId: 'd1',
    storagePraefix: 'p',
    empfaenger: 'Muster GmbH',
    iban: 'DE00000000000000000000',
    betrag: 1190,
    verwendungszweck: 'RE-1',
    faelligAm: '2026-09-14',
    ziel: null,
    wegname: 'Test',
  }

  it('schreibt den Betrag mit Komma und ohne Tausenderpunkt', () => {
    expect(exportzeile(auftrag)).toContain('"1190,00"')
  })

  it('zerlegt sich nicht an einem Semikolon im Verwendungszweck', () => {
    const zeile = exportzeile({ ...auftrag, verwendungszweck: 'RE-1; Nachtrag' })
    expect(zeile.split(';')).toHaveLength(6)
    expect(zeile).toContain('"RE-1; Nachtrag"')
  })

  it('verdoppelt Anfuehrungszeichen im Namen', () => {
    expect(exportzeile({ ...auftrag, empfaenger: 'Muster "Nord" GmbH' })).toContain(
      '"Muster ""Nord"" GmbH"',
    )
  })
})

describe('Sichtbarkeit', () => {
  it('zeigt einem nicht zustaendigen Kollegen keine Zahlung', async () => {
    await pruefungAbschliessen()
    await direkt('update objekt set zahlungsweg_id = $2 where id = $1', [OBJEKT_42, WEG_EXPORT])
    await alsBenutzer(ANNA, (c) =>
      zahlungUebergeben(c, { ablage: new Merkablage() }, { dokumentId: beleg, benutzerId: ANNA }),
    )

    const clara = await alsBenutzer('20000000-0000-0000-0000-000000000003', (c) =>
      zahlungenLaden(c, beleg),
    )
    expect(clara).toEqual([])
  })
})
