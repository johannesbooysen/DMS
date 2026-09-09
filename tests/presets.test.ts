/**
 * Tests der Berechtigungs-Presets (Konzept §24.13).
 *
 * Zwei Zusicherungen tragen diese Datei:
 *
 *   * **Ein Preset nimmt nichts weg.** Angewendet auf ein laufendes Haus
 *     ergänzt es und überschreibt nicht — sonst fiele der Verlust genau dann
 *     auf, wenn jemand eine Freigabe braucht.
 *   * **Zweimal anwenden ist wie einmal.** Ohne diese Eigenschaft entstünden
 *     doppelte Rechte, und `stempel_recht` hat gar keine Eindeutigkeit, die
 *     das verhindern würde.
 */

import { afterEach, afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { NichtErlaubt, NichtMoeglich, PRESETS, anwenden, preset } from '../src/stammdaten/presets'

const MANDANT2 = '10000000-0000-0000-0000-000000000002'
const ANNA = '20000000-0000-0000-0000-000000000001'
const EVA = '20000000-0000-0000-0000-000000000005'
/**
 * Die Ersteinrichtung laeuft als Eigentuemer, nicht als Benutzer -- genau
 * wie `scripts/einrichten.ts`.
 *
 * Nachgestellt und dabei gelernt: Doris ist im leeren Haus 2 ein
 * gewoehnlicher Benutzer ohne `benutzer_verwalten`. Sie kann das Preset
 * nicht anwenden, und das ist richtig -- das Recht entsteht ja erst
 * dadurch. Die Henne faengt das Skript ein.
 */
async function alsEigentuemer<T>(aktion: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    await c.query('begin')
    const ergebnis = await aktion(c)
    await c.query('commit')
    return ergebnis
  } catch (fehler) {
    await c.query('rollback')
    throw fehler
  } finally {
    c.release()
  }
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

/** Räumt nur Mandant 2 ab -- der Seed von Mandant 1 bleibt unberührt. */
afterEach(async () => {
  await direkt(
    `delete from stempel_recht where rolle_id in
       (select id from rolle where mandant_id = $1)`,
    [MANDANT2],
  )
  await direkt('delete from rolle where mandant_id = $1', [MANDANT2])
})

afterAll(poolSchliessen)

describe('Die Presets selbst', () => {
  it('decken die drei Verwaltungsarten ab', () => {
    expect(PRESETS.map((p) => p.verwaltungsart).sort()).toEqual(['miet', 'se', 'weg'])
  })

  it('geben der Geschaeftsleitung ueberall die Verwaltungsrechte', () => {
    // Sonst gaebe es nach der Ersteinrichtung niemanden, der Benutzer
    // anlegen oder einen Notfallzugriff einrichten kann -- das Haus waere
    // eingerichtet und handlungsunfaehig.
    for (const p of PRESETS) {
      const gl = p.rollen.find((r) => r.kurzcode === 'GL')
      expect(gl?.rechte, p.id).toContain('benutzer_verwalten')
      expect(gl?.rechte, p.id).toContain('notfallzugriff')
    }
  })

  it('trennen ueberall die Freigabe von der Bearbeitung', () => {
    /*
     * Die eine Regel, die keiner der Zuschnitte aufweichen darf: Wer den
     * Beleg bearbeitet, gibt ihn nicht frei. Sonst waeren die Stufen
     * Zierrat.
     */
    for (const p of PRESETS) {
      const mitFreigabe = p.rollen.filter((r) => r.stempel.includes('FREI'))
      expect(mitFreigabe.map((r) => r.kurzcode), p.id).toEqual(['GL'])
      expect(mitFreigabe[0]?.rechte, p.id).not.toContain('bearbeiten')
    }
  })

  it('weist ein unbekanntes Preset ab', () => {
    expect(() => preset('gibtesnicht')).toThrow(NichtMoeglich)
  })
})

describe('Anwenden', () => {
  it('richtet ein leeres Haus ein', async () => {
    const bilanz = await alsEigentuemer((c) => anwenden(c, 'weg', MANDANT2))

    expect(bilanz.rollenAngelegt.sort()).toEqual(['BH', 'GL', 'OB'])
    expect(bilanz.rollenVorhanden).toEqual([])
    expect(bilanz.rechteAngelegt).toBeGreaterThan(0)

    const rollen = await direkt<{ kurzcode: string }>(
      'select kurzcode from rolle where mandant_id = $1 order by kurzcode',
      [MANDANT2],
    )
    expect(rollen.map((r) => r.kurzcode)).toEqual(['BH', 'GL', 'OB'])
  })

  it('ist beim zweiten Mal wirkungslos', async () => {
    await alsEigentuemer((c) => anwenden(c, 'weg', MANDANT2))
    const zweite = await alsEigentuemer((c) => anwenden(c, 'weg', MANDANT2))

    /*
     * `on conflict do nothing` traegt hier nicht: Der eindeutige Index auf
     * `rolle_recht` schliesst `belegart` und `ordnungsgruppe_id` ein, beide
     * sind null -- und null ist von null verschieden. `stempel_recht` hat
     * ueberhaupt keine Eindeutigkeit. Deshalb `where not exists`, und
     * deshalb dieser Test.
     */
    expect(zweite.rollenAngelegt).toEqual([])
    expect(zweite.rollenVorhanden.sort()).toEqual(['BH', 'GL', 'OB'])
    expect(zweite.rechteAngelegt).toBe(0)
    expect(zweite.stempelrechteAngelegt).toBe(0)
  })

  it('nimmt einer vorhandenen Rolle nichts weg', async () => {
    await alsEigentuemer((c) => anwenden(c, 'weg', MANDANT2))

    // Jemand hat der Objektbearbeitung nachtraeglich das Exportrecht gegeben.
    const [ob] = await direkt<{ id: string }>(
      'select id from rolle where mandant_id = $1 and kurzcode = $2',
      [MANDANT2, 'OB'],
    )
    await direkt("insert into rolle_recht (rolle_id, aktion) values ($1, 'exportieren')", [ob.id])

    // Ein zweiter Lauf -- diesmal mit einem anderen Zuschnitt.
    await alsEigentuemer((c) => anwenden(c, 'miet', MANDANT2))

    const rechte = await direkt<{ aktion: string }>(
      'select aktion from rolle_recht where rolle_id = $1',
      [ob.id],
    )
    // Das nachtraeglich vergebene Recht steht noch da; das Preset hat nur
    // ergaenzt (Mietverwaltung gibt der Objektbearbeitung `kontieren`).
    expect(rechte.map((r) => r.aktion)).toContain('exportieren')
    expect(rechte.map((r) => r.aktion)).toContain('kontieren')
  })

  it('meldet Stempelkurzcodes, zu denen es keinen Typ gibt', async () => {
    /*
     * Mandant 2 hat keine Stempeltypen. Ein Preset, das sie nebenbei
     * anlegte, baute einen Ablauf, den niemand entworfen hat -- und das
     * verlangt ohnehin ein anderes Recht. Also: melden, nicht anlegen.
     */
    const bilanz = await alsEigentuemer((c) => anwenden(c, 'weg', MANDANT2))

    expect(bilanz.stempelrechteAngelegt).toBe(0)
    expect(bilanz.ohneStempeltyp).toContain('FREI')
    expect(bilanz.ohneStempeltyp).toContain('SACHL')
  })
})

describe('Das Recht', () => {
  it('hat, wer Benutzer verwaltet', async () => {
    // Eva im eingerichteten Haus: Alles ist da, nichts kommt hinzu.
    const bilanz = await alsBenutzer(EVA, (c) => anwenden(c, 'weg'))
    expect(bilanz.rollenAngelegt).toEqual([])
    expect(bilanz.rollenVorhanden.sort()).toEqual(['BH', 'GL', 'OB'])
  })

  it('hat sonst niemand', async () => {
    await expect(alsBenutzer(ANNA, (c) => anwenden(c, 'se'))).rejects.toThrow(NichtErlaubt)

    const neue = await direkt("select 1 from rolle where kurzcode = 'VW'")
    expect(neue).toHaveLength(0)
  })
})
