/**
 * Tests der Pflichtfelder (Konzept 14, Migration 20260928100000).
 *
 * Ein Stammdatum mit zwei Zusagen: Wer Stammdaten pflegen darf, legt die
 * Liste fest -- wer nicht, aendert nichts, und das wird gesagt. Und die
 * Extraktions-Ampel rechnet ueber genau diese Liste, nicht ueber die aus
 * dem Quelltext.
 *
 * Die Liste von Nord wird im Test veraendert und im selben Test wieder
 * hergestellt: Andere Testdateien lesen sie ueber die Aufbereitung mit.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { extraktionsvertrauen } from '../src/extraktion'
import type { ErkanntesFeld } from '../src/extraktion/typen'
import { NichtErlaubt } from '../src/stammdaten'
import {
  pflichtfelderFuerDokument,
  pflichtfelderLaden,
  pflichtfelderSetzen,
  STANDARD_PFLICHTFELDER,
} from '../src/stammdaten/pflichtfeld'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004'

afterAll(poolSchliessen)

const feld = (feldname: ErkanntesFeld['feldname'], confidence: number): ErkanntesFeld => ({
  feldname,
  confidence,
})

describe('Stammdatum', () => {
  it('beginnt mit der Liste aus dem Quelltext', async () => {
    expect(await pflichtfelderLaden(BERND, 'rechnung')).toEqual([...STANDARD_PFLICHTFELDER].sort())
  })

  it('laesst setzen, wer Stammdaten pflegen darf -- und stellt die Liste ganz', async () => {
    try {
      await pflichtfelderSetzen(BERND, 'rechnung', ['brutto', 'iban_im_beleg', 'brutto', 'unsinn'])
      expect(await pflichtfelderLaden(BERND, 'rechnung')).toEqual(['brutto', 'iban_im_beleg'])
      // Das andere Haus hat davon nichts gesehen.
      expect(await pflichtfelderLaden(DORIS, 'rechnung')).toEqual([...STANDARD_PFLICHTFELDER].sort())
    } finally {
      await pflichtfelderSetzen(BERND, 'rechnung', STANDARD_PFLICHTFELDER)
    }
    expect(await pflichtfelderLaden(BERND, 'rechnung')).toEqual([...STANDARD_PFLICHTFELDER].sort())
  })

  it('weist ab, wer das Recht nicht hat -- und aendert nichts', async () => {
    await expect(pflichtfelderSetzen(ANNA, 'rechnung', ['brutto'])).rejects.toThrow(NichtErlaubt)
    expect(await pflichtfelderLaden(ANNA, 'rechnung')).toEqual([...STANDARD_PFLICHTFELDER].sort())
  })

  it('kennt keine Pflichtfelder fuer Schriftverkehr', async () => {
    await expect(pflichtfelderSetzen(BERND, 'schriftverkehr', ['brutto'])).rejects.toThrow(NichtErlaubt)
  })

  it('liefert fuer einen Beleg die Liste seines Hauses', async () => {
    const liste = await alsBenutzer(BERND, async (c) => {
      const { rows } = await c.query<{ id: string }>("select id from dokument where belegart = 'rechnung' limit 1")
      return pflichtfelderFuerDokument(c, rows[0]!.id)
    })
    expect(liste).toEqual([...STANDARD_PFLICHTFELDER].sort())
  })
})

describe('Extraktionsvertrauen', () => {
  it('rechnet ueber die uebergebene Liste, nicht ueber die aus dem Quelltext', () => {
    const felder = [feld('brutto', 0.99), feld('iban_im_beleg', 0.7)]
    // Nach der Standardliste fehlt der Kreditor -- kein Vertrauen.
    expect(extraktionsvertrauen(felder)).toBeNull()
    // Nach der Hausliste ist alles da, das Minimum zaehlt.
    expect(extraktionsvertrauen(felder, ['brutto', 'iban_im_beleg'])).toBe(0.7)
  })

  it('ist ohne Pflichtfelder 1 -- nichts kann fehlen', () => {
    expect(extraktionsvertrauen([], [])).toBe(1)
  })
})
