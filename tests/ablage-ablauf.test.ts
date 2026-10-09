/**
 * Jede Ablage hat ihren Ablauf -- und Kundenrechnungen als dritte Ablage
 * (Migration 20261009100000).
 *
 * Zusicherungen, die Entscheidungen des Hauses vom 09.10.2026:
 *   - Der Ablauf haengt an Ablage **und** Belegart. Ohne eigenen Ablauf gilt
 *     der Hausstandard der Belegart.
 *   - Ablage vor Kategorie: Eine Kategorie verfeinert nur innerhalb der
 *     Ablage; ein Ablauf einer fremden Ablage kommt nie in Frage.
 *   - Eine neue Ablage bringt je Belegart einen Entwurf als Kopie des
 *     Hausstandards mit -- bearbeitbar, noch nicht gueltig.
 *   - Beim Ablagewechsel wechselt der Lauf, solange keine Entscheidung
 *     darin liegt.
 *   - Die Ablage begrenzt die Belegart: Was ein Mensch in "Kundenrechnungen"
 *     gelegt hat, macht die Erkennung nicht zur Lieferantenrechnung.
 *   - Kundenrechnung: Kunde ist eine Person, Zahlungseingang ist faellig am
 *     Zahlungsziel, "Gemahnt" ist eine Klaerung, "Bezahlt" schliesst ab.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { ablageWechseln } from '../src/belege/ablage'
import { angabenNachtragen, nachtragNoetig } from '../src/belege/nachtragen'
import { rechnungsdatenLaden } from '../src/belege/rechnungsdaten'
import { ablageAnlegen, ablagenLaden } from '../src/stammdaten/ablagen'
import { ablaufWaehlen, belegartWechseln, laufStarten, stempeln } from '../src/workflow/engine'
import { ablagenablaeufe, entwurfAktivieren, entwurfFuerAblage } from '../src/workflow/konfiguration'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const EVA = '20000000-0000-0000-0000-000000000005' // prozess_konfigurieren
const ADMIN = '20000000-0000-0000-0000-000000000006'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const ABLAGE_LR = '38000000-0000-0000-0000-000000000001'
const ABLAGE_SV = '38000000-0000-0000-0000-000000000002'
const ABLAGE_KR = '38000000-0000-0000-0000-000000000003'
const DEF_RECHNUNG = '65000000-0000-0000-0000-000000000001'
const DEF_KUNDENRECHNUNG = '65000000-0000-0000-0000-000000000005'
const STUFE_KR_SACHLICH = '66000000-0000-0000-0000-000000000041'
const STUFE_KR_FREIGABE = '66000000-0000-0000-0000-000000000042'
const STUFE_KR_VERSENDET = '66000000-0000-0000-0000-000000000043'
const STUFE_KR_ZAHLUNG = '66000000-0000-0000-0000-000000000044'
const STEMPEL_SACHL = '60000000-0000-0000-0000-000000000001'
const STEMPEL_KRFREI = '60000000-0000-0000-0000-000000000010'
const STEMPEL_VERS = '60000000-0000-0000-0000-000000000011'
const STEMPEL_BEZ = '60000000-0000-0000-0000-000000000012'
const PERSON_MEIKE = '85000000-0000-0000-0000-000000000001'

const belege: string[] = []
const definitionen: string[] = []
const ablagen: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

async function beleg(belegart: string, ablageId: string | null = null, gruppe: string | null = GRUPPE_BK): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl, erfasst_von, status,
                             ablage_id, ablage_quelle)
       values ($1, $2, $3, $4, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'gruen', 1, $5, 'laufend',
               $6, case when $6::uuid is null then 'eingang' else 'mensch' end)
       returning id`,
      [MANDANT, OBJEKT_42, belegart, gruppe, ANNA, ablageId],
    )
    const id = rows[0]!.id
    const lauf = await laufStarten(c, id)
    if (lauf === null) throw new Error('kein Lauf')
    return id
  })
  belege.push(id)
  return id
}

async function laufDefinition(dokumentId: string): Promise<string | null> {
  const { rows } = await alsEigentuemer((c) =>
    c.query<{ d: string }>("select definition_id as d from dokument_lauf where dokument_id = $1 and status in ('laufend','klaerung')", [
      dokumentId,
    ]),
  )
  return rows[0]?.d ?? null
}

async function offeneAufgaben(dokumentId: string) {
  const { rows } = await alsEigentuemer((c) =>
    c.query<{ stufe_id: string; lauf_id: string; faellig_am: Date | null; benutzer: string | null; rolle: string | null }>(
      `select a.stufe_id, a.lauf_id, a.faellig_am, a.zugewiesen_benutzer as benutzer, a.zugewiesen_rolle as rolle
         from aufgabe a join dokument_lauf l on l.id = a.lauf_id
        where l.dokument_id = $1 and a.status = 'offen' order by a.erstellt_am`,
      [dokumentId],
    ),
  )
  return rows
}

afterEach(async () => {
  for (const id of belege.splice(0)) await belegEntfernen(id)
  await alsEigentuemer(async (c) => {
    // Das Ereignisprotokoll der Ablaeufe ist append-only; fuer das Aufraeumen
    // wird der Schutz kurz ausgesetzt -- wie bei belegEntfernen.
    await c.query('alter table prozessdefinition_ereignis disable trigger prozessdefinition_ereignis_unveraenderlich')
    try {
      for (const id of definitionen.splice(0)) await c.query('delete from prozessdefinition where id = $1', [id])
      for (const id of ablagen.splice(0)) {
        await c.query('delete from prozessdefinition where ablage_id = $1', [id])
        await c.query('delete from rolle_recht where ablage_id = $1', [id])
        await c.query('delete from ablage where id = $1', [id])
      }
    } finally {
      await c.query('alter table prozessdefinition_ereignis enable trigger prozessdefinition_ereignis_unveraenderlich')
    }
  })
})

afterAll(async () => {
  await poolSchliessen()
})

describe('Welcher Ablauf gilt', () => {
  it('eine Lieferantenrechnung nimmt den Hausstandard, eine Kundenrechnung ihren eigenen', async () => {
    expect(await laufDefinition(await beleg('rechnung'))).toBe(DEF_RECHNUNG)
    expect(await laufDefinition(await beleg('kundenrechnung', ABLAGE_KR))).toBe(DEF_KUNDENRECHNUNG)
  })

  it('ein Ablauf der Ablage schlaegt den Hausstandard -- und die Kategorie', async () => {
    // Eva gibt Lieferantenrechnungen einen eigenen Rechnungsablauf: Kopie des Standards, aktiviert.
    const entwurf = await entwurfFuerAblage(EVA, ABLAGE_LR, 'rechnung')
    definitionen.push(entwurf)
    await entwurfAktivieren(EVA, entwurf)

    const id = await beleg('rechnung', ABLAGE_LR)
    expect(await laufDefinition(id)).toBe(entwurf)
    // In einer anderen Ablage gilt er nicht: Schriftverkehr-Ablage mit Belegart Rechnung -> Standard.
    const fremd = await beleg('rechnung', ABLAGE_SV)
    expect(await laufDefinition(fremd)).toBe(DEF_RECHNUNG)

    // Die Kategorie benennt den Standard ausdruecklich -- die Ablage gewinnt trotzdem.
    // Nur, wer Ablaeufe konfigurieren darf (Trigger) -- Eva.
    await alsBenutzer(EVA, (c) => c.query('update ordnungsgruppe set prozessdefinition_id = $2 where id = $1', [GRUPPE_BK, DEF_RECHNUNG]))
    try {
      const mitKategorie = await beleg('rechnung', ABLAGE_LR, GRUPPE_BK)
      expect(await laufDefinition(mitKategorie)).toBe(entwurf)
    } finally {
      await alsBenutzer(EVA, (c) => c.query('update ordnungsgruppe set prozessdefinition_id = null where id = $1', [GRUPPE_BK]))
    }

    // Die Ablagenseite sagt es: eigener Ablauf fuer Rechnung in Lieferantenrechnungen.
    const liste = await ablagenablaeufe(ADMIN)
    const zeile = liste.find((l) => l.ablageId === ABLAGE_LR && l.belegart === 'rechnung')!
    expect(zeile.eigener?.id).toBe(entwurf)
    expect(zeile.standard?.id).toBe(DEF_RECHNUNG)
  })

  it('eine neue Ablage bringt je Belegart einen Entwurf des Hausstandards mit', async () => {
    await ablageAnlegen(ADMIN, { name: 'Verträge', kurzcode: 'VT', belegarten: 'rechnung,schriftverkehr' })
    const neu = (await ablagenLaden(ADMIN)).find((a) => a.kurzcode === 'VT')!
    ablagen.push(neu.id)
    const { rows } = await alsEigentuemer((c) =>
      c.query<{ belegart: string; status: string }>('select belegart, status from prozessdefinition where ablage_id = $1 order by belegart', [neu.id]),
    )
    expect(rows).toEqual([
      { belegart: 'rechnung', status: 'entwurf' },
      { belegart: 'schriftverkehr', status: 'entwurf' },
    ])
    // Bis zur Aktivierung gilt der Standard.
    const id = await beleg('rechnung', neu.id)
    expect(await laufDefinition(id)).toBe(DEF_RECHNUNG)
  })

  it('ohne das Recht, Ablaeufe zu konfigurieren, entsteht die Ablage trotzdem -- nur ohne Entwurf', async () => {
    // Bernd pflegt Stammdaten, konfiguriert aber keine Ablaeufe.
    await ablageAnlegen(BERND, { name: 'Sonstiges BH', kurzcode: 'SB', belegarten: 'sonstiges' })
    const neu = (await ablagenLaden(BERND)).find((a) => a.kurzcode === 'SB')!
    ablagen.push(neu.id)
    const { rows } = await alsEigentuemer((c) => c.query('select 1 from prozessdefinition where ablage_id = $1', [neu.id]))
    expect(rows).toHaveLength(0)
  })
})

describe('Ablagewechsel und Belegart', () => {
  it('beim Ablagewechsel folgt der Lauf -- solange keine Entscheidung darin liegt', async () => {
    const entwurf = await entwurfFuerAblage(EVA, ABLAGE_SV, 'rechnung')
    definitionen.push(entwurf)
    await entwurfAktivieren(EVA, entwurf)

    const id = await beleg('rechnung', ABLAGE_LR)
    const ergebnis = await ablageWechseln(ANNA, id, ABLAGE_SV, 'Gehört zum Schriftwechsel')
    expect(ergebnis.ablauf).toBe('gewechselt')
    expect(await laufDefinition(id)).toBe(entwurf)

    // Mit Stempel bleibt der begonnene Weg.
    const zweiter = await beleg('rechnung', ABLAGE_LR)
    const [aufgabe] = await offeneAufgaben(zweiter)
    await alsBenutzer(ANNA, (c) =>
      stempeln(c, { laufId: aufgabe!.lauf_id, stufeId: aufgabe!.stufe_id, benutzerId: ANNA, stempeltypId: STEMPEL_SACHL, entscheidung: 'freigabe' }),
    )
    const spaeter = await ablageWechseln(ANNA, zweiter, ABLAGE_SV, 'Doch Schriftwechsel')
    expect(spaeter.ablauf).toBe('entschieden')
    expect(await laufDefinition(zweiter)).toBe(DEF_RECHNUNG)
  })

  it('die Ablage begrenzt die Belegart: Kundenrechnungen werden nicht zur Lieferantenrechnung', async () => {
    const id = await beleg('kundenrechnung', ABLAGE_KR)
    const ausgang = await alsBenutzer(ANNA, (c) => belegartWechseln(c, id, 'rechnung', 'erkannt', 'Rechnungsnummer im Text'))
    expect(ausgang).toBe('unveraendert')
    const { rows } = await alsEigentuemer((c) =>
      c.query<{ belegart: string; grund: string }>('select belegart, belegart_begruendung as grund from dokument where id = $1', [id]),
    )
    expect(rows[0]!.belegart).toBe('kundenrechnung')
    expect(rows[0]!.grund).toMatch(/kennt diese Belegart nicht/)
    // Ein Mensch darf trotzdem.
    expect(await alsBenutzer(ANNA, (c) => belegartWechseln(c, id, 'rechnung', 'mensch', 'Doch eine Eingangsrechnung'))).toBe('gewechselt')
    expect(await laufDefinition(id)).toBe(DEF_RECHNUNG)
  })

  it('ablaufWaehlen ist die eine Stelle -- mit Vorgabe fuer eine andere Belegart und Ablage', async () => {
    const id = await beleg('rechnung')
    const def = await alsBenutzer(ANNA, (c) => ablaufWaehlen(c, id, { belegart: 'kundenrechnung', ablageId: ABLAGE_KR }))
    expect(def?.id).toBe(DEF_KUNDENRECHNUNG)
  })
})

describe('Kundenrechnung', () => {
  it('Kunde ist eine Person; ohne Kunden ist die Rechnung nachzutragen', async () => {
    const id = await beleg('kundenrechnung', ABLAGE_KR)
    expect(nachtragNoetig({ objektnummer: '42', kreditor: null, kunde: null, belegart: 'kundenrechnung' })).toBe(true)
    await angabenNachtragen(ANNA, id, { kundePersonId: PERSON_MEIKE, rechnungsnummer: 'KR-2026-001', brutto: 250 })
    const daten = await rechnungsdatenLaden(ANNA, id)
    const kunde = daten?.zeilen.find((z) => z.feld === 'kreditor_name')
    expect(kunde?.label).toBe('Kunde (Rechnungsempfänger)')
    expect(kunde?.wert).toBe('Meike Meier')
    expect(daten?.zeilen.some((z) => z.feld === 'kreditor_ust_id')).toBe(false)
    // Keine Kreditorbefunde an einer Kundenrechnung.
    const { rows } = await alsEigentuemer((c) => c.query<{ pruefung: string }>('select pruefung from plausibilitaet_befund where dokument_id = $1', [id]))
    expect(rows.map((r) => r.pruefung)).not.toContain('kreditor_unbekannt')
    expect(rows.map((r) => r.pruefung)).not.toContain('pflichtangaben_ust')
    await expect(angabenNachtragen(ANNA, id, { kundePersonId: '00000000-0000-0000-0000-000000000001' })).rejects.toThrow(/Kunden gibt es nicht/)
  })

  it('laeuft Pruefung → Versandfreigabe → Versendet → Zahlungseingang, faellig am Zahlungsziel', async () => {
    const id = await beleg('kundenrechnung', ABLAGE_KR)
    const stempelAn = async (stufe: string, wer: string, stempel: string) => {
      const aufgabe = (await offeneAufgaben(id)).find((a) => a.stufe_id === stufe)
      expect(aufgabe, `Aufgabe an ${stufe}`).toBeDefined()
      await alsBenutzer(wer, (c) =>
        stempeln(c, { laufId: aufgabe!.lauf_id, stufeId: stufe, benutzerId: wer, stempeltypId: stempel, entscheidung: 'freigabe' }),
      )
    }
    await stempelAn(STUFE_KR_SACHLICH, ANNA, STEMPEL_SACHL)
    await stempelAn(STUFE_KR_FREIGABE, BERND, STEMPEL_KRFREI)
    // Das Zahlungsziel steht fest, bevor die Zahlungsstufe entsteht: Die
    // Aufgabe wird gleich darauf faellig angelegt (aufgabenAnlegen).
    await angabenNachtragen(BERND, id, { zahlungsziel: '2026-12-31', kundePersonId: PERSON_MEIKE })
    await stempelAn(STUFE_KR_VERSENDET, BERND, STEMPEL_VERS)

    const [zahlung] = await offeneAufgaben(id)
    expect(zahlung!.stufe_id).toBe(STUFE_KR_ZAHLUNG)
    expect(zahlung!.rolle).toBe('90000000-0000-0000-0000-000000000002')
    expect(zahlung!.faellig_am?.toISOString().slice(0, 10)).toBe('2026-12-31')

    // Ein spaeter geaendertes Zahlungsziel zieht die Faelligkeit nach (Trigger).
    await angabenNachtragen(BERND, id, { zahlungsziel: '2027-01-15' })
    const [nachher] = await offeneAufgaben(id)
    expect(nachher!.faellig_am?.toISOString().slice(0, 10)).toBe('2027-01-15')

    await stempelAn(STUFE_KR_ZAHLUNG, BERND, STEMPEL_BEZ)
    const { rows } = await alsEigentuemer((c) => c.query<{ status: string }>('select status from dokument_lauf where dokument_id = $1', [id]))
    expect(rows[0]!.status).not.toBe('laufend')
  })
})
