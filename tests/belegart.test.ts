/**
 * Tests der Belegart-Erkennung aus dem Inhalt.
 *
 * Zwei Haelften: Die Erkennung selbst (reine Funktion, Woerter und Ampel),
 * und was das System damit tut -- der Lauf wandert mit, aber nur, solange
 * niemand entschieden hat, und nur, wenn es fuer die neue Belegart einen
 * Ablauf gibt. Was ein Mensch gewaehlt hat, stellt die Erkennung nicht um.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { belegartErkennen } from '../src/lernen/belegart'
import { angabenNachtragen, NachtragAbgelehnt } from '../src/belege/nachtragen'
import { belegartWechseln, laufStarten } from '../src/workflow/engine'
import { belegEntfernen } from './hilfe/aufraeumen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'

const seite = (text: string) => [{ seite: 1, text }]

describe('Erkennung', () => {
  it('erkennt eine Rechnung an Rechnungsnummer und Rechnungsdatum', () => {
    const v = belegartErkennen(seite('Musterreinigung GmbH\nRechnung\nRechnungsnummer RE-2026-0001\nRechnungsdatum 14.03.2026\nNetto 1.042,02 EUR zzgl. 19 % MwSt.'))
    expect(v.belegart).toBe('rechnung')
    expect(v.sicherheit).toBe('gruen')
    expect(v.begruendung).toContain('Rechnungsnummer')
  })

  it('haelt eine Mahnung nicht fuer eine Rechnung, obwohl sie die Rechnung nennt', () => {
    const v = belegartErkennen(seite('2. Mahnung\nSehr geehrte Damen und Herren,\nzu unserer Rechnung Nr. 4711 vom 01.08.2026 haben wir noch keinen Zahlungseingang. Mahngebühr 5,00 EUR, Verzugszinsen.'))
    expect(v.belegart).toBe('mahnung')
    expect(v.sicherheit).toBe('gruen')
  })

  it('erkennt eine Gutschrift', () => {
    const v = belegartErkennen(seite('Gutschrift\nGutschriftsnummer GS-2026-17 zu Rechnung RE-2026-0001\nGutschriftsbetrag -119,00 EUR'))
    expect(v.belegart).toBe('gutschrift')
    expect(v.sicherheit).toBe('gruen')
  })

  it('ordnet ein Angebot dem Schriftverkehr zu -- ohne Rechnungsnummer ist es keine Rechnung', () => {
    const v = belegartErkennen(seite('BRANDSCHUTZ MAYER\nAngebotsnummer ANG 6149\nAngebot-Nr. ANG 6149\nSehr geehrte Damen und Herren, anbei erhalten Sie unser Angebot. Nettobetrag 2.733,15 EUR zzgl. 19% MwSt.'))
    expect(v.belegart).toBe('schriftverkehr')
    expect(v.sicherheit).toBe('gruen')
    expect(v.begruendung).toContain('Angebot')
  })

  it('bleibt bei Widerspruch orange und bei leerem Text rot', () => {
    // Rechnungsnummer und Angebot im Kopf: gleich stark, kein Abstand.
    const zweifel = belegartErkennen(seite('Rechnung Rechnungsnummer 12 zu unserem Angebot'))
    expect(zweifel.belegart).toBe('rechnung')
    expect(zweifel.sicherheit).toBe('orange')
    const leer = belegartErkennen(seite('Seite 1'))
    expect(leer.belegart).toBeNull()
    expect(leer.sicherheit).toBe('rot')
  })

  it('zaehlt nur die ersten zwei Seiten und den Kopf doppelt', () => {
    const spaet = belegartErkennen([
      { seite: 1, text: 'Protokoll der Eigentümerversammlung, Einladung zur Versammlung' },
      { seite: 2, text: 'Tagesordnung' },
      { seite: 3, text: 'Rechnung Rechnungsnummer Rechnungsdatum Rechnungsnummer' },
    ])
    expect(spaet.belegart).toBe('schriftverkehr')
  })
})

describe('Wechsel des Ablaufs', () => {
  let beleg = ''

  async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
    const c = await verbindungspool().connect()
    try {
      return (await c.query(frage, werte)).rows as T[]
    } finally {
      c.release()
    }
  }

  beforeEach(async () => {
    beleg = await alsBenutzer(BERND, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into dokument (mandant_id, belegart, ordnungsgruppe_id, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
         values ($1, 'rechnung', $2, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'rot')
         returning id`,
        [MANDANT, GRUPPE_BK],
      )
      await laufStarten(c, rows[0]!.id)
      return rows[0]!.id
    })
  })

  afterEach(async () => {
    await belegEntfernen(beleg)
  })

  afterAll(poolSchliessen)

  it('stellt Belegart und Lauf um, solange keine Entscheidung vorliegt', async () => {
    const ausgang = await alsBenutzer(BERND, (c) => belegartWechseln(c, beleg, 'mahnung', 'erkannt', 'erkannt am Inhalt: „Mahnung“'))
    expect(ausgang).toBe('gewechselt')
    const [d] = await direkt<{ belegart: string; belegart_quelle: string }>('select belegart, belegart_quelle from dokument where id = $1', [beleg])
    expect(d).toMatchObject({ belegart: 'mahnung', belegart_quelle: 'erkannt' })
    // Ein Beleg hat genau einen Lauf: Er wechselt seine Definition.
    const laeufe = await direkt<{ status: string; belegart: string }>(
      `select l.status, p.belegart from dokument_lauf l join prozessdefinition p on p.id = l.definition_id where l.dokument_id = $1`,
      [beleg],
    )
    expect(laeufe.map((l) => `${l.belegart}:${l.status}`)).toEqual(['mahnung:laufend'])
    // Die alten Aufgaben sind entfallen, die offene gehoert zum Mahnungsablauf.
    const aufgaben = await direkt<{ status: string; bezeichnung: string }>(
      `select a.status, s.bezeichnung from aufgabe a join dokument_lauf l on l.id = a.lauf_id join prozessstufe s on s.id = a.stufe_id where l.dokument_id = $1 order by a.status`,
      [beleg],
    )
    expect(aufgaben.filter((a) => a.status === 'entfallen').length).toBeGreaterThan(0)
    expect(aufgaben.filter((a) => a.status === 'offen').map((a) => a.bezeichnung)).toEqual(['Mahnung pruefen'])
  })

  it('laesst die Belegart stehen, wenn es keinen Ablauf dafuer gibt -- und sagt es am Beleg', async () => {
    const ausgang = await alsBenutzer(BERND, (c) => belegartWechseln(c, beleg, 'sonstiges', 'erkannt', 'erkannt am Inhalt: „Protokoll“'))
    expect(ausgang).toBe('kein_ablauf')
    const [d] = await direkt<{ belegart: string; belegart_begruendung: string }>('select belegart, belegart_begruendung from dokument where id = $1', [beleg])
    expect(d?.belegart).toBe('rechnung')
    expect(d?.belegart_begruendung).toContain('keinen aktiven Ablauf')
  })

  it('stellt nichts um, was ein Mensch gewaehlt hat', async () => {
    await angabenNachtragen(BERND, beleg, { belegart: 'schriftverkehr' })
    const ausgang = await alsBenutzer(BERND, (c) => belegartWechseln(c, beleg, 'mahnung', 'erkannt', 'erkannt am Inhalt: „Mahnung“'))
    expect(ausgang).toBe('unveraendert')
    const [d] = await direkt<{ belegart: string; belegart_quelle: string }>('select belegart, belegart_quelle from dokument where id = $1', [beleg])
    expect(d).toMatchObject({ belegart: 'schriftverkehr', belegart_quelle: 'mensch' })
  })

  it('weist von Hand eine Belegart ohne Ablauf ab', async () => {
    await expect(angabenNachtragen(BERND, beleg, { belegart: 'sonstiges' })).rejects.toThrow(NachtragAbgelehnt)
    await expect(angabenNachtragen(BERND, beleg, { belegart: 'quittung' })).rejects.toThrow(/gibt es nicht/)
  })
})
