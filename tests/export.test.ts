/**
 * Tests des Belegexports (Konzept 16).
 *
 * Der wichtigste Test hier misst nach, was man einem PDF nicht ansieht:
 * **ob unter der Schwärzung noch Text steht.** Ein schwarzes Rechteck sieht
 * in jedem Betrachter gleich aus — der Unterschied zeigt sich erst, wenn
 * jemand markiert und kopiert. Genau so sind Behörden und Kanzleien
 * aufgefallen.
 *
 * Deshalb wird das erzeugte PDF wieder gelesen und der Text geprüft.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { pdfBauen } from './hilfe/pdf-bauen'
import type { Ablage } from '../src/ablage'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { laufStarten } from '../src/workflow/engine'
import { belegExportieren, ExportAbgelehnt } from '../src/export'
import { seitenLesen } from '../src/ingest/pdf'
import { layerAnlegen } from '../src/layer'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const SACHLICH_RICHTIG = '60000000-0000-0000-0000-000000000001'

/** Der Satz, der geschwärzt wird. Er darf im Export nirgends auftauchen. */
const GEHEIM = 'Kontoinhaber Meike Meier IBAN DE00 1234'

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

let dokumentId: string
let ablage: Merkablage

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
  ablage = new Merkablage()

  const pdf = await pdfBauen([
    {
      zeilen: [
        'Musterreinigung GmbH, Beispielweg 1, 00000 Musterstadt',
        'Rechnung RE-EXPORT-1 vom 01.09.2026',
        GEHEIM,
        'Netto 1.000,00 EUR zuzueglich 19 Prozent Umsatzsteuer',
      ],
    },
    { zeilen: ['Zahlbar innerhalb von 14 Tagen.'] },
  ])

  const [d] = await direkt<{ id: string }>(
    `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                           inhalt_hash, storage_praefix, status, seitenzahl)
     values ($1, $2, 'rechnung', 'upload', 'hash-export-test',
             'test/export', 'laufend', 2)
     returning id`,
    [MANDANT, OBJEKT_42],
  )
  dokumentId = d.id

  await ablage.schreiben('test/export/original.pdf', pdf)
  await direkt(
    `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
     values ($1, 'original', 'test/export/original.pdf', 'application/pdf', $2)`,
    [dokumentId, pdf.byteLength],
  )

  // Ein eigener Lauf: Der Stempel-Trigger haengt am Ereignis, das Ereignis
  // am Lauf. Ohne eigenen Lauf landete der Stempel am Beleg eines anderen.
  await alsBenutzer(ANNA, (c) => laufStarten(c, dokumentId))

  // Seitentext und Seitenbilder -- wie nach einer Aufbereitung.
  const seiten = await seitenLesen(pdf)
  for (const s of seiten) {
    await direkt(
      `insert into dokument_seite (dokument_id, seite, text, breite, hoehe, freie_bloecke)
       values ($1, $2, $3, $4, $5, case when $2 = 1 then $6::jsonb else null end)`,
      [
        dokumentId,
        s.seite,
        s.text,
        s.breite,
        s.hoehe,
        JSON.stringify([{ x: 393, y: 12, breite: 190, hoehe: 64 }]),
      ],
    )
    // Ein einfarbiges WebP genuegt: Geprueft wird die Schwaerzung, nicht die
    // Bildqualitaet.
    const { createCanvas } = await import('@napi-rs/canvas')
    const leinwand = createCanvas(Math.round(s.breite), Math.round(s.hoehe))
    const stift = leinwand.getContext('2d')
    stift.fillStyle = '#ffffff'
    stift.fillRect(0, 0, leinwand.width, leinwand.height)
    const schluessel = `test/export/ansicht/${s.seite}-lesen.webp`
    await ablage.schreiben(schluessel, leinwand.toBuffer('image/webp'))
    await direkt(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse, seite)
       values ($1, 'ansicht_webp', $2, 'image/webp', 1, $3)`,
      [dokumentId, schluessel, s.seite],
    )
  }
})

afterEach(async () => {
  await belegEntfernen(dokumentId)
})

afterAll(poolSchliessen)

/** Der Text aller Seiten des erzeugten PDF. */
async function textVon(pdf: Buffer): Promise<string> {
  const seiten = await seitenLesen(pdf)
  return seiten.map((s) => s.text).join('\n')
}

describe('Archivoriginal', () => {
  it('gibt die Datei unveraendert heraus', async () => {
    const original = await ablage.lesen('test/export/original.pdf')
    const { pdf } = await belegExportieren(ANNA, ablage, {
      dokumentId,
      variante: 'archiv',
    })

    // Byte fuer Byte: Sonst stimmt der Hash im Archiv nicht mehr, und dann
    // ist das Archiv eine Behauptung (Konzept 19).
    expect(pdf).toEqual(original)
  })

  it('bleibt auch dann das Original, wenn geschwaerzt wurde', async () => {
    await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'schwaerzung',
      seite: 1,
      x: 55,
      y: 60,
      breite: 400,
      hoehe: 18,
    })

    const original = await ablage.lesen('test/export/original.pdf')
    const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante: 'archiv' })
    expect(pdf).toEqual(original)
  })
})

describe('Beleg mit Stempeln', () => {
  beforeEach(async () => {
    /*
     * Der Stempel entsteht aus seinem Ereignis -- der Trigger zeichnet ihn
     * (Konzept 16). Ein Layer von Hand waere hier der zweite und liefe in
     * den eindeutigen Index; genau das ist beim ersten Entwurf passiert.
     */
    await direkt(
      `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, stempeltyp_id,
                                    entscheidung, eintrag_hash)
       select l.id, a.stufe_id, $1, $2, 'freigabe', 'test-export'
         from dokument_lauf l
         join aufgabe a on a.lauf_id = l.id
        where l.dokument_id = $3
        limit 1`,
      [ANNA, SACHLICH_RICHTIG, dokumentId],
    )
  })

  it('zeichnet den Stempel auf den Beleg', async () => {
    const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante: 'stempel' })
    const text = await textVon(pdf)

    expect(text).toContain('Anna Ahrens')
    // Und der Beleg selbst ist noch da -- gezeichnet wird daneben, nicht
    // darueber.
    expect(text).toContain('RE-EXPORT-1')
  })

  it('ersetzt Zeichen, die die Standardschrift nicht kennt', async () => {
    // "·" gibt es in WinAnsi nicht. Ohne Ersetzung wirft pdf-lib -- und zwar
    // erst dann, wenn ein Stempeltext zufaellig eines enthaelt. Genau das
    // tut jeder Stempeltext dieses Systems.
    const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante: 'stempel' })
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it('nimmt keine Notiz mit', async () => {
    await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'notiz',
      seite: 1,
      x: 60,
      y: 300,
      breite: 200,
      hoehe: 30,
      text: 'Interner Vermerk zur Rueckfrage',
    })

    const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante: 'stempel' })
    expect(await textVon(pdf)).not.toContain('Interner Vermerk')
  })
})

describe('Stempel ohne Platz auf der Seite', () => {
  beforeEach(async () => {
    // Seite 1 hat keine freien Plaetze mehr -- dann setzt der Trigger den
    // Layer auf Seite 0: "gehoert auf eine angehaengte Leerseite".
    await direkt(`update dokument_seite set freie_bloecke = '[]'::jsonb where dokument_id = $1`, [
      dokumentId,
    ])
    await direkt(
      `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, stempeltyp_id,
                                    entscheidung, eintrag_hash)
       select l.id, a.stufe_id, $1, $2, 'freigabe', 'test-leerseite'
         from dokument_lauf l
         join aufgabe a on a.lauf_id = l.id
        where l.dokument_id = $3
        limit 1`,
      [ANNA, SACHLICH_RICHTIG, dokumentId],
    )
  })

  it('haengt eine Seite an und schreibt den Stempel darauf', async () => {
    const vorher = (await seitenLesen(await ablage.lesen('test/export/original.pdf'))).length
    const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante: 'stempel' })
    const seiten = await seitenLesen(pdf)

    /*
     * Ohne diese Seite waere der Stempel im Export unsichtbar — der Beleg
     * zeigte dann weniger, als das Protokoll sagt. Ein Stempel darf nie
     * verloren gehen, nur weil die Seite voll ist (Konzept 16).
     */
    expect(seiten.length).toBe(vorher + 1)
    expect(seiten.at(-1)?.text).toContain('Stempel ohne Platz')
    expect(seiten.at(-1)?.text).toContain('Anna Ahrens')
  })

  it('nimmt die Masse der letzten Seite', async () => {
    const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante: 'stempel' })
    const seiten = await seitenLesen(pdf)

    // Sonst wirkt die Anlage wie ein fremdes Blatt im Stapel.
    expect(seiten.at(-1)?.breite).toBe(seiten[0].breite)
    expect(seiten.at(-1)?.hoehe).toBe(seiten[0].hoehe)
  })
})

describe('Schwaerzung', () => {
  beforeEach(async () => {
    await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'schwaerzung',
      seite: 1,
      x: 55,
      y: 55,
      breite: 420,
      hoehe: 20,
    })
  })

  it('entfernt den Text darunter wirklich', async () => {
    const { pdf } = await belegExportieren(ANNA, ablage, {
      dokumentId,
      variante: 'extern',
      empfaenger: 'Meike Meier',
    })

    /*
     * **Der Kern der Sache.** Ein schwarzes Rechteck ueber Text sieht aus
     * wie eine Schwaerzung und ist keine: Der Text bleibt markierbar. Hier
     * wird das erzeugte PDF wieder gelesen -- das Geheimnis darf nirgends
     * mehr stehen.
     */
    const text = await textVon(pdf)
    expect(text).not.toContain('Meike Meier IBAN')
    expect(text).not.toContain('DE00 1234')

    // Und zwar, weil gar kein Belegtext mehr drin ist: Die Seiten sind
    // Bilder geworden.
    expect(text).not.toContain('RE-EXPORT-1')
  })

  it('zwingt auch die Stempelvariante in den Bilderweg', async () => {
    /*
     * `stempel` zeigt Schwaerzungen gar nicht. Ohne diese Regel gaebe es
     * damit einen Weg zu einem PDF, in dem das Geschwaerzte im Klartext
     * steht -- einen Klick entfernt.
     */
    const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante: 'stempel' })
    expect(await textVon(pdf)).not.toContain('DE00 1234')
  })

  it('verweigert den Export, wenn keine Seitenbilder vorliegen', async () => {
    await direkt(
      `delete from dokument_datei where dokument_id = $1 and variante = 'ansicht_webp'`,
      [dokumentId],
    )

    // Lieber gar kein Export als einer, in dem das Geschwaerzte lesbar ist.
    await expect(
      belegExportieren(ANNA, ablage, { dokumentId, variante: 'extern' }),
    ).rejects.toThrow(ExportAbgelehnt)
  })
})

describe('Wasserzeichen', () => {
  it('traegt Empfaenger und Datum', async () => {
    const { pdf } = await belegExportieren(ANNA, ablage, {
      dokumentId,
      variante: 'extern',
      empfaenger: 'Meike Meier',
    })

    const text = await textVon(pdf)
    expect(text).toContain('Meike Meier')
    expect(text).toContain(new Date().toISOString().slice(0, 10))
  })

  it('fehlt bei den internen Varianten', async () => {
    for (const variante of ['stempel', 'intern'] as const) {
      const { pdf } = await belegExportieren(ANNA, ablage, { dokumentId, variante })
      expect(await textVon(pdf)).not.toContain(new Date().toISOString().slice(0, 10))
    }
  })
})

describe('Mandantengrenze', () => {
  it('gibt Doris keinen Export eines fremden Belegs', async () => {
    await expect(
      belegExportieren(DORIS, ablage, { dokumentId, variante: 'archiv' }),
    ).rejects.toThrow(ExportAbgelehnt)
  })
})

describe('Ohne Datei', () => {
  it('sagt, dass es nichts auszugeben gibt', async () => {
    await direkt(`delete from dokument_datei where dokument_id = $1`, [dokumentId])

    await expect(
      belegExportieren(ANNA, ablage, { dokumentId, variante: 'stempel' }),
    ).rejects.toThrow(/keine Datei/)
  })
})
