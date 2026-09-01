/**
 * Tests des Fehlerkorbs.
 *
 * Konzept 24, Punkt 8 lässt die Frage offen: „Was passiert mit einem
 * Dokument, dessen OCR dreimal scheitert." Die Antwort steht hier, und die
 * Tests prüfen die drei Zusagen, die sie macht:
 *
 *   * **Der Fehler ist sichtbar** — mandantengetrennt, mit Grund.
 *   * **Es gibt genau drei Ausgänge**, und jeder wirkt auf das Dokument:
 *     wiederholen reiht neu ein, manuell macht den Beleg `laufend`,
 *     verwerfen storniert ihn — es löscht ihn nicht.
 *   * **Was nie im Korb ankam, fällt trotzdem auf.** Stirbt der Worker mitten
 *     in der Aufbereitung, gibt es keinen aufgegebenen Auftrag. Deshalb die
 *     zweite Quelle über den Zustand.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { poolSchliessen, verbindungspool } from '../src/db'
import {
  FehlerkorbAbgelehnt,
  fehlerkorbLaden,
  fehlerManuell,
  fehlerMelden,
  fehlerVerwerfen,
  fehlerWiederholen,
  haengendeLaden,
  haengerWiederholen,
} from '../src/fehlerkorb'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'

/** Ein frischer Beleg im Zustand, in dem die Aufbereitung ihn hinterlässt. */
let dokumentId: string

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
  const [z] = await direkt<{ id: string }>(
    `insert into dokument (mandant_id, belegart, eingangskanal, inhalt_hash,
                           storage_praefix, status, eingang_am)
     values ($1, 'rechnung', 'upload', 'hash-fehlerkorb-test',
             'test/fehlerkorb', 'in_aufbereitung', now() - interval '2 hours')
     returning id`,
    [MANDANT],
  )
  dokumentId = z.id
})

afterEach(async () => {
  await direkt('delete from verarbeitungsfehler')
  await belegEntfernen(dokumentId)
})

afterAll(poolSchliessen)

describe('Melden', () => {
  it('haelt Grund, Warteschlange und Versuche fest', async () => {
    const id = await fehlerMelden(ANNA, {
      dokumentId,
      warteschlange: 'dokument-aufbereiten',
      grund: 'ocrmypdf: exit 2',
      versuche: 3,
      auftragId: 'auftrag-1',
    })
    expect(id).not.toBeNull()

    const [korb] = await fehlerkorbLaden(ANNA)
    expect(korb.dokumentId).toBe(dokumentId)
    expect(korb.grund).toBe('ocrmypdf: exit 2')
    expect(korb.warteschlange).toBe('dokument-aufbereiten')
    expect(korb.versuche).toBe(3)
    expect(korb.dokumentStatus).toBe('in_aufbereitung')
  })

  it('meldet denselben Vorgang nicht zweimal offen', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'einmal' })
    const zweiter = await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'zweimal' })

    // Der Korb soll die Zahl der Vorgaenge zeigen, nicht die der Meldungen.
    expect(zweiter).toBeNull()
    expect(await fehlerkorbLaden(ANNA)).toHaveLength(1)
  })

  it('kuerzt einen ausufernden Grund', async () => {
    await fehlerMelden(ANNA, {
      dokumentId,
      warteschlange: 'q',
      grund: 'x'.repeat(2000),
    })
    const [korb] = await fehlerkorbLaden(ANNA)
    expect(korb.grund.length).toBe(500)
  })

  it('meldet nichts zu einer verschwundenen Quelle', async () => {
    const erfunden = '00000000-0000-0000-0000-0000000000ff'
    expect(
      await fehlerMelden(ANNA, { dokumentId: erfunden, warteschlange: 'q', grund: 'weg' }),
    ).toBeNull()
  })

  it('verlangt genau eine Quelle', async () => {
    await expect(
      fehlerMelden(ANNA, { warteschlange: 'q', grund: 'ohne alles' }),
    ).rejects.toThrow(/Genau eine Quelle/)
  })
})

describe('Mandantengrenze', () => {
  it('zeigt Doris den Korb des fremden Mandanten nicht', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'geheim' })

    expect(await fehlerkorbLaden(ANNA)).toHaveLength(1)
    expect(await fehlerkorbLaden(DORIS)).toEqual([])
  })

  it('laesst Doris einen fremden Eintrag nicht erledigen', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'geheim' })
    const [korb] = await fehlerkorbLaden(ANNA)

    expect(await fehlerManuell(DORIS, korb.id)).toBe(false)
    // Und er steht danach unveraendert offen.
    expect(await fehlerkorbLaden(ANNA)).toHaveLength(1)
  })

  it('zeigt einen Beleg ohne Objekt jedem im Mandanten', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'ohne Objekt' })

    // Ein Beleg, dessen Aufbereitung scheitert, hat meist noch kein Objekt --
    // dann soll er eher zu viele Augen sehen als zu wenige.
    expect(await fehlerkorbLaden(BERND)).toHaveLength(1)
  })
})

describe('Ausgaenge', () => {
  it('wiederholen reiht neu ein und schliesst den Eintrag', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'Platte voll' })
    const [korb] = await fehlerkorbLaden(ANNA)

    expect(await fehlerWiederholen(ANNA, korb.id)).toBe(true)
    expect(await fehlerkorbLaden(ANNA)).toEqual([])

    const [erledigt] = await direkt<{ erledigung: string; erledigt_von: string }>(
      'select erledigung, erledigt_von from verarbeitungsfehler where id = $1',
      [korb.id],
    )
    expect(erledigt.erledigung).toBe('wiederholt')
    expect(erledigt.erledigt_von).toBe(ANNA)

    // Der Auftrag liegt wieder in der Warteschlange -- sonst waere der
    // Eintrag geschlossen und der Beleg laege still weiter.
    const [auftrag] = await direkt<{ n: number }>(
      `select count(*)::int n from pgboss.job
        where name = 'dokument-aufbereiten' and data->>'dokumentId' = $1`,
      [dokumentId],
    )
    expect(auftrag.n).toBeGreaterThan(0)
  })

  it('manuell macht den Beleg laufend', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'OCR aus' })
    const [korb] = await fehlerkorbLaden(ANNA)

    expect(await fehlerManuell(ANNA, korb.id)).toBe(true)

    const [d] = await direkt<{ status: string }>(
      'select status from dokument where id = $1',
      [dokumentId],
    )
    // Der Lauf lief ohnehin schon -- er startet beim Eingang. Was hier
    // passiert, ist nur das Ende des Wartens auf die Aufbereitung.
    expect(d.status).toBe('laufend')
  })

  it('verwerfen storniert, statt zu loeschen', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'kaputte Datei' })
    const [korb] = await fehlerkorbLaden(ANNA)

    expect(await fehlerVerwerfen(ANNA, korb.id, 'Datei ist kein PDF')).toBe(true)

    const [d] = await direkt<{ status: string }>(
      'select status from dokument where id = $1',
      [dokumentId],
    )
    expect(d.status).toBe('storniert')
  })

  it('verlangt fuer das Verwerfen eine Begruendung', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'kaputt' })
    const [korb] = await fehlerkorbLaden(ANNA)

    await expect(fehlerVerwerfen(ANNA, korb.id, '   ')).rejects.toThrow(FehlerkorbAbgelehnt)
    expect(await fehlerkorbLaden(ANNA)).toHaveLength(1)
  })

  it('erledigt einen Eintrag nicht zweimal', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'einmal' })
    const [korb] = await fehlerkorbLaden(ANNA)

    expect(await fehlerManuell(ANNA, korb.id)).toBe(true)
    expect(await fehlerManuell(ANNA, korb.id)).toBe(false)
  })
})

describe('Haengengebliebene', () => {
  it('findet einen Beleg, den niemand gemeldet hat', async () => {
    const haenger = await haengendeLaden(ANNA, 30)
    expect(haenger.map((h) => h.dokumentId)).toContain(dokumentId)
  })

  it('schweigt, solange der Beleg im Korb steht', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'gemeldet' })

    // Zweimal dieselbe Sache zu melden waere schlimmer als sie einmal zu
    // uebersehen: Wer zwei Listen abarbeitet, traut keiner.
    const haenger = await haengendeLaden(ANNA, 30)
    expect(haenger.map((h) => h.dokumentId)).not.toContain(dokumentId)
  })

  it('schweigt bei einem frisch eingegangenen Beleg', async () => {
    await direkt('update dokument set eingang_am = now() where id = $1', [dokumentId])
    const haenger = await haengendeLaden(ANNA, 30)
    expect(haenger.map((h) => h.dokumentId)).not.toContain(dokumentId)
  })

  it('zeigt Doris nichts aus dem fremden Mandanten', async () => {
    expect(await haengendeLaden(DORIS, 30)).toEqual([])
  })

  it('meldet einen Beleg nach dem Erledigen nicht wieder als Haenger', async () => {
    await fehlerMelden(ANNA, { dokumentId, warteschlange: 'q', grund: 'OCR aus' })
    const [korb] = await fehlerkorbLaden(ANNA)
    await fehlerManuell(ANNA, korb.id)

    // Der Beleg ist jetzt `laufend` und haengt damit nicht mehr.
    const haenger = await haengendeLaden(ANNA, 30)
    expect(haenger.map((h) => h.dokumentId)).not.toContain(dokumentId)
  })
})

describe('Stapel', () => {
  let stapelId: string

  beforeEach(async () => {
    const [z] = await direkt<{ id: string }>(
      `insert into stapel (mandant_id, storage_key, inhalt_hash, seitenzahl,
                           eingangskanal, dateiname, status, erfasst_von)
       values ($1, 'test/stapel-fehler', 'hash-stapel-fehler', 3,
               'scan', 'scan-2026-09-01.pdf', 'aufbereitung', $2)
       returning id`,
      [MANDANT, ANNA],
    )
    stapelId = z.id
  })

  afterEach(async () => {
    await direkt('delete from stapel where id = $1', [stapelId])
  })

  it('landet mit eigener Quelle im Korb', async () => {
    await fehlerMelden(ANNA, {
      stapelId,
      warteschlange: 'stapel-aufbereiten',
      grund: 'Seite 2 nicht lesbar',
    })

    const korb = await fehlerkorbLaden(ANNA)
    const eintrag = korb.find((k) => k.stapelId === stapelId)
    expect(eintrag?.dokumentId).toBeNull()
  })

  it('laesst sich nicht von Hand uebernehmen', async () => {
    await fehlerMelden(ANNA, { stapelId, warteschlange: 'q', grund: 'kaputt' })
    const eintrag = (await fehlerkorbLaden(ANNA)).find((k) => k.stapelId === stapelId)

    // Vor der Uebernahme gibt es keinen Beleg, an dem jemand von Hand
    // weiterarbeiten koennte -- entweder wiederholen oder verwerfen.
    await expect(fehlerManuell(ANNA, eintrag!.id)).rejects.toThrow(FehlerkorbAbgelehnt)
  })

  it('wird beim Verwerfen verworfen, nicht storniert', async () => {
    await fehlerMelden(ANNA, { stapelId, warteschlange: 'q', grund: 'kaputt' })
    const eintrag = (await fehlerkorbLaden(ANNA)).find((k) => k.stapelId === stapelId)

    expect(await fehlerVerwerfen(ANNA, eintrag!.id, 'Scandatei unbrauchbar')).toBe(true)
    const [s] = await direkt<{ status: string }>(
      'select status from stapel where id = $1',
      [stapelId],
    )
    expect(s.status).toBe('verworfen')
  })
})

describe('Haenger neu einreihen', () => {
  async function auftraege(): Promise<number> {
    const [z] = await direkt<{ n: number }>(
      `select count(*)::int n from pgboss.job
        where name = 'dokument-aufbereiten' and data->>'dokumentId' = $1`,
      [dokumentId],
    )
    return z.n
  }

  afterEach(async () => {
    await direkt(`delete from pgboss.job where data->>'dokumentId' = $1`, [dokumentId])
  })

  it('reiht ein und laesst den Beleg in Aufbereitung', async () => {
    expect(await haengerWiederholen(ANNA, dokumentId)).toBe(true)
    expect(await auftraege()).toBe(1)

    // Der Status bleibt -- erst die Aufbereitung selbst setzt ihn weiter.
    const [d] = await direkt<{ status: string }>(
      'select status from dokument where id = $1',
      [dokumentId],
    )
    expect(d.status).toBe('in_aufbereitung')
  })

  it('reiht einen Beleg nicht ein, der schon weiter ist', async () => {
    await direkt(`update dokument set status = 'laufend' where id = $1`, [dokumentId])

    // Sonst erzeugte ein zweiter Klick einen zweiten Auftrag -- und die
    // Aufbereitung liefe ueber einen Beleg, der laengst bearbeitet wird.
    expect(await haengerWiederholen(ANNA, dokumentId)).toBe(false)
    expect(await auftraege()).toBe(0)
  })

  it('laesst Doris keinen fremden Beleg einreihen', async () => {
    expect(await haengerWiederholen(DORIS, dokumentId)).toBe(false)
    expect(await auftraege()).toBe(0)
  })
})
