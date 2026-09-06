/**
 * Tests des Postausgangs.
 *
 * Zwei Schwerpunkte:
 *
 *   * **Die Weißliste.** Was nicht in `PLATZHALTER` steht, lässt sich nicht
 *     einsetzen. Eine freie Vorlagensprache könnte den ganzen Belegtext in
 *     eine Mail schreiben — an einen Empfänger, den ein Stammdatum bestimmt,
 *     in einem Kanal, den niemand mehr einholt.
 *   * **Das Ausgangsbuch.** Ein gescheiterter Versand ist sichtbar und
 *     wiederholbar, nicht still verloren. Genau das war die Bedingung dafür,
 *     den Versand aus dem Stempel herauszunehmen.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  ausgangsbuchLaden,
  MerkVersand,
  PostAbgelehnt,
  postAnlegen,
  postSenden,
  postWiederholen,
  PLATZHALTER,
  vorlageFuellen,
  vorlagenLaden,
  vorlagePruefen,
  versandAusUmgebung,
  versandZuruecksetzen,
} from '../src/postausgang'


const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const D1 = '70000000-0000-0000-0000-000000000001'

const ablage = {
  async lesen(schluessel: string): Promise<Buffer> {
    if (schluessel === 'fehlt') throw new Error('nicht gefunden')
    return Buffer.from('Empfaenger;IBAN\r\n"Muster";"DE00"\r\n', 'utf8')
  },
  // Der Postausgang entfernt nichts -- er liest Anhänge. Die Methode gehört
  // trotzdem zum Interface, seit das Löschen nach Fristablauf dazukam.
  async entfernen(): Promise<void> {
    throw new Error('Der Postausgang entfernt keine Dateien.')
  },
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

/** Legt einen Ausgang an — wie im Betrieb, in einer Transaktion. */
async function anlegen(
  eingabe: Parameters<typeof postAnlegen>[1],
  benutzerId = ANNA,
): Promise<string> {
  return alsBenutzer(benutzerId, (c) => postAnlegen(c, eingabe))
}

afterEach(async () => {
  await direkt('delete from ausgang')
  // Vorlagen wiederherstellen, nicht nur reaktivieren: Ein Test ändert den
  // Text absichtlich, und der nächste prüfte sonst gegen eine verbogene
  // Vorlage. Genau das ist hier einmal passiert.
  await direkt('delete from vorlage')
  await direkt('select app.vorlagen_grundbestand(m.id) from mandant m')
  versandZuruecksetzen()
})

afterAll(poolSchliessen)

describe('Platzhalter', () => {
  it('setzt bekannte Werte ein', () => {
    const befund = vorlageFuellen('Rechnung {{rechnungsnummer}} von {{kreditor}}', {
      rechnungsnummer: 'RE-1',
      kreditor: 'Muster GmbH',
    })
    expect(befund.text).toBe('Rechnung RE-1 von Muster GmbH')
    expect(befund.unbekannt).toEqual([])
  })

  it('laesst einen unbekannten Platzhalter stehen', () => {
    // Die unbequemere Wahl und die richtige: Ein Tippfehler faellt beim
    // ersten Blick auf, statt einer Bank eine Mail mit einer Luecke zu
    // schicken.
    const befund = vorlageFuellen('Hallo {{krediitor}}', { kreditor: 'Muster' })
    expect(befund.text).toBe('Hallo {{krediitor}}')
    expect(befund.unbekannt).toEqual(['krediitor'])
  })

  it('macht aus einem bekannten, aber leeren Platzhalter einen Strich', () => {
    const befund = vorlageFuellen('Betrag {{betrag}}', {})
    expect(befund.text).toBe('Betrag —')
    expect(befund.leer).toEqual(['betrag'])
  })

  it('vertraegt Leerzeichen in den Klammern', () => {
    expect(vorlageFuellen('{{ kreditor }}', { kreditor: 'Muster' }).text).toBe('Muster')
  })

  it('setzt denselben Platzhalter mehrfach ein', () => {
    expect(vorlageFuellen('{{objekt}} / {{objekt}}', { objekt: '42' }).text).toBe('42 / 42')
  })

  it('kennt den Belegtext nicht -- mit Absicht', () => {
    // Was nicht in der Weissliste steht, laesst sich nicht einsetzen. Der
    // Belegtext, die IBAN und der Kontierungsstand fehlen bewusst.
    expect('belegtext' in PLATZHALTER).toBe(false)
    expect('iban' in PLATZHALTER).toBe(false)
    expect(vorlageFuellen('{{belegtext}}', {}).unbekannt).toEqual(['belegtext'])
  })

  it('meldet unbekannte Namen beim Pruefen einer Vorlage', () => {
    expect(vorlagePruefen('Betreff {{objekt}}', 'Text {{unfug}}')).toEqual(['unfug'])
    expect(vorlagePruefen('{{objekt}}', '{{kreditor}} {{betrag}}')).toEqual([])
  })
})

describe('Vorlagen im Bestand', () => {
  it('hat jeder Mandant', async () => {
    // Der erste Entwurf legte sie per INSERT beim Migrieren an -- und fand
    // keinen Mandanten, weil der Seed danach laeuft. Jetzt haengt ein Trigger
    // am Mandanten.
    const vorlagen = await vorlagenLaden(ANNA)
    expect(vorlagen.map((v) => v.schluessel).sort()).toEqual([
      'abtretung',
      'einsicht_link',
      'technikmeldung',
      'zahlungsauftrag',
    ])
  })

  it('bekommt auch ein neuer Mandant', async () => {
    const [neu] = await direkt<{ id: string }>(
      `insert into mandant (name) values ('Postausgangstest') returning id`,
    )
    try {
      const [zaehlung] = await direkt<{ n: string }>(
        'select count(*) n from vorlage where mandant_id = $1',
        [neu.id],
      )
      expect(Number(zaehlung.n)).toBe(4)
    } finally {
      await direkt('delete from vorlage where mandant_id = $1', [neu.id])
      await direkt('delete from mandant where id = $1', [neu.id])
    }
  })

  it('sind je Mandant getrennt', async () => {
    const meine = await vorlagenLaden(ANNA)
    const fremde = await vorlagenLaden(DORIS)
    expect(meine.length).toBe(4)
    expect(fremde.length).toBe(4)
    // Verschiedene Zeilen, gleiche Schluessel.
    expect(meine.map((v) => v.id).some((id) => fremde.map((f) => f.id).includes(id))).toBe(
      false,
    )
  })
})

describe('Ausgang anlegen', () => {
  it('fuellt Betreff und Text aus der Vorlage', async () => {
    await anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: { rechnungsnummer: 'RE-2026-0001', kreditor: 'Muster GmbH', betrag: '1190,00 EUR' },
    })

    const [eintrag] = await direkt<{ betreff: string; text: string }>(
      'select betreff, text from ausgang',
    )
    expect(eintrag.betreff).toBe('Zahlungsauftrag RE-2026-0001')
    expect(eintrag.text).toContain('Muster GmbH')
    expect(eintrag.text).toContain('1190,00 EUR')
  })

  it('haelt den fertigen Text fest, nicht die Vorlage', async () => {
    // Wer spaeter fragt "was stand da drin", bekommt eine Antwort -- auch
    // wenn die Vorlage seither geaendert wurde.
    await anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: { rechnungsnummer: 'RE-ALT' },
    })
    await direkt(`update vorlage set text = 'ganz anders' where schluessel = 'zahlungsauftrag'`)

    const [eintrag] = await direkt<{ text: string }>('select text from ausgang')
    expect(eintrag.text).not.toBe('ganz anders')
    expect(eintrag.text).toContain('RE-ALT')
  })

  it('weist eine fehlende Vorlage ab', async () => {
    await expect(
      anlegen({
        schluessel: 'gibt_es_nicht',
        anlass: 'zahlung',
        empfaenger: 'bank@example.invalid',
        werte: {},
      }),
    ).rejects.toBeInstanceOf(PostAbgelehnt)
  })

  it('weist eine abgeschaltete Vorlage ab', async () => {
    await direkt(`update vorlage set aktiv = false where schluessel = 'abtretung'`)
    await expect(
      anlegen({
        schluessel: 'abtretung',
        anlass: 'abtretung',
        empfaenger: 'firma@example.invalid',
        werte: {},
      }),
    ).rejects.toBeInstanceOf(PostAbgelehnt)
  })

  it('weist einen Ausgang ohne Empfaenger ab', async () => {
    await expect(
      anlegen({
        schluessel: 'zahlungsauftrag',
        anlass: 'zahlung',
        empfaenger: '   ',
        werte: {},
      }),
    ).rejects.toThrow(/Empfaenger/)
  })
})

describe('Senden', () => {
  async function eintrag(): Promise<string> {
    return anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: { rechnungsnummer: 'RE-1' },
    })
  }

  it('sendet, was offen ist', async () => {
    await eintrag()
    const versand = new MerkVersand()
    const ergebnis = await postSenden(ablage, versand)

    expect(ergebnis).toEqual({ gesendet: 1, gescheitert: 0 })
    expect(versand.gesendet[0].an).toBe('bank@example.invalid')
    expect(versand.gesendet[0].betreff).toBe('Zahlungsauftrag RE-1')
  })

  it('vermerkt den Erfolg', async () => {
    await eintrag()
    await postSenden(ablage, new MerkVersand())
    const [z] = await direkt<{ status: string; versuche: number; gesendet_am: unknown }>(
      'select status, versuche, gesendet_am from ausgang',
    )
    expect(z.status).toBe('gesendet')
    expect(z.versuche).toBe(1)
    expect(z.gesendet_am).not.toBeNull()
  })

  it('sendet nichts zweimal', async () => {
    await eintrag()
    await postSenden(ablage, new MerkVersand())
    const zweiter = new MerkVersand()
    expect(await postSenden(ablage, zweiter)).toEqual({ gesendet: 0, gescheitert: 0 })
    expect(zweiter.gesendet).toHaveLength(0)
  })

  it('sendet gar nicht, wenn kein Versand eingerichtet ist', async () => {
    await eintrag()
    expect(await postSenden(ablage, null)).toEqual({ gesendet: 0, gescheitert: 0 })
    // Der Eintrag bleibt offen und sichtbar -- er gilt nicht als gesendet.
    const [z] = await direkt<{ status: string }>('select status from ausgang')
    expect(z.status).toBe('offen')
  })

  it('haelt einen Fehlschlag mit Grund fest', async () => {
    await eintrag()
    const kaputt = {
      async senden(): Promise<void> {
        throw new Error('Verbindung abgelehnt')
      },
    }
    expect(await postSenden(ablage, kaputt)).toEqual({ gesendet: 0, gescheitert: 1 })

    const [z] = await direkt<{ status: string; fehler: string; versuche: number }>(
      'select status, fehler, versuche from ausgang',
    )
    expect(z.status).toBe('fehlgeschlagen')
    expect(z.fehler).toContain('Verbindung abgelehnt')
    expect(z.versuche).toBe(1)
  })

  it('wiederholt einen Fehlschlag nicht von selbst', async () => {
    // Ein Mailserver, der ablehnt, lehnt in der naechsten Sekunde wieder ab.
    // Wiederholt wird auf Ansage -- sonst laeuft ein Zaehler hoch, den
    // niemand ansieht.
    await eintrag()
    await postSenden(ablage, {
      async senden(): Promise<void> {
        throw new Error('abgelehnt')
      },
    })
    const zweiter = new MerkVersand()
    expect(await postSenden(ablage, zweiter)).toEqual({ gesendet: 0, gescheitert: 0 })
  })

  it('laesst sich auf Ansage wiederholen', async () => {
    const id = await eintrag()
    await postSenden(ablage, {
      async senden(): Promise<void> {
        throw new Error('abgelehnt')
      },
    })

    expect(await postWiederholen(ANNA, id)).toBe(true)
    const versand = new MerkVersand()
    expect(await postSenden(ablage, versand)).toEqual({ gesendet: 1, gescheitert: 0 })

    const [z] = await direkt<{ versuche: number }>('select versuche from ausgang')
    expect(z.versuche).toBe(2)
  })

  it('wiederholt einen bereits gesendeten nicht', async () => {
    const id = await eintrag()
    await postSenden(ablage, new MerkVersand())
    expect(await postWiederholen(ANNA, id)).toBe(false)
  })

  it('nimmt den Anhang mit', async () => {
    await anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: { rechnungsnummer: 'RE-1' },
      anhang: { schluessel: 'irgendwo/zahlung.csv', name: 'zahlung.csv' },
    })
    const versand = new MerkVersand()
    await postSenden(ablage, versand)
    expect(versand.gesendet[0].anhang?.name).toBe('zahlung.csv')
    expect(versand.gesendet[0].anhang?.inhalt.toString('utf8')).toContain('Empfaenger')
  })

  it('scheitert sichtbar, wenn der Anhang fehlt', async () => {
    await anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: {},
      anhang: { schluessel: 'fehlt', name: 'weg.csv' },
    })
    expect(await postSenden(ablage, new MerkVersand())).toEqual({
      gesendet: 0,
      gescheitert: 1,
    })
  })
})

describe('Einrichtung', () => {
  const vorher = { ...process.env }

  afterEach(() => {
    process.env = { ...vorher }
    versandZuruecksetzen()
  })

  it('liefert ohne SMTP_URL keinen Versand', () => {
    delete process.env['SMTP_URL']
    versandZuruecksetzen()
    expect(versandAusUmgebung()).toBeNull()
  })

  it('liefert ohne Absender keinen Versand', () => {
    // Halb eingerichtet ist nicht eingerichtet: Ohne Absenderadresse weist
    // jeder Mailserver die Nachricht ohnehin ab.
    process.env['SMTP_URL'] = 'smtp://localhost:1025'
    delete process.env['DMS_ABSENDER']
    versandZuruecksetzen()
    expect(versandAusUmgebung()).toBeNull()
  })

  it('liefert mit beidem einen Versand', () => {
    process.env['SMTP_URL'] = 'smtp://localhost:1025'
    process.env['DMS_ABSENDER'] = 'dms@example.invalid'
    versandZuruecksetzen()
    expect(versandAusUmgebung()).not.toBeNull()
  })
})

describe('Die Mandantengrenze', () => {
  it('zeigt einem fremden Mandanten den Ausgang nicht', async () => {
    await anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: {},
    })
    expect(await ausgangsbuchLaden(DORIS)).toEqual([])
    expect((await ausgangsbuchLaden(ANNA)).length).toBe(1)
  })

  it('laesst einen Fremden nicht wiederholen', async () => {
    const id = await anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: {},
    })
    await postSenden(ablage, {
      async senden(): Promise<void> {
        throw new Error('abgelehnt')
      },
    })
    expect(await postWiederholen(DORIS, id)).toBe(false)
  })
})

describe('Flüchtige Einträge', () => {
  it('entfernt den Text nach erfolgreichem Versand', async () => {
    const id = await anlegen({
      schluessel: 'einsicht_link',
      anlass: 'einsicht',
      empfaenger: 'mieter@example.invalid',
      fluechtig: true,
      werte: {
        empfaenger: 'M. Muster',
        link: 'https://dms.example.invalid/einsicht/GEHEIMER-TOKEN',
        gueltig_bis: '2026-09-07',
        objekt: '42 Testobjekt',
      },
    })

    const [vorher] = await direkt<{ text: string; fluechtig: boolean }>(
      'select text, fluechtig from ausgang where id = $1',
      [id],
    )
    expect(vorher.fluechtig).toBe(true)
    expect(vorher.text).toContain('GEHEIMER-TOKEN')

    const versand = new MerkVersand()
    await postSenden(ablage, versand)

    // Hinausgegangen ist der vollständige Link -- sonst wäre die Mail nutzlos.
    expect(versand.gesendet[0].text).toContain('GEHEIMER-TOKEN')

    const [nachher] = await direkt<{ text: string; status: string }>(
      'select text, status from ausgang where id = $1',
      [id],
    )
    expect(nachher.status).toBe('gesendet')
    expect(nachher.text).not.toContain('GEHEIMER-TOKEN')
    expect(nachher.text).toContain('entfernt')
  })

  it('behält den Text, solange der Versand scheitert', async () => {
    const id = await anlegen({
      schluessel: 'einsicht_link',
      anlass: 'einsicht',
      empfaenger: 'mieter@example.invalid',
      fluechtig: true,
      werte: { empfaenger: 'M. Muster', link: 'https://x.invalid/einsicht/TOKEN' },
    })

    await postSenden(ablage, {
      async senden() {
        throw new Error('Mailserver nicht erreichbar')
      },
    })

    // Ohne Text wäre die Wiederholung sinnlos: Sie ginge leer hinaus.
    const [nachher] = await direkt<{ text: string; status: string }>(
      'select text, status from ausgang where id = $1',
      [id],
    )
    expect(nachher.status).toBe('fehlgeschlagen')
    expect(nachher.text).toContain('TOKEN')

    expect(await postWiederholen(ANNA, id)).toBe(true)
  })

  it('lässt gewöhnliche Einträge unangetastet', async () => {
    const id = await anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: 'bank@example.invalid',
      dokumentId: D1,
      werte: { rechnungsnummer: 'RE-2026-0001', betrag: '100,00 EUR' },
    })

    await postSenden(ablage, new MerkVersand())

    const [nachher] = await direkt<{ text: string }>(
      'select text from ausgang where id = $1',
      [id],
    )
    expect(nachher.text).toContain('RE-2026-0001')
  })
})
