/**
 * Tests der Exportregeln (Konzept 16).
 *
 * Reine Rechnung, also reine Tests — keine Datenbank, kein PDF. Und genau
 * hier lohnt es sich: Die Regeln entscheiden, was das Haus verlässt. Ein
 * Fehler darin ist kein Anzeigefehler, sondern eine Auskunft an jemanden,
 * der sie nicht bekommen sollte.
 */

import { describe, expect, it } from 'vitest'
import {
  brauchtSeitenbilder,
  gehoertHinein,
  istVariante,
  VARIANTEN,
  type Exportvariante,
} from '../src/export/varianten'

const ALLE = Object.keys(VARIANTEN) as Exportvariante[]

describe('Archivoriginal', () => {
  it('traegt keinen einzigen Layer', () => {
    // Sonst stimmt der Hash im Archiv nicht mehr, und dann ist das Archiv
    // eine Behauptung (Konzept 19).
    expect(VARIANTEN.archiv.layer.size).toBe(0)
    expect(VARIANTEN.archiv.wasserzeichen).toBe(false)
  })

  it('bleibt auch bei Schwaerzungen das Original', () => {
    expect(brauchtSeitenbilder('archiv', true)).toBe(false)
  })
})

describe('Schwaerzung erzwingt Seitenbilder', () => {
  it('bei jeder Variante ausser dem Archivoriginal', () => {
    for (const v of ALLE) {
      expect(brauchtSeitenbilder(v, true)).toBe(v !== 'archiv')
    }
  })

  it('auch bei der Variante, die Schwaerzungen gar nicht zeigt', () => {
    /*
     * **Der wichtigste Fall.** `stempel` zeigt keine Schwaerzungen -- ohne
     * diese Regel gaebe es damit einen Weg zu einem PDF, in dem das
     * Geschwaerzte im Klartext steht. Einen Klick entfernt.
     */
    expect(VARIANTEN.stempel.layer.has('schwaerzung')).toBe(false)
    expect(brauchtSeitenbilder('stempel', true)).toBe(true)
  })

  it('ohne Schwaerzung bleibt es beim Original mit gezeichneten Layern', () => {
    for (const v of ALLE) {
      expect(brauchtSeitenbilder(v, false)).toBe(false)
    }
  })
})

describe('Was in welche Variante geht', () => {
  const layer = (typ: string, sichtbarkeit = 'intern') => ({ typ, sichtbarkeit })

  it('nimmt Stempel in alles ausser das Archivoriginal', () => {
    expect(gehoertHinein('archiv', layer('stempel', 'alle'))).toBe(false)
    expect(gehoertHinein('stempel', layer('stempel', 'alle'))).toBe(true)
    expect(gehoertHinein('extern', layer('stempel', 'alle'))).toBe(true)
    expect(gehoertHinein('intern', layer('stempel', 'alle'))).toBe(true)
  })

  it('laesst eine interne Notiz nie nach draussen', () => {
    expect(gehoertHinein('intern', layer('notiz', 'intern'))).toBe(true)
    expect(gehoertHinein('extern', layer('notiz', 'intern'))).toBe(false)
    // Auch dann nicht, wenn jemand sie ausdruecklich freigegeben hat:
    // `extern` zeigt ueberhaupt keine Notizen (Konzept 16).
    expect(gehoertHinein('extern', layer('notiz', 'extern'))).toBe(false)
  })

  it('nimmt eine Schwaerzung unabhaengig von ihrer Sichtbarkeit', () => {
    // Eine Schwaerzung verdeckt. Sie wegzulassen hiesse, das Verdeckte zu
    // zeigen -- deshalb ist sie nie eine Frage der Sichtbarkeit.
    expect(gehoertHinein('extern', layer('schwaerzung', 'intern'))).toBe(true)
    expect(gehoertHinein('intern', layer('schwaerzung', 'intern'))).toBe(true)
  })

  it('laesst eine Hervorhebung nur ausdruecklich freigegeben hinaus', () => {
    expect(gehoertHinein('extern', layer('highlight', 'intern'))).toBe(false)
    expect(gehoertHinein('extern', layer('highlight', 'alle'))).toBe(true)
  })

  it('nimmt in die Stempelvariante wirklich nur Stempel', () => {
    for (const typ of ['notiz', 'highlight', 'schwaerzung']) {
      expect(gehoertHinein('stempel', layer(typ, 'alle'))).toBe(false)
    }
  })
})

describe('Variantennamen', () => {
  it('erkennt die vier aus dem Konzept', () => {
    expect(ALLE.sort()).toEqual(['archiv', 'extern', 'intern', 'stempel'])
  })

  it('weist alles andere ab', () => {
    // Der Wert kommt aus der Adresszeile. Ohne diese Pruefung waere die
    // Variante ein Feld, in das jemand schreiben kann, was er moechte.
    expect(istVariante('archiv')).toBe(true)
    expect(istVariante('alles')).toBe(false)
    expect(istVariante('__proto__')).toBe(false)
    expect(istVariante('')).toBe(false)
  })
})
