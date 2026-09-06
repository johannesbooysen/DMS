/**
 * Tests der Kontierung.
 *
 * Zwei Regeln stehen im Mittelpunkt, beide aus Konzept 6:
 *
 *   * Der **Summenzwang** blockiert die Kontierungsstufe. Nicht die Ampel —
 *     die Stufe. Ein halb kontierter Beleg darf nicht weiter, und genau das
 *     wird hier über `stempelSetzen` geprüft, nicht nur über die Rechenlogik.
 *   * Ein Konto **außerhalb des Kontenrahmens** des Objekts wird abgewiesen.
 *     Der Fall ist nicht theoretisch: Die Konten gehören dem Mandanten, nur
 *     der Rahmen gehört dem Objekt.
 *
 * Wie im Postfachtest kann hier nicht zurückgerollt werden — die geprüften
 * Funktionen führen eigene Transaktionen. Jeder Test legt seinen eigenen
 * Beleg an und räumt ihn weg.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { VERWALTER } from './hilfe/kennungen'
import { alsBenutzer, poolSchliessen } from '../src/db'
import {
  KontierungAbgelehnt,
  kontenFuerBeleg,
  kontierungLaden,
  kontierungPruefen,
  restVerteilen,
  umlagefaehigkeitAendern,
  zeileEntfernen,
  zeileHinzufuegen,
} from '../src/kontierung/kontierung'
import {
  klaerungsPostfach,
  persoenlichesPostfach,
  StempelAbgelehnt,
  stempelSetzen,
} from '../src/app/lib/postfach'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const CLARA = '20000000-0000-0000-0000-000000000003'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const KONTO_HAUSREINIGUNG = '37000000-0000-0000-0000-000000000001'
const KONTO_VERWALTUNG = '37000000-0000-0000-0000-000000000002'
const UMLAGESCHLUESSEL_MEA = '36000000-0000-0000-0000-000000000001'
const SACHLICH_RICHTIG = '60000000-0000-0000-0000-000000000001'
const ZUR_KLAERUNG = '60000000-0000-0000-0000-000000000002'

/* Eigener Ablauf mit genau einer Kontierungsstufe. Der Seed-Ablauf hat
 * keine -- er beschreibt die Prüfkette, nicht die Buchhaltung. */
const GRUPPE = '40000000-0000-0000-0000-0000000000c0'
const DEFINITION = '65000000-0000-0000-0000-0000000000c0'
const STUFE = '66000000-0000-0000-0000-0000000000c0'
const WURZEL = '67000000-0000-0000-0000-0000000000c0'
const BLATT = '67000000-0000-0000-0000-0000000000c1'

/* Ein Konto des eigenen Mandanten in einem fremden Kontenrahmen. */
const FREMDER_RAHMEN = '35000000-0000-0000-0000-0000000000c0'
const FREMDES_KONTO = '37000000-0000-0000-0000-0000000000c0'

const BRUTTO = 1190

let beleg = ''

beforeAll(async () => {
  // Stammdaten unter jemandem, der sie pflegen darf (20260903100000).
  await alsBenutzer(VERWALTER, async (c) => {
    await c.query(
      `insert into ordnungsgruppe (id, mandant_id, name, kurzcode, sortierung)
       values ($1, $2, 'Kontierungstest', 'KTT', 900)
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
       values ($1, $2, 1, 'kontierung', 'Kontierung', 'objektverantwortlich', 48)
       on conflict (id) do nothing`,
      [STUFE, DEFINITION],
    )
    await c.query(
      `insert into prozessknoten (id, definition_id, eltern_id, reihenfolge,
                                  knotentyp, stufe_id)
       values ($1, $2, null, 0, 'nacheinander', null),
              ($3, $2, $1, 0, 'stufe', $4)
       on conflict (id) do nothing`,
      [WURZEL, DEFINITION, BLATT, STUFE],
    )
    await c.query(
      `insert into prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung)
       values ($1, $2, 0), ($1, $3, 1)
       on conflict do nothing`,
      [STUFE, SACHLICH_RICHTIG, ZUR_KLAERUNG],
    )

    // Zweiter Kontenrahmen, damit "fremdes Konto" ein echtes Konto ist und
    // nicht bloss eine erfundene Kennung.
    await c.query(
      `insert into kontenrahmen (id, mandant_id, name)
       values ($1, $2, 'Kontenrahmen Miethaus (Testdaten)')
       on conflict (id) do nothing`,
      [FREMDER_RAHMEN, MANDANT],
    )
    await c.query(
      `insert into konto (id, kontenrahmen_id, kontonummer, bezeichnung)
       values ($1, $2, '4200', 'Hausreinigung (anderer Rahmen)')
       on conflict (id) do nothing`,
      [FREMDES_KONTO, FREMDER_RAHMEN],
    )
  })
})

afterAll(async () => {
  // Der Ablauf wird abgeloest, nicht geloescht -- Prozessdefinitionen werden
  // versioniert, nie ueberschrieben (Konzept 8). Abgeloest waehlt
  // `laufStarten` nicht mehr aus, damit stoert er die uebrigen Tests nicht.
  await alsBenutzer(ANNA, async (c) => {
    await c.query(`update prozessdefinition set status = 'abgeloest' where id = $1`, [
      DEFINITION,
    ])
    await c.query('update ordnungsgruppe set aktiv = false where id = $1', [GRUPPE])
  })
  await poolSchliessen()
})

beforeEach(async () => {
  beleg = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, GRUPPE],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-KONTIERUNG', current_date, 1000, 190, $3)`,
      [id, KREDITOR, BRUTTO],
    )
    await laufStarten(c, id)
    return id
  })
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

/** Kurzform: eine Zeile als Anna anlegen. */
async function zeile(kontoId: string, brutto: number, steuersatz = 19): Promise<string> {
  return alsBenutzer(ANNA, (c) =>
    zeileHinzufuegen(c, beleg, { kontoId, betragBrutto: brutto, steuersatz }),
  )
}

async function stand() {
  return alsBenutzer(ANNA, (c) => kontierungLaden(c, beleg))
}

describe('Kontierungsstand', () => {
  it('weist den vollen Rechnungsbetrag als offen aus, solange nichts kontiert ist', async () => {
    const s = await stand()
    expect(s.zeilen).toEqual([])
    expect(s.rechnungsbetrag).toBe(BRUTTO)
    expect(s.offen).toBe(BRUTTO)
    expect(s.stimmt).toBe(false)
  })

  it('rechnet netto aus brutto und Steuersatz', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const s = await stand()
    expect(s.zeilen[0].betragNetto).toBe(1000)
    expect(s.zeilen[0].betragBrutto).toBe(1190)
  })

  it('stimmt, sobald die Zeilen den Rechnungsbetrag ergeben', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const s = await stand()
    expect(s.summe).toBe(BRUTTO)
    expect(s.offen).toBe(0)
    expect(s.stimmt).toBe(true)
  })

  it('stimmt auch bei einem Split ueber mehrere Konten', async () => {
    await zeile(KONTO_HAUSREINIGUNG, 690)
    await zeile(KONTO_VERWALTUNG, 500)
    const s = await stand()
    expect(s.zeilen.map((z) => z.zeileNr)).toEqual([1, 2])
    expect(s.stimmt).toBe(true)
  })

  it('meldet eine Ueberverteilung als negativen Rest', async () => {
    await zeile(KONTO_HAUSREINIGUNG, 1200)
    const s = await stand()
    expect(s.offen).toBe(-10)
    expect(s.stimmt).toBe(false)
  })
})

describe('Vorschlaege aus dem Konto', () => {
  it('uebernimmt Umlagefaehigkeit und Umlageschluessel des Kontos', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const s = await stand()
    expect(s.zeilen[0].umlagefaehig).toBe(true)
    expect(s.zeilen[0].umlageschluesselId).toBe(UMLAGESCHLUESSEL_MEA)
  })

  it('uebernimmt auch ein nicht umlagefaehiges Konto richtig', async () => {
    await zeile(KONTO_VERWALTUNG, BRUTTO)
    const s = await stand()
    expect(s.zeilen[0].umlagefaehig).toBe(false)
    expect(s.zeilen[0].umlageschluesselId).toBeNull()
  })

  it('laesst einen ausdruecklich gewaehlten Umlageschluessel gewinnen', async () => {
    // Der Vorschlag des Kontos ist ein Vorschlag. Bei einem Konto ohne
    // Vorschlag ist die ausdrueckliche Wahl sogar die einzige Quelle --
    // sonst bliebe die Zeile umlagefaehig, aber unverteilbar.
    await alsBenutzer(ANNA, (c) =>
      zeileHinzufuegen(c, beleg, {
        kontoId: KONTO_VERWALTUNG,
        betragBrutto: BRUTTO,
        steuersatz: 19,
        umlagefaehig: true,
        umlageschluesselId: UMLAGESCHLUESSEL_MEA,
      }),
    )
    const s = await stand()
    expect(s.zeilen[0].umlagefaehig).toBe(true)
    expect(s.zeilen[0].umlageschluesselId).toBe(UMLAGESCHLUESSEL_MEA)
  })

  it('reicht den Umlageschluessel auch beim Rest durch', async () => {
    await alsBenutzer(ANNA, (c) =>
      restVerteilen(c, beleg, KONTO_VERWALTUNG, 19, UMLAGESCHLUESSEL_MEA),
    )
    expect((await stand()).zeilen[0].umlageschluesselId).toBe(UMLAGESCHLUESSEL_MEA)
  })

  it('laesst die Umlagefaehigkeit je Zeile ueberschreiben', async () => {
    const id = await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    await alsBenutzer(ANNA, (c) => umlagefaehigkeitAendern(c, beleg, id, false))
    const s = await stand()
    expect(s.zeilen[0].umlagefaehig).toBe(false)
  })

  it('pflegt dabei das denormalisierte Flag am Dokument mit', async () => {
    const id = await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const vorher = await flagAmDokument()
    await alsBenutzer(ANNA, (c) => umlagefaehigkeitAendern(c, beleg, id, false))
    const nachher = await flagAmDokument()
    expect([vorher, nachher]).toEqual([true, false])
  })
})

async function flagAmDokument(): Promise<boolean> {
  return alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ hat_umlagefaehige_zeile: boolean }>(
      'select hat_umlagefaehige_zeile from dokument where id = $1',
      [beleg],
    )
    return rows[0].hat_umlagefaehige_zeile
  })
}

describe('Kontenrahmen', () => {
  it('bietet nur Konten des Rahmens an, der am Objekt haengt', async () => {
    const konten = await alsBenutzer(ANNA, (c) => kontenFuerBeleg(c, beleg))
    const ids = konten.map((k) => k.id)
    expect(ids).toContain(KONTO_HAUSREINIGUNG)
    expect(ids).toContain(KONTO_VERWALTUNG)
    expect(ids).not.toContain(FREMDES_KONTO)
  })

  it('weist ein Konto aus einem fremden Rahmen ab', async () => {
    await expect(zeile(FREMDES_KONTO, BRUTTO)).rejects.toBeInstanceOf(KontierungAbgelehnt)
  })

  it('weist einen Betrag von null ab', async () => {
    await expect(zeile(KONTO_HAUSREINIGUNG, 0)).rejects.toBeInstanceOf(KontierungAbgelehnt)
  })
})

describe('Rest uebernehmen', () => {
  it('legt genau den offenen Betrag an', async () => {
    await zeile(KONTO_HAUSREINIGUNG, 690)
    await alsBenutzer(ANNA, (c) => restVerteilen(c, beleg, KONTO_VERWALTUNG, 19))
    const s = await stand()
    expect(s.zeilen[1].betragBrutto).toBe(500)
    expect(s.stimmt).toBe(true)
  })

  it('tut nichts, wenn nichts offen ist', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const ergebnis = await alsBenutzer(ANNA, (c) =>
      restVerteilen(c, beleg, KONTO_VERWALTUNG, 19),
    )
    expect(ergebnis).toBeNull()
    expect((await stand()).zeilen).toHaveLength(1)
  })

  it('verweigert die Arbeit ohne Rechnungsbetrag am Beleg', async () => {
    await alsBenutzer(ANNA, (c) =>
      c.query('delete from rechnung_fakten where dokument_id = $1', [beleg]),
    )
    await expect(
      alsBenutzer(ANNA, (c) => restVerteilen(c, beleg, KONTO_HAUSREINIGUNG, 19)),
    ).rejects.toBeInstanceOf(KontierungAbgelehnt)
  })
})

describe('Summenzwang blockiert die Stufe', () => {
  /** Die offene Kontierungsaufgabe des Testbelegs. */
  async function aufgabe() {
    const zeilen = await persoenlichesPostfach(ANNA)
    const gefunden = zeilen.find((z) => z.dokumentId === beleg)
    if (gefunden === undefined) throw new Error('Kontierungsaufgabe nicht im Postfach')
    return gefunden
  }

  it('stellt die Aufgabe als Kontierungsstufe zu', async () => {
    const a = await aufgabe()
    expect(a.stufentyp).toBe('kontierung')
  })

  it('laesst den Beleg ohne jede Zeile nicht weiter', async () => {
    const a = await aufgabe()
    await expect(
      stempelSetzen(ANNA, { aufgabeId: a.aufgabeId, stempeltypId: SACHLICH_RICHTIG }),
    ).rejects.toBeInstanceOf(StempelAbgelehnt)
  })

  it('laesst ihn bei unvollstaendiger Kontierung nicht weiter', async () => {
    await zeile(KONTO_HAUSREINIGUNG, 690)
    const a = await aufgabe()
    await expect(
      stempelSetzen(ANNA, { aufgabeId: a.aufgabeId, stempeltypId: SACHLICH_RICHTIG }),
    ).rejects.toThrow(/1190/)
  })

  it('laesst ihn durch, sobald die Summe stimmt', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const a = await aufgabe()
    await stempelSetzen(ANNA, { aufgabeId: a.aufgabeId, stempeltypId: SACHLICH_RICHTIG })

    const nachher = await persoenlichesPostfach(ANNA)
    expect(nachher.map((z) => z.aufgabeId)).not.toContain(a.aufgabeId)
  })

  it('laesst die Klaerung trotz offener Summe zu -- sie ist keine Freigabe', async () => {
    // Wer nicht kontieren kann, weil etwas unklar ist, muss den Beleg
    // abgeben koennen. Der Summenzwang darf ihn nicht einsperren.
    const a = await aufgabe()
    await stempelSetzen(ANNA, {
      aufgabeId: a.aufgabeId,
      stempeltypId: ZUR_KLAERUNG,
      kommentar: 'Rechnungsposten 3 ist unklar',
      wiedervorlageAm: '2026-12-01',
    })

    const eintraege = await klaerungsPostfach(ANNA)
    expect(eintraege.map((k) => k.dokumentId)).toContain(beleg)

    // Die Aufgabe bleibt offen und die Stufe gemerkt: Bestehende Stempel
    // behalten ihre Gueltigkeit (Konzept 8.5).
    const nachher = await persoenlichesPostfach(ANNA)
    expect(nachher.map((z) => z.aufgabeId)).toContain(a.aufgabeId)
  })
})

describe('Pruefmeldung', () => {
  it('nennt den unkontierten Beleg beim Namen', async () => {
    const meldung = await alsBenutzer(ANNA, (c) => kontierungPruefen(c, beleg))
    expect(meldung).toMatch(/nicht kontiert/)
  })

  it('nennt bei Abweichung beide Betraege', async () => {
    await zeile(KONTO_HAUSREINIGUNG, 690)
    const meldung = await alsBenutzer(ANNA, (c) => kontierungPruefen(c, beleg))
    expect(meldung).toMatch(/690/)
    expect(meldung).toMatch(/1190/)
  })

  it('schweigt, wenn alles stimmt', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    expect(await alsBenutzer(ANNA, (c) => kontierungPruefen(c, beleg))).toBeNull()
  })
})

describe('Paragraf 35a', () => {
  it('nimmt die Handwerkerangaben beim Entfernen der Zeile mit', async () => {
    // Sonst bliebe die steuerliche Aufteilung ohne Beleg zurueck -- eine
    // Zeile, die es nicht mehr gibt, darf keine Lohnanteile behalten.
    const id = await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const uebrig = await alsBenutzer(ANNA, async (c) => {
      await c.query(
        `insert into kontierung_35a (kontierung_id, art, lohnanteil,
                                     materialanteil, unbar_gezahlt)
         values ($1, 'handwerkerleistung', 800.00, 390.00, true)`,
        [id],
      )
      await zeileEntfernen(c, beleg, id)
      const { rows } = await c.query('select 1 from kontierung_35a where kontierung_id = $1', [
        id,
      ])
      return rows.length
    })
    expect(uebrig).toBe(0)
  })
})

describe('Mandanten- und Objektgrenze', () => {
  /*
   * Nicht Bernd: Er traegt die Buchhaltungsrolle mandantenweit und darf
   * Objekt 42 zu Recht sehen -- die Rolle traegt das Recht `ansehen`, und
   * `app.meine_objekte()` wertet sie aus. Clara ist die richtige Gegenprobe:
   * gleicher Mandant, keine Objektzustaendigkeit, keine ansehende Rolle.
   * Doris ist der zweite Mandant.
   */
  async function sichtVon(benutzerId: string) {
    return alsBenutzer(benutzerId, async (c) => ({
      stand: await kontierungLaden(c, beleg),
      konten: await kontenFuerBeleg(c, beleg),
    }))
  }

  it('zeigt einem nicht zustaendigen Kollegen weder Zeilen noch Konten', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const fremd = await sichtVon(CLARA)

    expect(fremd.stand.zeilen).toEqual([])
    expect(fremd.stand.rechnungsbetrag).toBeNull()
    expect(fremd.konten).toEqual([])
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    const fremd = await sichtVon(DORIS)

    expect(fremd.stand.zeilen).toEqual([])
    expect(fremd.stand.rechnungsbetrag).toBeNull()
    expect(fremd.konten).toEqual([])
  })

  it('laesst beide auch keine Zeile anlegen', async () => {
    for (const wer of [CLARA, DORIS]) {
      await expect(
        alsBenutzer(wer, (c) =>
          zeileHinzufuegen(c, beleg, {
            kontoId: KONTO_HAUSREINIGUNG,
            betragBrutto: BRUTTO,
            steuersatz: 19,
          }),
        ),
      ).rejects.toBeInstanceOf(KontierungAbgelehnt)
    }
  })

  it('haelt den Beleg auch vor dem Loeschen einer fremden Zeile geschuetzt', async () => {
    const id = await zeile(KONTO_HAUSREINIGUNG, BRUTTO)
    await alsBenutzer(CLARA, (c) => zeileEntfernen(c, beleg, id))
    expect((await stand()).zeilen).toHaveLength(1)
  })
})
