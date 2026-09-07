/**
 * Tests der Benachrichtigungen (Konzept §24.9).
 *
 * Das Konzept ließ die Frage offen: „Mail oder nur Zähler". Die Antwort ist
 * beides, verschieden dosiert — und die beiden Entscheidungen dahinter sind
 * es, die hier festgenagelt werden:
 *
 *   * **Keine Mail über null Aufgaben.** Eine Benachrichtigung, die auch
 *     dann kommt, wenn nichts zu tun ist, wird zur Gewohnheit und danach zur
 *     Nachricht, die man wegklickt.
 *   * **Kein Beleg in der Mail.** Ein Postfach ist schlechter geschützt als
 *     dieses System. Eine Aufzählung der fälligen Belege wäre eine zweite,
 *     schwächere Kopie des Bestands — täglich neu.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  basisAdresse,
  sammelmailsEintragen,
  wunschLaden,
  wunschSpeichern,
  zaehlerLaden,
} from '../src/benachrichtigung'
import { PLATZHALTER } from '../src/postausgang/vorlagen'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

beforeEach(() => {
  process.env['DMS_BASIS_URL'] = 'https://dms.example'
})

afterEach(async () => {
  delete process.env['DMS_BASIS_URL']
  await direkt('delete from benachrichtigung')
  await direkt("delete from ausgang where anlass = 'Taegliche Uebersicht'")
})

afterAll(poolSchliessen)

describe('Der Zaehler', () => {
  it('zaehlt die eigenen offenen Aufgaben', async () => {
    const zahl = await alsBenutzer(ANNA, zaehlerLaden)
    // Der Seed weist Anna Aufgaben zu; die genaue Zahl ist zweitrangig, dass
    // sie zaehlt, nicht.
    expect(zahl.offen).toBeGreaterThan(0)
  })

  it('zaehlt nicht die Aufgaben anderer', async () => {
    const anna = await alsBenutzer(ANNA, zaehlerLaden)
    const doris = await alsBenutzer(DORIS, zaehlerLaden)

    /*
     * Ohne `security definer` und damit unter der RLS: Ein Zaehler, der mehr
     * zaehlt als die Liste darunter zeigt, ist schlimmer als keiner -- er
     * schickt jemanden suchen.
     */
    expect(doris.offen).toBe(0)
    expect(anna.offen).toBeGreaterThan(0)
  })
})

describe('Der Wunsch', () => {
  it('gilt ohne Eintrag als an', async () => {
    /*
     * Eine Benachrichtigung, die man erst einschalten muss, schaltet niemand
     * ein -- und dann faellt eine Frist auf, wenn sie vorbei ist.
     */
    expect(await alsBenutzer(ANNA, wunschLaden)).toEqual({ taeglich: true, stunde: 7 })
  })

  it('laesst sich abschalten und wieder einschalten', async () => {
    await alsBenutzer(ANNA, (c) => wunschSpeichern(c, { taeglich: false, stunde: 9 }))
    expect(await alsBenutzer(ANNA, wunschLaden)).toEqual({ taeglich: false, stunde: 9 })

    await alsBenutzer(ANNA, (c) => wunschSpeichern(c, { taeglich: true, stunde: 6 }))
    expect(await alsBenutzer(ANNA, wunschLaden)).toEqual({ taeglich: true, stunde: 6 })
  })

  it('weist eine unmoegliche Stunde ab', async () => {
    await expect(
      alsBenutzer(ANNA, (c) => wunschSpeichern(c, { taeglich: true, stunde: 25 })),
    ).rejects.toThrow(/zwischen 0 und 23/)
  })

  it('laesst niemanden den Wunsch eines anderen aendern', async () => {
    await alsBenutzer(ANNA, (c) => wunschSpeichern(c, { taeglich: false, stunde: 9 }))

    // Wann jemand eine Mail moechte, geht niemanden sonst etwas an -- auch
    // die Benutzerverwaltung nicht.
    await alsBenutzer(BERND, (c) =>
      c.query('update benachrichtigung set taeglich = true where benutzer_id = $1', [ANNA]),
    )
    expect((await alsBenutzer(ANNA, wunschLaden)).taeglich).toBe(false)
  })
})

describe('Die Sammelmail', () => {
  it('legt einen Ausgang an, wenn Aufgaben offen sind', async () => {
    const bilanz = await sammelmailsEintragen(7)
    expect(bilanz.eingetragen).toBeGreaterThan(0)

    const [z] = await direkt<{ n: string }>(
      "select count(*) as n from ausgang where anlass = 'Taegliche Uebersicht'",
    )
    expect(Number(z.n)).toBe(bilanz.eingetragen)
  })

  it('nennt Zahlen und einen Link, aber keinen Beleg', async () => {
    await sammelmailsEintragen(7)
    const [a] = await direkt<{ betreff: string; text: string }>(
      "select betreff, text from ausgang where anlass = 'Taegliche Uebersicht' limit 1",
    )

    expect(a.text).toContain('https://dms.example/postfach')
    expect(a.text).toMatch(/\d+ offene Aufgaben/)

    /*
     * **Die wichtigste Zusicherung dieser Datei.** Kein Kreditor, keine
     * Rechnungsnummer, kein Betrag. Ein Postfach hat keine RLS, keine
     * Sitzung und kein Protokoll -- was dort landet, ist aus dem System
     * heraus.
     */
    for (const verboten of ['Musterreinigung', 'RE-2026', '€', 'IBAN', 'DE']) {
      expect(a.text).not.toContain(verboten)
    }
  })

  it('schickt keine Mail ueber null Aufgaben', async () => {
    /*
     * Doris hat keine Aufgaben. Eine Mail an sie waere die, die man
     * wegklickt -- und danach klickt man auch die naechste weg.
     */
    await sammelmailsEintragen(7)
    const [z] = await direkt<{ n: string }>(
      `select count(*) as n from ausgang a
        where a.anlass = 'Taegliche Uebersicht'
          and a.empfaenger = (select email from benutzer where id = $1)`,
      [DORIS],
    )
    expect(Number(z.n)).toBe(0)
  })

  it('schickt nicht zweimal am selben Tag', async () => {
    const erste = await sammelmailsEintragen(7)
    expect(erste.eingetragen).toBeGreaterThan(0)

    // Der Durchgang laeuft stuendlich. Ohne den Vermerk bekaeme jeder ab
    // seiner Stunde jede Stunde eine Mail.
    expect((await sammelmailsEintragen(7)).eingetragen).toBe(0)
  })

  it('beachtet die gewuenschte Stunde', async () => {
    await alsBenutzer(ANNA, (c) => wunschSpeichern(c, { taeglich: true, stunde: 15 }))

    await sammelmailsEintragen(7)
    const [um7] = await direkt<{ n: string }>(
      `select count(*) as n from ausgang a
        where a.anlass = 'Taegliche Uebersicht'
          and a.empfaenger = (select email from benutzer where id = $1)`,
      [ANNA],
    )
    expect(Number(um7.n)).toBe(0)

    await sammelmailsEintragen(15)
    const [um15] = await direkt<{ n: string }>(
      `select count(*) as n from ausgang a
        where a.anlass = 'Taegliche Uebersicht'
          and a.empfaenger = (select email from benutzer where id = $1)`,
      [ANNA],
    )
    expect(Number(um15.n)).toBe(1)
  })

  it('schickt nichts an jemanden, der abgeschaltet hat', async () => {
    await alsBenutzer(ANNA, (c) => wunschSpeichern(c, { taeglich: false, stunde: 7 }))
    await sammelmailsEintragen(7)

    const [z] = await direkt<{ n: string }>(
      `select count(*) as n from ausgang a
        where a.anlass = 'Taegliche Uebersicht'
          and a.empfaenger = (select email from benutzer where id = $1)`,
      [ANNA],
    )
    expect(Number(z.n)).toBe(0)
  })

  it('schickt nichts ohne bekannte Adresse der Anwendung', async () => {
    delete process.env['DMS_BASIS_URL']
    expect(basisAdresse()).toBeNull()

    /*
     * Eine Benachrichtigung mit einem Link ins Leere ist schlechter als
     * keine: Sie kostet den Empfaenger zweimal Zeit -- beim Lesen und beim
     * Nachfragen.
     */
    expect((await sammelmailsEintragen(7)).eingetragen).toBe(0)
  })

  it('schneidet den Schraegstrich am Ende ab', () => {
    process.env['DMS_BASIS_URL'] = 'https://dms.example/'
    // Sonst steht in der Mail ein Link mit zwei Schraegstrichen.
    expect(basisAdresse()).toBe('https://dms.example')
  })
})

describe('Die Weissliste', () => {
  it('kennt die beiden neuen Platzhalter', () => {
    expect(Object.keys(PLATZHALTER)).toContain('anzahl')
    expect(Object.keys(PLATZHALTER)).toContain('ueberfaellig')
  })

  it('kennt weiterhin keinen Belegtext', () => {
    // Was die Sammelmail nicht einsetzen kann, kann sie auch nicht
    // versehentlich verschicken.
    for (const verboten of ['belegtext', 'iban', 'kontierung', 'aufgaben']) {
      expect(Object.keys(PLATZHALTER)).not.toContain(verboten)
    }
  })
})
