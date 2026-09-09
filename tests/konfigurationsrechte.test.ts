/**
 * Wer den Ablauf ändert, ändert wer entscheiden darf.
 *
 * Diese Datei nagelt eine Rechteausweitung fest, die bis
 * `20260909100000` offenstand und beim Bau der Berechtigungs-Presets
 * auffiel: Die Konfigurationstabellen trugen eine einzelne
 * `for all`-Policy mit reinem Mandantenfilter — dieselbe Lücke, die
 * `20260903100000` für die Stammdatentabellen geschlossen hatte.
 *
 * **Der schwerste Fall steht als erster Test.** Anna konnte ihrer eigenen
 * Rolle den Freigabestempel der Geschäftsleitung zuweisen. Danach erzeugt
 * sie die Freigaben selbst, die `app.zahlung_moeglich()` verlangt — die
 * harte Sperre vor der Zahlung wäre keine mehr gewesen.
 *
 * Über die Gruppen führt derselbe Weg ein zweites Mal: `stempel_recht`
 * kennt neben `rolle_id` auch `gruppe_id`. Wer Gruppen anlegen und besetzen
 * kann, besetzt sich selbst.
 */

import { afterEach, afterAll, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001' // Objektbearbeitung
const DORIS = '20000000-0000-0000-0000-000000000004' // fremder Mandant
const EVA = '20000000-0000-0000-0000-000000000005' // Geschaeftsleitung
const ROLLE_OB = '90000000-0000-0000-0000-000000000001'
const STEMPEL_FREIGABE_GL = '60000000-0000-0000-0000-000000000004'

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/**
 * Führt ein Schreiben aus und meldet, ob es **gewirkt** hat.
 *
 * Nicht „hat es keinen Fehler geworfen": Ein `update` ohne Recht meldet
 * Erfolg mit null Zeilen, ein `insert` wirft. Beide Ausgänge heißen hier
 * dasselbe — es ist nichts passiert.
 */
async function wirkt(benutzerId: string, sql: string, werte: unknown[] = []): Promise<boolean> {
  try {
    return await alsBenutzer(benutzerId, async (c) => {
      const e = await c.query(sql, werte)
      return (e.rowCount ?? 0) > 0
    })
  } catch {
    return false
  }
}

afterEach(async () => {
  await direkt("delete from stempel_recht where rolle_id = $1 and stempeltyp_id = $2", [
    ROLLE_OB,
    STEMPEL_FREIGABE_GL,
  ])
  await direkt("delete from stempeltyp where kurzcode like 'ZZ%'")
  await direkt("delete from gruppe where name like 'Pruefgruppe%'")
  await direkt("delete from prozessdefinition where version >= 900")
})

afterAll(poolSchliessen)

describe('Stempelrechte', () => {
  it('kann sich niemand selbst zuweisen', async () => {
    /*
     * **Der Fund.** Bis 20260909100000 gelang dieses Insert, und danach
     * durfte Annas Rolle den Freigabestempel der Geschaeftsleitung setzen.
     */
    expect(
      await wirkt(
        ANNA,
        'insert into stempel_recht (stempeltyp_id, rolle_id) values ($1, $2)',
        [STEMPEL_FREIGABE_GL, ROLLE_OB],
      ),
    ).toBe(false)

    const zeilen = await direkt(
      'select 1 from stempel_recht where stempeltyp_id = $1 and rolle_id = $2',
      [STEMPEL_FREIGABE_GL, ROLLE_OB],
    )
    expect(zeilen).toHaveLength(0)
  })

  it('vergibt die Benutzerverwaltung', async () => {
    expect(
      await wirkt(
        EVA,
        'insert into stempel_recht (stempeltyp_id, rolle_id) values ($1, $2)',
        [STEMPEL_FREIGABE_GL, ROLLE_OB],
      ),
    ).toBe(true)
  })

  it('bleiben für alle lesbar', async () => {
    // Wer einen Beleg bearbeitet, hat Grund nachzusehen, wer die naechste
    // Stufe stempeln darf. Verborgen ginge die Frage an einen Kollegen.
    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query('select count(*)::int as n from stempel_recht'),
    )
    expect(rows[0].n).toBeGreaterThan(0)
  })
})

describe('Stempeltypen und Gruppen', () => {
  it('legt eine Objektbearbeiterin nicht an', async () => {
    expect(
      await wirkt(
        ANNA,
        `insert into stempeltyp (mandant_id, name, kurzcode, entscheidung)
         values ($1, 'Selbstfreigabe', 'ZZ1', 'freigabe')`,
        [MANDANT],
      ),
    ).toBe(false)

    // Der zweite Weg zum Stempelrecht: `stempel_recht` kennt `gruppe_id`.
    expect(
      await wirkt(ANNA, 'insert into gruppe (mandant_id, name) values ($1, $2)', [
        MANDANT,
        'Pruefgruppe A',
      ]),
    ).toBe(false)
  })

  it('legt die Geschaeftsleitung an', async () => {
    expect(
      await wirkt(
        EVA,
        `insert into stempeltyp (mandant_id, name, kurzcode, entscheidung)
         values ($1, 'Sonderfreigabe', 'ZZ2', 'freigabe')`,
        [MANDANT],
      ),
    ).toBe(true)
  })

  it('laesst niemanden sich selbst in eine Gruppe eintragen', async () => {
    const [g] = await direkt<{ id: string }>(
      'insert into gruppe (mandant_id, name) values ($1, $2) returning id',
      [MANDANT, 'Pruefgruppe B'],
    )
    expect(
      await wirkt(ANNA, 'insert into gruppe_mitglied (gruppe_id, benutzer_id) values ($1, $2)', [
        g.id,
        ANNA,
      ]),
    ).toBe(false)
  })
})

describe('Der Ablauf', () => {
  it('wird nicht von jedem konfiguriert', async () => {
    /*
     * `prozess_konfigurieren` gibt es seit dem Rollenmodell -- es stand nur
     * in keiner Policy. Wer den Ablauf aendert, entscheidet, welche Stufen
     * ueberhaupt durchlaufen werden; eine Kette ohne Freigabestufe ist eine
     * Zahlung ohne Freigabe.
     */
    expect(
      await wirkt(
        ANNA,
        `insert into prozessdefinition (mandant_id, belegart, version, status, aktiv_ab)
         values ($1, 'rechnung', 900, 'entwurf', now())`,
        [MANDANT],
      ),
    ).toBe(false)
  })

  it('wird von der Geschaeftsleitung konfiguriert', async () => {
    expect(
      await wirkt(
        EVA,
        `insert into prozessdefinition (mandant_id, belegart, version, status, aktiv_ab)
         values ($1, 'rechnung', 901, 'entwurf', now())`,
        [MANDANT],
      ),
    ).toBe(true)
  })

  it('bleibt fuer alle lesbar', async () => {
    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query('select count(*)::int as n from prozessstufe'),
    )
    expect(rows[0].n).toBeGreaterThan(0)
  })
})

describe('Der Mandantenfilter', () => {
  it('haelt auch fuer die Konfiguration', async () => {
    // Projektregel: Jede lesende Funktion braucht diesen Test.
    for (const tabelle of ['stempeltyp', 'stempel_recht', 'prozessdefinition', 'gruppe']) {
      const { rows } = await alsBenutzer(DORIS, (c) =>
        c.query(`select count(*)::int as n from ${tabelle}`),
      )
      expect(rows[0].n, `${tabelle} zeigt einem fremden Mandanten etwas`).toBe(0)
    }
  })
})
