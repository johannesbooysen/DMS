/**
 * Tests: gespeicherte Suchen.
 *
 * Drei Zusagen: Eine Suche gehoert dem, der sie gespeichert hat -- niemand
 * sonst sieht sie, auch nicht im selben Haus. Gespeichert wird nur, was die
 * Liste kennt. Und derselbe Name ersetzt, statt zu scheitern.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { poolSchliessen, verbindungspool } from '../src/db'
import {
  alsAbfrage,
  sucheLoeschen,
  sucheSpeichern,
  suchenLaden,
  suchfilterLesen,
} from '../src/belege/suchen-speichern'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'

afterEach(async () => {
  const c = await verbindungspool().connect()
  try {
    await c.query('delete from gespeicherte_suche')
  } finally {
    c.release()
  }
})

afterAll(poolSchliessen)

describe('Weissliste', () => {
  it('behaelt nur, was die Liste kennt, und laesst Leeres weg', () => {
    expect(suchfilterLesen({ q: ' Reinigung ', ampel: 'rot', objekt: '', seite: '3', foo: 'bar' })).toEqual({
      q: 'Reinigung',
      ampel: 'rot',
    })
  })

  it('baut daraus die Abfrage der Belegliste', () => {
    expect(alsAbfrage({})).toBe('/belege')
    expect(alsAbfrage({ q: 'Reinigung', ampel: 'rot' })).toBe('/belege?q=Reinigung&ampel=rot')
  })
})

describe('Speichern', () => {
  it('speichert und liest die eigene Suche', async () => {
    await sucheSpeichern(ANNA, 'Rote Belege', { ampel: 'rot', unsinn: 'x' })
    const eigene = await suchenLaden(ANNA)
    expect(eigene).toHaveLength(1)
    expect(eigene[0]?.name).toBe('Rote Belege')
    expect(eigene[0]?.filter).toEqual({ ampel: 'rot' })
  })

  it('ersetzt bei gleichem Namen statt zu scheitern', async () => {
    await sucheSpeichern(ANNA, 'Meine', { ampel: 'rot' })
    await sucheSpeichern(ANNA, 'Meine', { ampel: 'gruen', q: 'Miete' })
    const eigene = await suchenLaden(ANNA)
    expect(eigene).toHaveLength(1)
    expect(eigene[0]?.filter).toEqual({ q: 'Miete', ampel: 'gruen' })
  })

  it('verlangt einen Namen und einen Filter', async () => {
    await expect(sucheSpeichern(ANNA, '   ', { ampel: 'rot' })).rejects.toThrow(/Namen/)
    await expect(sucheSpeichern(ANNA, 'Alles', {})).rejects.toThrow(/nichts zu speichern/)
  })
})

describe('Persoenlich', () => {
  it('zeigt Bernd nicht, was Anna gespeichert hat -- auch nicht im selben Haus', async () => {
    await sucheSpeichern(ANNA, 'Annas Suche', { ampel: 'rot' })
    expect(await suchenLaden(BERND)).toEqual([])
    expect(await suchenLaden(DORIS)).toEqual([])
  })

  it('laesst Bernd Annas Suche nicht loeschen', async () => {
    await sucheSpeichern(ANNA, 'Annas Suche', { ampel: 'rot' })
    const [eigene] = await suchenLaden(ANNA)
    await sucheLoeschen(BERND, eigene!.id)
    expect(await suchenLaden(ANNA)).toHaveLength(1)
    await sucheLoeschen(ANNA, eigene!.id)
    expect(await suchenLaden(ANNA)).toHaveLength(0)
  })
})
