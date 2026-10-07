/**
 * Schriftverkehr: Wer bekommt ein Schreiben, und wann erfaehrt die
 * Geschaeftsleitung davon? (Migration 20261006170000)
 *
 * Zusicherungen -- die Antworten des Hauses vom 06.10.2026:
 *   - Empfaenger in der Rangfolge Person im Schreiben > Absenderregel >
 *     Spezialgebiet > Objektverantwortliche; die Stufe "ermittelt" nimmt
 *     genau das.
 *   - Ein Signalwort setzt Thema und Wichtig-Marke -- nie ueber ein von
 *     Hand gesetztes Thema. Ein Thema mit GL-Information macht wichtig.
 *   - Ein wichtiges Schreiben bekommt die parallele Kenntnisstufe der GL;
 *     ein gewoehnliches nicht. Der Lauf wird dafuer neu aufgesetzt --
 *     solange keine Entscheidung darin liegt.
 *   - Die Eskalation geht an eine Rolle (GL), nicht nur an eine Person.
 *   - Regeln pflegt, wer Stammdaten pflegt; ein fremder Mandant sieht keine.
 *   - Alles begruendet: Der Belegweg sagt, welche Regel griff.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { zuordnungErklaeren } from '../src/belege/erklaerung'
import { angabenNachtragen } from '../src/belege/nachtragen'
import { schriftverkehrVerteilen } from '../src/schriftverkehr/verteilung'
import { NichtErlaubt, NichtMoeglich } from '../src/stammdaten'
import { kuerzelSetzen, regelAnlegen, regelnLaden } from '../src/stammdaten/schriftverkehr-regeln'
import { laufStarten, stempeln } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001' // Objektverantwortliche 42, Kuerzel AA
const BERND = '20000000-0000-0000-0000-000000000002' // Buchhaltung, Kuerzel BB
const CLARA = '20000000-0000-0000-0000-000000000003' // Spezialgebiet Versicherung
const DORIS = '20000000-0000-0000-0000-000000000004' // anderer Mandant
const EVA = '20000000-0000-0000-0000-000000000005' // Geschaeftsleitung
const ADMIN = '20000000-0000-0000-0000-000000000006'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const ROLLE_GL = '90000000-0000-0000-0000-000000000003'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const GRUPPE_VS = '40000000-0000-0000-0000-000000000002'
const GRUPPE_RS = '40000000-0000-0000-0000-000000000009'
const STUFE_KENNTNIS = '66000000-0000-0000-0000-000000000011'
const STUFE_KENNTNIS_WICHTIG = '66000000-0000-0000-0000-000000000013'
const STUFE_KENNTNIS_GL = '66000000-0000-0000-0000-000000000014'
const STEMPEL_KENN = '60000000-0000-0000-0000-000000000008'

const belege: string[] = []
const regeln: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

/** Ein Schriftstueck mit Text, so wie es nach der Aufbereitung dasteht -- mit Lauf. */
async function schreiben(text: string, optionen: { objekt?: string | null; gruppe?: string | null; korrespondent?: string | null } = {}) {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl, erfasst_von, status)
       values ($1, $2, 'schriftverkehr', $3, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'gruen', 1, $4, 'laufend')
       returning id`,
      [MANDANT, optionen.objekt === undefined ? OBJEKT_42 : optionen.objekt, optionen.gruppe ?? null, ANNA],
    )
    const id = rows[0]!.id
    await c.query(
      `insert into dokument_seite (dokument_id, seite, text, breite, hoehe, freie_bloecke, textkaesten)
       values ($1, 1, $2, 595, 842, '[]'::jsonb, '[]'::jsonb)`,
      [id, text],
    )
    if (optionen.korrespondent !== undefined) {
      await c.query(
        `insert into schriftverkehr_fakten (dokument_id, richtung, korrespondent) values ($1, 'eingehend', $2)`,
        [id, optionen.korrespondent],
      )
    }
    const lauf = await laufStarten(c, id)
    if (lauf === null) throw new Error('kein Lauf')
    return id
  })
  belege.push(id)
  return id
}

interface Aufgabe {
  stufe_id: string
  status: string
  benutzer: string | null
  rolle: string | null
  gruppe: string | null
}
async function aufgaben(dokumentId: string): Promise<Aufgabe[]> {
  return alsEigentuemer(async (c) => {
    const { rows } = await c.query<Aufgabe>(
      `select a.stufe_id, a.status, a.zugewiesen_benutzer as benutzer, a.zugewiesen_rolle as rolle, a.zugewiesen_gruppe as gruppe
         from aufgabe a join dokument_lauf l on l.id = a.lauf_id
        where l.dokument_id = $1 order by a.erstellt_am, a.stufe_id`,
      [dokumentId],
    )
    return rows
  })
}
const offene = (liste: Aufgabe[]) => liste.filter((a) => a.status === 'offen')

/** Verteilen wie der Worker: Regeln anwenden, Lauf neu aufsetzen. */
async function verteilen(dokumentId: string) {
  return alsBenutzer(ANNA, async (c) => {
    const { laufNeuAufsetzen } = await import('../src/workflow/engine')
    const v = await schriftverkehrVerteilen(c, dokumentId)
    if (v.geaendert) await laufNeuAufsetzen(c, dokumentId)
    return v
  })
}

afterEach(async () => {
  for (const id of belege.splice(0)) await belegEntfernen(id)
  await alsEigentuemer(async (c) => {
    for (const id of regeln.splice(0)) await c.query('delete from schriftverkehr_regel where id = $1', [id])
    await c.query("update benutzer set kuerzel = 'AA' where id = $1", [ANNA])
  })
})

afterAll(async () => {
  await poolSchliessen()
})

describe('Empfaenger eines Schreibens', () => {
  it('ohne Treffer: der Objektverantwortliche, eine Kenntnisstufe, kein GL-Zweig', async () => {
    const id = await schreiben('Sehr geehrte Damen und Herren, anbei die Unterlagen zur Hausordnung.')
    const v = await verteilen(id)
    expect(v.wichtig).toBe(false)
    expect(v.empfaenger.benutzerId).toBeNull()
    const o = offene(await aufgaben(id))
    expect(o.map((a) => a.stufe_id)).toEqual([STUFE_KENNTNIS])
    expect(o[0]!.benutzer).toBe(ANNA)
  })

  it('eine im Schreiben genannte Person schlaegt alles -- per Name', async () => {
    const id = await schreiben('An die Hausverwaltung Nord, z. Hd. Herrn Bernd Bruns. Betreff: Rueckfrage zur Abrechnung.')
    const v = await verteilen(id)
    expect(v.empfaenger.benutzerId).toBe(BERND)
    expect(v.empfaenger.begruendung).toMatch(/Bernd Bruns ist im Schreiben genannt/)
    expect(offene(await aufgaben(id))[0]!.benutzer).toBe(BERND)
  })

  it('… und per Kuerzel, als ganzes Wort', async () => {
    const id = await schreiben('z. Hd. BB -- Rueckfrage zur Abrechnung.')
    expect((await verteilen(id)).empfaenger.benutzerId).toBe(BERND)
    // "BBQ" ist kein Kuerzel.
    const keins = await schreiben('Einladung zum BBQ im Innenhof.')
    expect((await verteilen(keins)).empfaenger.benutzerId).toBeNull()
  })

  it('eine Absenderregel gibt das Schreiben einer Person -- Person im Schreiben geht vor', async () => {
    // Seed: Absender "Amtsgericht" -> Eva, Rechtssache, wichtig.
    const id = await schreiben('Beschluss in der Sache 12 C 345/26.', { korrespondent: 'Amtsgericht Musterstadt' })
    const v = await verteilen(id)
    expect(v.empfaenger.benutzerId).toBe(EVA)
    expect(v.wichtig).toBe(true)

    const genannt = await schreiben('Beschluss in der Sache 12 C 345/26. Sachbearbeiterin: Anna Ahrens.', {
      korrespondent: 'Amtsgericht Musterstadt',
    })
    expect((await verteilen(genannt)).empfaenger.benutzerId).toBe(ANNA)
  })

  it('ohne Korrespondent trifft die Absenderregel den Kopf der ersten Seite', async () => {
    const id = await schreiben('Amtsgericht Musterstadt\nMusterstrasse 1\n\nBeschluss …')
    expect((await verteilen(id)).empfaenger.benutzerId).toBe(EVA)
  })

  it('das Thema fuehrt zum Spezialisten, wenn niemand genannt ist (Stufe ermittelt)', async () => {
    // Versicherungsschaeden -> Spezialgebiet Versicherung -> Clara.
    const id = await schreiben('Schadensmeldung Leitungswasser, Schadennummer 4711.', { gruppe: GRUPPE_VS })
    await verteilen(id)
    expect(offene(await aufgaben(id))[0]!.benutzer).toBe(CLARA)
  })
})

describe('Wichtig und die Geschaeftsleitung', () => {
  it('ein Signalwort setzt Thema und Wichtig-Marke und oeffnet den GL-Zweig', async () => {
    const id = await schreiben('Hiermit erheben wir Klage gegen die WEG Lindenweg 3 wegen …')
    const v = await verteilen(id)
    expect(v.wichtig).toBe(true)
    expect(v.wichtigBegruendung).toMatch(/Klage/)
    expect(v.ordnungsgruppeId).toBe(GRUPPE_RS)

    const o = offene(await aufgaben(id))
    expect(o.map((a) => a.stufe_id).sort()).toEqual([STUFE_KENNTNIS_WICHTIG, STUFE_KENNTNIS_GL].sort())
    expect(o.find((a) => a.stufe_id === STUFE_KENNTNIS_WICHTIG)!.benutzer).toBe(ANNA)
    expect(o.find((a) => a.stufe_id === STUFE_KENNTNIS_GL)!.rolle).toBe(ROLLE_GL)
    // Die gewoehnliche Kenntnisstufe ist entfallen, nicht geloescht.
    expect((await aufgaben(id)).find((a) => a.stufe_id === STUFE_KENNTNIS)!.status).toBe('entfallen')

    // Eva sieht die GL-Aufgabe in ihrem Rollenpostfach -- und der Belegweg sagt warum.
    const erklaerung = await zuordnungErklaeren(ADMIN, id)
    expect(erklaerung?.wichtig?.warum).toMatch(/Klage/)
    expect(erklaerung?.kategorie?.was).toBe('Rechtssache')
  })

  it('"Klagenfurt" ist keine Klage -- ganzes Wort', async () => {
    const id = await schreiben('Unser Buero in Klagenfurt uebernimmt die Betreuung.')
    expect((await verteilen(id)).wichtig).toBe(false)
  })

  it('ein Thema mit GL-Information macht wichtig, auch ohne Signalwort', async () => {
    const id = await schreiben('Anhoerung nach Paragraf 28 VwVfG.', { gruppe: GRUPPE_RS })
    const v = await verteilen(id)
    expect(v.wichtig).toBe(true)
    expect(v.wichtigBegruendung).toMatch(/Rechtssache/)
    expect(offene(await aufgaben(id)).some((a) => a.stufe_id === STUFE_KENNTNIS_GL)).toBe(true)
  })

  it('ein Signalwort stellt ein von Hand gesetztes Thema nicht um', async () => {
    const id = await schreiben('Kündigung des Wartungsvertrags Aufzug zum Jahresende.', { gruppe: GRUPPE_BK })
    await alsEigentuemer((c) => c.query("update dokument set kategorie_quelle = 'mensch' where id = $1", [id]))
    const v = await verteilen(id)
    expect(v.ordnungsgruppeId).toBeNull()
    expect(v.wichtig).toBe(true) // die Marke schon -- das Wort steht da
    const { rows } = await alsEigentuemer((c) => c.query<{ g: string }>('select ordnungsgruppe_id as g from dokument where id = $1', [id]))
    expect(rows[0]!.g).toBe(GRUPPE_BK)
  })

  it('nach einer Entscheidung wird der Lauf nicht mehr neu aufgesetzt', async () => {
    const id = await schreiben('Rueckfrage zur Hausordnung.')
    await verteilen(id)
    const [kenntnis] = offene(await aufgaben(id))
    await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ lauf_id: string }>('select lauf_id from aufgabe where stufe_id = $1 and status = $2 and lauf_id in (select id from dokument_lauf where dokument_id = $3)', [
        kenntnis!.stufe_id,
        'offen',
        id,
      ])
      await stempeln(c, { laufId: rows[0]!.lauf_id, stufeId: kenntnis!.stufe_id, benutzerId: ANNA, stempeltypId: STEMPEL_KENN, entscheidung: 'freigabe' })
    })
    // Jetzt wird das Schreiben wichtig -- aber die Kenntnisnahme ist entschieden.
    await alsEigentuemer((c) => c.query("update dokument_seite set text = 'Klage eingereicht.' where dokument_id = $1", [id]))
    const v = await verteilen(id)
    expect(v.wichtig).toBe(true)
    expect((await aufgaben(id)).some((a) => a.stufe_id === STUFE_KENNTNIS_GL)).toBe(false)
  })

  it('Angaben nachtragen verteilt sofort -- ein Mensch setzt das Thema Rechtssache', async () => {
    const id = await schreiben('Schreiben ohne Zuordnung.', { objekt: null })
    await angabenNachtragen(ANNA, id, { objektId: OBJEKT_42, ordnungsgruppeId: GRUPPE_RS })
    const o = offene(await aufgaben(id))
    expect(o.some((a) => a.stufe_id === STUFE_KENNTNIS_GL && a.rolle === ROLLE_GL)).toBe(true)
  })
})

describe('Eskalation an eine Rolle', () => {
  it('eine liegengebliebene Kenntnisnahme wandert zur Geschaeftsleitung -- als Rolle, protokolliert', async () => {
    const id = await schreiben('Rueckfrage zur Hausordnung.')
    await verteilen(id)
    await alsEigentuemer((c) =>
      c.query(
        `update aufgabe set faellig_am = now() - interval '49 hours'
          where lauf_id in (select id from dokument_lauf where dokument_id = $1) and status = 'offen'`,
        [id],
      ),
    )
    const { rows } = await alsEigentuemer((c) =>
      c.query<{ aufgabe_id: string; an_rolle: string | null; an_benutzer: string | null }>('select * from dms.eskalation_durchgang()'),
    )
    const meine = rows.filter((r) => r.an_rolle === ROLLE_GL)
    expect(meine.length).toBeGreaterThanOrEqual(1)
    const o = offene(await aufgaben(id))
    expect(o[0]!.rolle).toBe(ROLLE_GL)
    // Hoechstens ein Traeger je Aufgabe: Sie wandert, Anna steht im Protokoll.
    expect(o[0]!.benutzer).toBeNull()
    const { rows: protokoll } = await alsEigentuemer((c) =>
      c.query<{ von: string | null; an_rolle: string | null; grund: string }>(
        'select von_benutzer as von, an_rolle, grund from zuweisung_ereignis where dokument_id = $1',
        [id],
      ),
    )
    expect(protokoll).toEqual([{ von: ANNA, an_rolle: ROLLE_GL, grund: 'eskalation' }])
  })
})

describe('Regeln pflegen', () => {
  it('anlegen darf, wer Stammdaten pflegt; ein fremder Mandant sieht nichts', async () => {
    await expect(regelAnlegen(ANNA, { art: 'signalwort', muster: 'Widerspruch', wichtig: 'ja' })).rejects.toBeInstanceOf(NichtErlaubt)
    await regelAnlegen(ADMIN, { art: 'signalwort', muster: 'Widerspruch', ordnungsgruppeId: GRUPPE_RS, wichtig: 'ja' })
    const neu = (await regelnLaden(ADMIN)).find((r) => r.muster === 'Widerspruch')
    expect(neu).toBeDefined()
    regeln.push(neu!.id)
    expect((await regelnLaden(DORIS)).map((r) => r.muster)).not.toContain('Widerspruch')

    const id = await schreiben('Wir legen Widerspruch gegen den Bescheid ein.')
    expect((await verteilen(id)).wichtig).toBe(true)
  })

  it('weist eine Regel ohne Wirkung, ein Thema eines fremden Hauses und doppelte Muster ab', async () => {
    await expect(regelAnlegen(ADMIN, { art: 'signalwort', muster: 'Nichts', wichtig: '' })).rejects.toBeInstanceOf(NichtMoeglich)
    await expect(regelAnlegen(ADMIN, { art: 'signalwort', muster: 'Klage', wichtig: 'ja' })).rejects.toBeInstanceOf(NichtMoeglich)
    await expect(
      regelAnlegen(ADMIN, { art: 'absender', muster: 'Fremd', empfaenger: `benutzer:${DORIS}` }),
    ).rejects.toBeInstanceOf(NichtMoeglich)
  })

  it('ein Kuerzel ist je Haus eindeutig und hat zwei bis fuenf Buchstaben', async () => {
    await expect(kuerzelSetzen(ADMIN, { id: ANNA, kuerzel: 'BB' })).rejects.toBeInstanceOf(NichtMoeglich)
    await expect(kuerzelSetzen(ADMIN, { id: ANNA, kuerzel: 'A1' })).rejects.toBeInstanceOf(NichtMoeglich)
    await expect(kuerzelSetzen(ANNA, { id: ANNA, kuerzel: 'AX' })).rejects.toBeInstanceOf(NichtErlaubt)
    await kuerzelSetzen(ADMIN, { id: ANNA, kuerzel: 'ax' })
    const { rows } = await alsEigentuemer((c) => c.query<{ k: string }>('select kuerzel as k from benutzer where id = $1', [ANNA]))
    expect(rows[0]!.k).toBe('AX')
  })
})
