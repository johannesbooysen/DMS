/**
 * Tests der Eingangsquellen- und Vorlagenpflege.
 *
 * Beide sind Stammdaten mit einer Besonderheit, und beide Besonderheiten
 * werden hier geprüft — nicht das Speichern von Zeilen:
 *
 *   * **Eine Eingangsquelle enthält kein Passwort.** In den Einstellungen
 *     steht der *Name* einer Umgebungsvariablen. Ein Test, der das nicht
 *     festhält, lässt zu, dass beim nächsten Feld jemand ein Passwortfeld
 *     einbaut — und dann steht das Geheimnis in jedem Datenbankauszug.
 *
 *   * **Eine Vorlage bestimmt, was das Haus verlässt.** Ein unbekannter
 *     Platzhalter geht sonst im Klartext an einen Dritten hinaus.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { poolSchliessen, verbindungspool } from '../src/db'
import { NichtErlaubt, NichtMoeglich } from '../src/stammdaten'
import {
  platzhalterListe,
  quelleAnlegen,
  quelleUmschalten,
  quelleneinrichtungLaden,
  vorlagenpflegeLaden,
  vorlageSpeichern,
} from '../src/stammdaten/quellen'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const EVA = '20000000-0000-0000-0000-000000000005'
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

afterEach(async () => {
  await direkt("delete from eingangsquelle where bezeichnung like 'TEST-%'")
})

afterAll(poolSchliessen)

describe('Eingangsquellen einrichten', () => {
  it('speichert den Namen der Umgebungsvariablen, nicht das Passwort', async () => {
    await quelleAnlegen(EVA, {
      art: 'mail',
      bezeichnung: 'TEST-Postfach',
      host: 'imap.example',
      postfach: 'rechnungen@example',
      passwortVariable: 'DMS_IMAP_TEST',
    })

    const [z] = await direkt<{ einstellungen: Record<string, unknown> }>(
      "select einstellungen from eingangsquelle where bezeichnung = 'TEST-Postfach'",
    )

    /*
     * Die eigentliche Zusicherung. Der Name steht drin, ein Passwortfeld
     * gibt es gar nicht -- und was sich nicht eingeben laesst, kann auch
     * nicht versehentlich in der Datenbank landen.
     */
    expect(z.einstellungen['passwort_variable']).toBe('DMS_IMAP_TEST')
    expect(Object.keys(z.einstellungen)).not.toContain('passwort')

    // Und nirgends im gesamten Wert steht etwas, das nach einem Geheimnis
    // aussieht -- auch nicht unter einem anderen Schluessel.
    const alsText = JSON.stringify(z.einstellungen).toLowerCase()
    expect(alsText).not.toMatch(/"passwort"\s*:/)
  })

  it('meldet, ob die Variable auf diesem Server gesetzt ist', async () => {
    await quelleAnlegen(EVA, {
      art: 'mail',
      bezeichnung: 'TEST-Fehlt',
      host: 'imap.example',
      postfach: 'x@example',
      passwortVariable: 'DMS_GIBT_ES_NICHT',
    })

    const gesetzt = 'DMS_IMAP_PROBE'
    process.env[gesetzt] = 'geheim'
    await quelleAnlegen(EVA, {
      art: 'mail',
      bezeichnung: 'TEST-Da',
      host: 'imap.example',
      postfach: 'y@example',
      passwortVariable: gesetzt,
    })

    try {
      const quellen = await quelleneinrichtungLaden(EVA)
      /*
       * Der eigentliche Nutzen der Maske: Eine Quelle mit einer Variablen,
       * die hier fehlt, scheitert beim naechsten Lauf -- und der Fehler
       * landet in einer Spalte, die niemand liest, bis eine Rechnung
       * vermisst wird.
       */
      expect(quellen.find((q) => q.bezeichnung === 'TEST-Fehlt')?.passwortVorhanden).toBe(false)
      expect(quellen.find((q) => q.bezeichnung === 'TEST-Da')?.passwortVorhanden).toBe(true)
    } finally {
      delete process.env[gesetzt]
    }
  })

  it('gibt den Wert der Variablen nirgends heraus', async () => {
    const name = 'DMS_IMAP_GEHEIM'
    process.env[name] = 'streng-geheim'
    await quelleAnlegen(EVA, {
      art: 'mail',
      bezeichnung: 'TEST-Geheim',
      host: 'imap.example',
      postfach: 'z@example',
      passwortVariable: name,
    })

    try {
      const quellen = await quelleneinrichtungLaden(EVA)
      // Auch die Oberflaeche bekommt nur "gesetzt" oder "fehlt" -- ein
      // Passwort gehoert nicht in eine Seite, die es nur anzeigen soll.
      expect(JSON.stringify(quellen)).not.toContain('streng-geheim')
    } finally {
      delete process.env[name]
    }
  })

  it('haelt fest, wer die Quelle traegt', async () => {
    await quelleAnlegen(EVA, {
      art: 'ordner',
      bezeichnung: 'TEST-Ordner',
      pfad: '/eingang/test',
    })

    const quellen = await quelleneinrichtungLaden(EVA)
    const q = quellen.find((x) => x.bezeichnung === 'TEST-Ordner')

    /*
     * Eine Quelle arbeitet unter den Rechten ihres Einrichters, nicht unter
     * einem technischen Konto. Am Beleg steht dadurch ein Name, den man
     * fragen kann.
     */
    expect(q?.traeger).toBe('Eva Ebert')
    expect(q?.traegerAktiv).toBe(true)
  })

  it('laesst eine Objektbearbeiterin keine Quelle einrichten', async () => {
    /*
     * Eine Eingangsquelle bestimmt, welche Belege ueberhaupt entstehen --
     * das ist keine Sachbearbeitung. Das Recht dafuer ist
     * `prozess_konfigurieren`, und Anna hat es nicht.
     */
    await expect(
      quelleAnlegen(ANNA, { art: 'ordner', bezeichnung: 'TEST-Heimlich', pfad: '/tmp' }),
    ).rejects.toBeInstanceOf(NichtErlaubt)
  })

  it('weist einen zu kurzen Takt ab', async () => {
    await expect(
      quelleAnlegen(EVA, {
        art: 'ordner',
        bezeichnung: 'TEST-Hektisch',
        pfad: '/tmp',
        taktSekunden: '5',
      }),
    ).rejects.toBeInstanceOf(NichtMoeglich)
  })

  it('loescht beim Einschalten den alten Fehler', async () => {
    await quelleAnlegen(EVA, { art: 'ordner', bezeichnung: 'TEST-Wieder', pfad: '/tmp' })
    const [q] = await direkt<{ id: string }>(
      "select id from eingangsquelle where bezeichnung = 'TEST-Wieder'",
    )
    await direkt(
      "update eingangsquelle set letzter_fehler = 'Pfad nicht gefunden' where id = $1",
      [q.id],
    )

    await quelleUmschalten(EVA, { id: q.id }) // aus
    await quelleUmschalten(EVA, { id: q.id }) // wieder an

    const [n] = await direkt<{ aktiv: boolean; letzter_fehler: string | null }>(
      'select aktiv, letzter_fehler from eingangsquelle where id = $1',
      [q.id],
    )
    // Der alte Fehler beschreibt einen Lauf, den es nicht mehr gibt. Stehen
    // zu lassen hiesse, eine frisch eingerichtete Quelle als kaputt zu
    // zeigen.
    expect(n.aktiv).toBe(true)
    expect(n.letzter_fehler).toBeNull()
  })

  it('zeigt einem fremden Mandanten keine Quelle', async () => {
    await quelleAnlegen(EVA, { art: 'ordner', bezeichnung: 'TEST-Nord', pfad: '/tmp' })
    const fremd = await quelleneinrichtungLaden(DORIS)
    expect(fremd.some((q) => q.bezeichnung === 'TEST-Nord')).toBe(false)
  })
})

describe('Vorlagen', () => {
  it('weist einen unbekannten Platzhalter ab', async () => {
    const [v] = await direkt<{ id: string }>('select id from vorlage limit 1')

    /*
     * Beim Fuellen bleibt ein unbekannter Platzhalter stehen, damit er
     * auffaellt. Beim Speichern wird er gar nicht erst angenommen -- das
     * sind zwei Gelegenheiten, einen Tippfehler zu bemerken, und die
     * spaetere ist eine Mail, die schon draussen ist.
     */
    await expect(
      vorlageSpeichern(EVA, {
        id: v.id,
        betreff: 'Zahlung {{kreditor}}',
        text: 'Guten Tag, anbei {{rechnungsbetrag}}.',
      }),
    ).rejects.toThrow(/rechnungsbetrag/)
  })

  it('nimmt eine Vorlage mit erlaubten Platzhaltern an', async () => {
    const [v] = await direkt<{ id: string }>('select id from vorlage limit 1')
    await vorlageSpeichern(EVA, {
      id: v.id,
      betreff: 'Zahlung {{kreditor}} {{rechnungsnummer}}',
      text: 'Betrag {{betrag}}, faellig {{faellig}}.',
    })

    const alle = await vorlagenpflegeLaden(EVA)
    const neu = alle.find((x) => x.id === v.id)
    expect(neu?.betreff).toContain('{{kreditor}}')
    expect(neu?.unbekannt).toEqual([])
  })

  it('zeigt die Vorschau mit erfundenen Beispielwerten', async () => {
    const [v] = await direkt<{ id: string }>('select id from vorlage limit 1')
    await vorlageSpeichern(EVA, {
      id: v.id,
      betreff: '{{kreditor}}',
      text: 'Betrag {{betrag}} zum {{faellig}}.',
    })

    const neu = (await vorlagenpflegeLaden(EVA)).find((x) => x.id === v.id)

    // Die Vorschau ist der Punkt der Seite: Wer eine Formulierung aendert,
    // die an eine Bank geht, will sehen, was ankommt.
    expect(neu?.vorschauBetreff).toBe('Musterreinigung GmbH')
    expect(neu?.vorschauText).toContain('1.240,00 €')
    expect(neu?.vorschauText).not.toContain('{{')
  })

  it('haelt fest, wer zuletzt geaendert hat', async () => {
    const [v] = await direkt<{ id: string }>('select id from vorlage limit 1')
    await vorlageSpeichern(BERND, {
      id: v.id,
      betreff: 'Neu {{kreditor}}',
      text: 'Text {{betrag}}',
    })

    const neu = (await vorlagenpflegeLaden(BERND)).find((x) => x.id === v.id)
    /*
     * Wenn eine Mail an einen Versicherer eine Formulierung enthaelt, die
     * dort niemand erwartet hat, lautet die erste Frage, wer sie
     * hineingeschrieben hat. Die Spalten gab es seit der ersten Fassung --
     * gefuellt hat sie bis 20260903120000 niemand.
     */
    expect(neu?.geaendertVon).toBe('Bernd Bruns')
    expect(neu?.geaendertAm).not.toBeNull()
  })

  it('laesst eine Objektbearbeiterin keine Vorlage aendern', async () => {
    const [v] = await direkt<{ id: string }>('select id from vorlage limit 1')

    /*
     * Der Fund dieses Blocks: `vorlage_sicht` lautete `for all` mit reinem
     * Mandantenfilter. Jeder konnte umschreiben, was das Haus verlaesst.
     */
    await expect(
      vorlageSpeichern(ANNA, { id: v.id, betreff: 'Gekapert', text: 'Bitte hierhin zahlen.' }),
    ).rejects.toBeInstanceOf(NichtErlaubt)

    const unveraendert = (await vorlagenpflegeLaden(ANNA)).find((x) => x.id === v.id)
    expect(unveraendert?.betreff).not.toBe('Gekapert')
  })

  it('laesst sie die Vorlagen aber lesen', async () => {
    // Wer Ausgangspost sieht, soll nachsehen koennen, aus welcher Vorlage
    // sie entstanden ist.
    expect((await vorlagenpflegeLaden(ANNA)).length).toBeGreaterThan(0)
  })

  it('zeigt einem fremden Mandanten keine Vorlage aus Nord', async () => {
    const eigen = await vorlagenpflegeLaden(BERND)
    const fremd = await vorlagenpflegeLaden(DORIS)
    expect(fremd.map((v) => v.id)).not.toEqual(
      expect.arrayContaining(eigen.map((v) => v.id)),
    )
  })

  it('nennt die Weissliste vollstaendig', () => {
    const namen = platzhalterListe().map((p) => p.name)
    // Die Oberflaeche zeigt genau diese Liste. Waere sie unvollstaendig,
    // suchte jemand nach einem Platzhalter, den es gibt.
    expect(namen).toContain('kreditor')
    expect(namen).toContain('link')
    // Und was bewusst fehlt, fehlt weiterhin: Der Belegtext gehoert nicht in
    // eine Mail, die ein Stammdatum adressiert.
    expect(namen).not.toContain('belegtext')
    expect(namen).not.toContain('iban')
  })
})
