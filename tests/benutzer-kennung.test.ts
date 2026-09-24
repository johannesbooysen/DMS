/**
 * Die Benutzerkennung der Skripte: E-Mail-Adresse oder UUID, gesperrt heisst nein.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { poolSchliessen } from '../src/db'
import { benutzerIdAufloesen, BenutzerUnbekannt } from '../src/benutzer-kennung'

const ANNA = '20000000-0000-0000-0000-000000000001'

afterAll(poolSchliessen)

describe('Benutzerkennung', () => {
  it('loest die E-Mail-Adresse auf -- Gross-/Kleinschreibung egal', async () => {
    expect(await benutzerIdAufloesen('Anna@Example.invalid')).toBe(ANNA)
  })

  it('nimmt die Kennung selbst', async () => {
    expect(await benutzerIdAufloesen(ANNA)).toBe(ANNA)
  })

  it('kennt eine erfundene Adresse nicht -- und nennt sie nicht', async () => {
    await expect(benutzerIdAufloesen('niemand@example.invalid')).rejects.toThrow(BenutzerUnbekannt)
    await expect(benutzerIdAufloesen('niemand@example.invalid')).rejects.not.toThrow(/niemand@/)
  })

  it('weist die leere Kennung ab', async () => {
    await expect(benutzerIdAufloesen('  ')).rejects.toThrow(BenutzerUnbekannt)
  })
})
