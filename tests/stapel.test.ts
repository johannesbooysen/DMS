/**
 * Tests des Posteingangs mit Belegtrennung.
 *
 * Konzept 24.1 nennt den Grund für die ganze Bauart: „Nachträglich
 * unangenehm, weil Seiten und Hashes dann schon geschrieben sind." Der
 * wichtigste Test hier prüft genau das — **bis zur Übernahme entsteht kein
 * Dokument**, und danach hat jeder Beleg seinen eigenen Hash, nicht den der
 * Scandatei.
 *
 * Der zweite Schwerpunkt ist die Trennung selbst. Sie ist rein rechnerisch
 * und lässt sich deshalb an erfundenen Texten prüfen — die interessanten
 * Fälle sind die Grenzfälle, und für die braucht es keinen Scanner.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { pdfBauen } from './hilfe/pdf-bauen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import type { Ablage } from '../src/ablage'
import { inhaltHash } from '../src/ablage'
import {
  belegeGruppieren,
  istTrennblatt,
  offeneStapel,
  StapelAbgelehnt,
  stapelAufnehmen,
  stapelLaden,
  stapelUebernehmen,
  stapelVerwerfen,
  trennungAendern,
  trennungVorschlagen,
} from '../src/stapel'
import { stapelAufbereiten } from '../src/worker/stapelaufbereitung'
import { alsSystem } from '../src/db'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'

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

/**
 * Nimmt auf **und** bereitet auf.
 *
 * Im Betrieb liegt dazwischen die Warteschlange: Der Request legt den Stapel
 * an, der Worker liest und rendert. Der Test nimmt den Worker selbst in die
 * Hand, damit er nicht auf einen zweiten Prozess wartet.
 */
async function stapelAnlegen(
  ablage: Merkablage,
  eingang: { dateiname: string; inhalt: Buffer; eingangskanal?: 'scan' | 'upload' },
): Promise<string> {
  const id = await stapelAufnehmen(ANNA, ablage, {
    mandantId: MANDANT,
    dateiname: eingang.dateiname,
    eingangskanal: eingang.eingangskanal ?? 'scan',
    inhalt: eingang.inhalt,
  })
  await alsSystem(ANNA, (c) => stapelAufbereiten(c, ablage, id))
  return id
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

const angelegteBelege: string[] = []

/** Drei Belege, getrennt durch zwei Trennblätter — sechs Seiten. */
async function stapelPdf(): Promise<Buffer> {
  return pdfBauen([
    { zeilen: ['Musterreinigung GmbH', 'Rechnung RE-A vom 01.02.2026', 'Betrag 119,00 EUR'] },
    { zeilen: ['Seite zwei der Rechnung RE-A'] },
    { zeilen: ['Trennblatt'] },
    { zeilen: ['Elektro Blitz e.K.', 'Rechnung RE-B vom 02.02.2026'] },
    { zeilen: ['Trennblatt'] },
    { zeilen: ['Gartenbau Gruen', 'Rechnung RE-C vom 03.02.2026'] },
  ])
}

afterEach(async () => {
  for (const id of angelegteBelege.splice(0)) await belegEntfernen(id)
  await direkt('delete from stapel')
})

afterAll(poolSchliessen)

describe('Trennblatt erkennen', () => {
  it('erkennt eine fast leere Seite mit dem Wort', () => {
    expect(istTrennblatt('Trennblatt').trenner).toBe(true)
    expect(istTrennblatt('  TRENNSEITE  ').trenner).toBe(true)
    expect(istTrennblatt('Separator Sheet').trenner).toBe(true)
  })

  it('nennt den Grund', () => {
    expect(istTrennblatt('Trennblatt').grund).toMatch(/Trennblatt/)
  })

  it('erkennt eine Rechnung nicht als Trennblatt', () => {
    expect(istTrennblatt('Rechnung RE-2026-0001 ueber Hausreinigung').trenner).toBe(false)
  })

  it('faellt nicht auf das Wort mitten in einer langen Rechnung herein', () => {
    // Eine Druckereirechnung kann "Trennblatt" als Position fuehren. Ohne die
    // Laengenschranke zerlegte genau sie den Stapel an der falschen Stelle.
    const lang = `Rechnung der Druckerei. ${'Position Trennblatt DIN A4 weiss. '.repeat(20)}`
    expect(lang.length).toBeGreaterThan(400)
    expect(istTrennblatt(lang).trenner).toBe(false)
  })

  it('vertraegt eine Seite ohne Text', () => {
    expect(istTrennblatt(null).trenner).toBe(false)
    expect(istTrennblatt('').trenner).toBe(false)
  })
})

describe('Gruppieren', () => {
  const befunde = (muster: boolean[]) =>
    trennungVorschlagen(
      muster.map((t, i) => ({ seite: i + 1, text: t ? 'Trennblatt' : 'Rechnung ueber etwas' })),
    )

  it('teilt an den Trennblaettern', () => {
    const gruppen = belegeGruppieren(befunde([false, false, true, false, true, false]))
    expect(gruppen).toEqual([
      { belegNr: 1, seiten: [1, 2] },
      { belegNr: 2, seiten: [4] },
      { belegNr: 3, seiten: [6] },
    ])
  })

  it('macht aus einem Stapel ohne Trennblatt einen Beleg', () => {
    expect(belegeGruppieren(befunde([false, false, false]))).toEqual([
      { belegNr: 1, seiten: [1, 2, 3] },
    ])
  })

  it('erzeugt keinen Phantombeleg, wenn der Stapel mit einem Trennblatt beginnt', () => {
    // Ohne diese Regel haette der erste echte Beleg die Nummer 2, und Beleg 1
    // waere leer.
    expect(belegeGruppieren(befunde([true, false, false]))).toEqual([
      { belegNr: 1, seiten: [2, 3] },
    ])
  })

  it('vertraegt zwei Trennblaetter hintereinander', () => {
    expect(belegeGruppieren(befunde([false, true, true, false]))).toEqual([
      { belegNr: 1, seiten: [1] },
      { belegNr: 2, seiten: [4] },
    ])
  })

  it('endet mit einem Trennblatt ohne leeren letzten Beleg', () => {
    expect(belegeGruppieren(befunde([false, true]))).toEqual([{ belegNr: 1, seiten: [1] }])
  })
})

describe('Stapel aufnehmen', () => {
  it('erkennt drei Belege in sechs Seiten', async () => {
    const ablage = new Merkablage()
    const id = await stapelAnlegen(ablage, {
      dateiname: 'scan-2026-08-31.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })

    const geladen = await stapelLaden(ANNA, id)
    expect(geladen?.kopf.seitenzahl).toBe(6)
    expect(geladen?.kopf.belege).toBe(3)
    expect(geladen?.kopf.status).toBe('pruefung')
  })

  it('legt **kein** Dokument an', async () => {
    // Der Kern von Konzept 24.1: Bis zur Uebernahme ist nichts geschrieben,
    // was zurueckgenommen werden muesste.
    const [vorher] = await direkt<{ n: string }>('select count(*) n from dokument')
    await stapelAnlegen(new Merkablage(), {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    const [nachher] = await direkt<{ n: string }>('select count(*) n from dokument')
    expect(nachher.n).toBe(vorher.n)
  })

  it('legt Miniaturen fuer die Korrekturansicht an', async () => {
    const ablage = new Merkablage()
    const id = await stapelAnlegen(ablage, {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    for (let seite = 1; seite <= 6; seite++) {
      expect(ablage.dateien.has(`stapel/${id}/seite-${seite}.webp`)).toBe(true)
    }
  })

  it('weist dieselbe Datei ein zweites Mal ab', async () => {
    const inhalt = await stapelPdf()
    const ablage = new Merkablage()
    await stapelAufnehmen(ANNA, ablage, {
      mandantId: MANDANT,
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt,
    })
    await expect(
      stapelAufnehmen(ANNA, ablage, {
        mandantId: MANDANT,
        dateiname: 'nochmal.pdf',
        eingangskanal: 'scan',
        inhalt,
      }),
    ).rejects.toBeInstanceOf(StapelAbgelehnt)
  })

  it('weist etwas ab, das kein PDF ist', async () => {
    await expect(
      stapelAufnehmen(ANNA, new Merkablage(), {
        mandantId: MANDANT,
        dateiname: 'bild.png',
        eingangskanal: 'scan',
        inhalt: Buffer.from('\x89PNG kein pdf'),
      }),
    ).rejects.toBeInstanceOf(StapelAbgelehnt)
  })
})

describe('Trennung korrigieren', () => {
  async function stapel() {
    return stapelAnlegen(new Merkablage(), {
      dateiname: 'scan.pdf',
      inhalt: await stapelPdf(),
    })
  }

  it('teilt einen Beleg auf, wenn eine Trennung dazukommt', async () => {
    const id = await stapel()
    // Seite 2 gehoert zu Beleg 1. Wird sie zum Trennblatt, faellt Beleg 1 auf
    // eine Seite zusammen und die uebrigen ruecken nach.
    expect(await trennungAendern(ANNA, id, 2, true)).toBe(3)

    const geladen = await stapelLaden(ANNA, id)
    const erste = geladen!.seiten.filter((s) => s.belegNr === 1).map((s) => s.seite)
    expect(erste).toEqual([1])
  })

  it('fuehrt zwei Belege zusammen, wenn eine Trennung wegfaellt', async () => {
    const id = await stapel()
    expect(await trennungAendern(ANNA, id, 3, false)).toBe(2)

    const geladen = await stapelLaden(ANNA, id)
    const erste = geladen!.seiten.filter((s) => s.belegNr === 1).map((s) => s.seite)
    // Seite 3 war das Trennblatt und gehoert nun zum ersten Beleg.
    expect(erste).toEqual([1, 2, 3, 4])
  })

  it('merkt sich, dass ein Mensch entschieden hat', async () => {
    const id = await stapel()
    await trennungAendern(ANNA, id, 2, true)
    const geladen = await stapelLaden(ANNA, id)
    const seite2 = geladen!.seiten.find((s) => s.seite === 2)
    expect(seite2?.quelle).toBe('mensch')
    // Die uebrigen bleiben automatisch -- der Unterschied ist die Grundlage
    // fuer die Frage, wie gut die Erkennung ist.
    expect(geladen!.seiten.find((s) => s.seite === 1)?.quelle).toBe('automatisch')
  })

  it('meldet eine Seite, die es nicht gibt', async () => {
    const id = await stapel()
    expect(await trennungAendern(ANNA, id, 99, true)).toBe(-1)
  })
})

describe('Uebernehmen', () => {
  it('legt je Beleg ein Dokument mit eigenem Hash an', async () => {
    const ablage = new Merkablage()
    const inhalt = await stapelPdf()
    const stapelHash = inhaltHash(inhalt)

    const id = await stapelAnlegen(ablage, { dateiname: 'scan.pdf', inhalt })

    const belege = await stapelUebernehmen(ANNA, ablage, id)
    for (const b of belege) angelegteBelege.push(b.dokumentId)

    expect(belege).toHaveLength(3)
    expect(belege.map((b) => b.belegNr)).toEqual([1, 2, 3])

    const hashes = await direkt<{ inhalt_hash: string }>(
      'select inhalt_hash from dokument where id = any($1)',
      [belege.map((b) => b.dokumentId)],
    )
    // Der entscheidende Punkt: Kein Beleg traegt den Hash der Scandatei.
    for (const h of hashes) expect(h.inhalt_hash).not.toBe(stapelHash)
    // Und alle drei sind verschieden.
    expect(new Set(hashes.map((h) => h.inhalt_hash)).size).toBe(3)
  })

  it('gibt jedem Beleg nur seine eigenen Seiten', async () => {
    const ablage = new Merkablage()
    const id = await stapelAnlegen(ablage, {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    const belege = await stapelUebernehmen(ANNA, ablage, id)
    for (const b of belege) angelegteBelege.push(b.dokumentId)

    const seiten = await direkt<{ dokument_id: string; storage_key: string }>(
      `select dokument_id, storage_key from dokument_datei
        where dokument_id = any($1) and variante = 'original'`,
      [belege.map((b) => b.dokumentId)],
    )
    expect(seiten).toHaveLength(3)

    // Beleg 1 hat zwei Seiten, Beleg 2 und 3 je eine.
    const { PDFDocument } = await import('pdf-lib')
    const groessen: number[] = []
    for (const b of belege) {
      const eintrag = seiten.find((s) => s.dokument_id === b.dokumentId)!
      const doc = await PDFDocument.load(await ablage.lesen(eintrag.storage_key))
      groessen.push(doc.getPageCount())
    }
    expect(groessen).toEqual([2, 1, 1])
  })

  it('setzt den Stapel auf uebernommen', async () => {
    const ablage = new Merkablage()
    const id = await stapelAnlegen(ablage, {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    const belege = await stapelUebernehmen(ANNA, ablage, id)
    for (const b of belege) angelegteBelege.push(b.dokumentId)

    expect((await stapelLaden(ANNA, id))?.kopf.status).toBe('uebernommen')
    expect((await offeneStapel(ANNA)).map((s) => s.stapelId)).not.toContain(id)
  })

  it('uebernimmt nicht zweimal', async () => {
    const ablage = new Merkablage()
    const id = await stapelAnlegen(ablage, {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    const belege = await stapelUebernehmen(ANNA, ablage, id)
    for (const b of belege) angelegteBelege.push(b.dokumentId)

    await expect(stapelUebernehmen(ANNA, ablage, id)).rejects.toBeInstanceOf(StapelAbgelehnt)
  })

  it('weigert sich, wenn jede Seite ein Trennblatt ist', async () => {
    const ablage = new Merkablage()
    const id = await stapelAnlegen(ablage, {
      dateiname: 'nur-trenner.pdf',
      eingangskanal: 'scan',
      inhalt: await pdfBauen([{ zeilen: ['Trennblatt'] }, { zeilen: ['Trennblatt'] }]),
    })
    await expect(stapelUebernehmen(ANNA, ablage, id)).rejects.toThrow(/keinen Beleg/)
  })
})

describe('Verwerfen', () => {
  it('braucht eine Begruendung', async () => {
    const id = await stapelAnlegen(new Merkablage(), {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    await expect(stapelVerwerfen(ANNA, id, '  ')).rejects.toBeInstanceOf(StapelAbgelehnt)
    expect(await stapelVerwerfen(ANNA, id, 'Doppelt eingescannt')).toBe(true)
    expect((await offeneStapel(ANNA)).map((s) => s.stapelId)).not.toContain(id)
  })
})

describe('Die Mandantengrenze', () => {
  it('zeigt einem fremden Mandanten den Stapel nicht', async () => {
    const id = await stapelAnlegen(new Merkablage(), {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    expect(await stapelLaden(DORIS, id)).toBeNull()
    expect(await offeneStapel(DORIS)).toEqual([])
  })

  it('laesst ihn auch nicht trennen', async () => {
    const id = await stapelAnlegen(new Merkablage(), {
      dateiname: 'scan.pdf',
      eingangskanal: 'scan',
      inhalt: await stapelPdf(),
    })
    expect(await trennungAendern(DORIS, id, 1, true)).toBe(-1)
  })
})

describe('Ein Stapel ohne Trennblatt', () => {
  it('wird ein Beleg mit allen Seiten', async () => {
    const ablage = new Merkablage()
    const id = await stapelAnlegen(ablage, {
      dateiname: 'einzeln.pdf',
      eingangskanal: 'upload',
      inhalt: await pdfBauen([
        { zeilen: ['Rechnung RE-Einzel'] },
        { zeilen: ['Seite zwei'] },
      ]),
    })
    expect((await stapelLaden(ANNA, id))?.kopf.belege).toBe(1)

    const belege = await stapelUebernehmen(ANNA, ablage, id)
    for (const b of belege) angelegteBelege.push(b.dokumentId)
    expect(belege).toHaveLength(1)
  })
})
