/**
 * Tests der Stempelplatzierung.
 *
 * Konzept 16 stellt eine Bedingung, die alles andere schlägt: **Kein Stempel
 * überdeckt Text.** Ein Stempel über dem Rechnungsbetrag macht aus einer
 * Prüfung eine Behauptung, und weil das Original nie verändert wird, fiele
 * es erst beim Export auf.
 *
 * Reine Rechnung, also reine Tests: keine Datenbank, kein PDF, nur Kästen.
 */

import { describe, expect, it } from 'vitest'
import {
  freieBloecke,
  STEMPEL_BREITE,
  STEMPEL_HOEHE,
  ueberschneidet,
  type Kasten,
} from '../src/layer/platzierung'

/** DIN A4 in PDF-Punkten. */
const BREITE = 595
const HOEHE = 842

/** Eine Zeile Text, wie `seitenLesen` sie liefert: Ursprung oben links. */
function zeile(y: number, x = 60, breite = 400): Kasten {
  return { x, y, breite, hoehe: 12 }
}

describe('Freie Bloecke', () => {
  it('findet auf einer leeren Seite Platz', () => {
    const bloecke = freieBloecke(BREITE, HOEHE, [])
    expect(bloecke.length).toBeGreaterThan(0)
  })

  it('legt den ersten Stempel rechts oben', () => {
    const [erster] = freieBloecke(BREITE, HOEHE, [])

    // Rechte Haelfte, obere Haelfte -- so steht es im Konzept.
    expect(erster.x + erster.breite).toBeGreaterThan(BREITE / 2)
    expect(erster.y).toBeLessThan(HOEHE / 2)
    // Und am Rand, nicht frei schwebend.
    expect(BREITE - (erster.x + erster.breite)).toBeLessThanOrEqual(20)
    expect(erster.y).toBeLessThanOrEqual(20)
  })

  it('ueberdeckt keinen Text', () => {
    // Ein Brief: Kopf, Anschrift, Fliesstext ueber die halbe Seite.
    const text: Kasten[] = []
    for (let y = 40; y < 500; y += 20) text.push(zeile(y))

    for (const block of freieBloecke(BREITE, HOEHE, text)) {
      for (const t of text) {
        expect(ueberschneidet(block, t)).toBe(false)
      }
    }
  })

  it('weicht nach unten aus, wenn oben rechts Text steht', () => {
    // Ein Absenderblock oben rechts, wie ihn viele Rechnungen haben.
    const text: Kasten[] = []
    for (let y = 30; y < 200; y += 16) text.push(zeile(y, 330, 230))

    const [erster] = freieBloecke(BREITE, HOEHE, text)
    expect(erster).toBeDefined()
    for (const t of text) expect(ueberschneidet(erster, t)).toBe(false)
  })

  it('gibt sich ueberschneidungsfreie Plaetze', () => {
    const bloecke = freieBloecke(BREITE, HOEHE, [])
    for (let i = 0; i < bloecke.length; i += 1) {
      for (let j = i + 1; j < bloecke.length; j += 1) {
        // Zwei Stempel duerfen sich so wenig ueberdecken wie ein Stempel den
        // Text -- sonst waere der zweite unlesbar.
        expect(ueberschneidet(bloecke[i], bloecke[j])).toBe(false)
      }
    }
  })

  it('liefert nichts, wenn die Seite voll ist', () => {
    const voll: Kasten[] = []
    for (let y = 0; y < HOEHE; y += 20) voll.push({ x: 0, y, breite: BREITE, hoehe: 18 })

    // Nichts heisst: Leerseite anhaengen. Es heisst nicht, den Stempel
    // irgendwohin zu setzen.
    expect(freieBloecke(BREITE, HOEHE, voll)).toEqual([])
  })

  it('liefert nichts, wenn die Seite kleiner ist als ein Stempel', () => {
    expect(freieBloecke(100, 100, [])).toEqual([])
  })

  it('haelt Abstand zum Seitenrand', () => {
    for (const block of freieBloecke(BREITE, HOEHE, [])) {
      expect(block.x).toBeGreaterThanOrEqual(0)
      expect(block.y).toBeGreaterThanOrEqual(0)
      expect(block.x + block.breite).toBeLessThanOrEqual(BREITE)
      expect(block.y + block.hoehe).toBeLessThanOrEqual(HOEHE)
    }
  })

  it('haelt Abstand zum Text, nicht nur Beruehrungsfreiheit', () => {
    // Eine einzelne Zeile quer ueber die Seite, in der oberen Haelfte.
    const t = { x: 0, y: 100, breite: BREITE, hoehe: 12 }
    for (const block of freieBloecke(BREITE, HOEHE, [t])) {
      const abstandOben = t.y - (block.y + block.hoehe)
      const abstandUnten = block.y - (t.y + t.hoehe)
      // Einer der beiden Abstaende ist positiv, und zwar spuerbar -- ein
      // Stempel, der die Zeile beruehrt, sieht aus wie ein Druckfehler.
      expect(Math.max(abstandOben, abstandUnten)).toBeGreaterThanOrEqual(4)
    }
  })

  it('rechnet auch eine dicht bedruckte Seite schnell genug', () => {
    // 900 Textstuecke, mehr als eine echte Rechnung hat.
    const dicht: Kasten[] = []
    for (let y = 30; y < 800; y += 14) {
      for (let x = 40; x < 520; x += 60) dicht.push({ x, y, breite: 50, hoehe: 10 })
    }

    const begonnen = Date.now()
    freieBloecke(BREITE, HOEHE, dicht)
    // Laeuft einmal je Beleg bei der Aufbereitung. Ohne die summierte
    // Flaechentabelle waere das ein Vielfaches.
    expect(Date.now() - begonnen).toBeLessThan(200)
  })

  it('nimmt eigene Masse an', () => {
    const gross = { breite: 400, hoehe: 200 }
    for (const block of freieBloecke(BREITE, HOEHE, [], gross)) {
      expect(block.breite).toBe(gross.breite)
      expect(block.hoehe).toBe(gross.hoehe)
    }
  })

  it('benutzt die Vorgabemasse eines Stempels', () => {
    const [erster] = freieBloecke(BREITE, HOEHE, [])
    expect(erster.breite).toBe(STEMPEL_BREITE)
    expect(erster.hoehe).toBe(STEMPEL_HOEHE)
  })
})
