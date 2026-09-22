/**
 * Tests: Vier Augen.
 *
 * Zwei Schalter, die seit dem Kernschema existierten und nie wirkten:
 * `prozessstufe.vier_augen_pflicht` (nicht dieselbe Person wie die
 * vorherige Stufe) und `stempeltyp.vier_augen_pflicht` (niemand, der auf
 * diesem Beleg schon eine Stufe abgeschlossen hat). Seit 20260922140000
 * prueft sie ein Trigger; die Oberflaeche spiegelt sie; die Pruefung des
 * Ablaufs meldet, wenn es kein zweites Augenpaar gibt.
 *
 * Im Seed kann jede Stufe genau eine Person abschliessen -- Anna, Bernd,
 * Eva, Bernd, Bernd. Damit dieselbe Person zwei Stufen nacheinander
 * stempeln *koennte*, bekommt Anna hier voruebergehend weitere Rechte. Die
 * Regel muss dann greifen, obwohl das Recht da ist -- genau das ist der
 * Unterschied zwischen "darf" (Rolle) und "nicht dieselben zwei" (Stufe).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { aufgabeLaden, stempelSetzen } from '../src/app/lib/postfach'
import { entwurfAnlegen, entwurfPruefung } from '../src/workflow/konfiguration'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const EVA = '20000000-0000-0000-0000-000000000005'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const DEFINITION_AKTIV = '65000000-0000-0000-0000-000000000001'
const SEED_DEFINITIONEN = [DEFINITION_AKTIV, '65000000-0000-0000-0000-000000000002']

let beleg = ''
const geliehen: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

/** Gibt der Rolle von `wer` das Freigaberecht der Stufe `stufentyp` -- bis zum Aufraeumen. */
async function rechtLeihen(stufentyp: string, wer: string): Promise<void> {
  const { rows } = await alsEigentuemer((c) =>
    c.query<{ id: string }>(
      `insert into stempel_recht (stempeltyp_id, rolle_id)
       select st.stempeltyp_id, bro.rolle_id
         from prozessstufe s
         join prozessstufe_stempeltyp st on st.stufe_id = s.id
         join stempeltyp t on t.id = st.stempeltyp_id and t.entscheidung = 'freigabe'
         join benutzer_rolle_objekt bro on bro.benutzer_id = $3
        where s.definition_id = $1 and s.stufentyp = $2
        limit 1
       returning id`,
      [DEFINITION_AKTIV, stufentyp, wer],
    ),
  )
  if (rows[0] === undefined) throw new Error(`Kein Recht zu leihen fuer ${stufentyp}`)
  geliehen.push(rows[0].id)
}

/** Die offene Aufgabe des Testbelegs aus Sicht von `wer`. */
async function aufgabe(wer: string) {
  const { rows } = await alsEigentuemer((c) =>
    c.query<{ id: string }>(
      `select a.id from aufgabe a join dokument_lauf l on l.id = a.lauf_id
        where l.dokument_id = $1 and a.status in ('offen','in_arbeit')
        order by a.faellig_am limit 1`,
      [beleg],
    ),
  )
  if (rows[0] === undefined) throw new Error('Keine offene Aufgabe am Testbeleg')
  const geladen = await aufgabeLaden(wer, rows[0].id)
  if (geladen === null) throw new Error(`Aufgabe fuer ${wer} nicht sichtbar`)
  return geladen
}

/** Stempelt als `wer` mit dem Freigabestempel, wie es die Oberflaeche taete. */
async function freigeben(wer: string): Promise<void> {
  const geladen = await aufgabe(wer)
  const frei = geladen.stempel.find((s) => s.entscheidung === 'freigabe')
  if (frei === undefined) throw new Error('Kein Freigabestempel angeboten')
  await stempelSetzen(wer, { aufgabeId: geladen.zeile.aufgabeId, stempeltypId: frei.stempeltypId })
}

/** Der Freigabestempeltyp der offenen Stufe -- fuer untergeschobene Stempel. */
async function freigabetypDerOffenenStufe(): Promise<{ laufId: string; stufeId: string; typ: string; aufgabeId: string }> {
  const { rows } = await alsEigentuemer((c) =>
    c.query<{ lauf_id: string; stufe_id: string; typ: string; id: string }>(
      `select a.id, a.lauf_id, a.stufe_id,
              (select st.stempeltyp_id from prozessstufe_stempeltyp st
                 join stempeltyp t on t.id = st.stempeltyp_id
                where st.stufe_id = a.stufe_id and t.entscheidung = 'freigabe' limit 1) as typ
         from aufgabe a join dokument_lauf l on l.id = a.lauf_id
        where l.dokument_id = $1 and a.status = 'offen'`,
      [beleg],
    ),
  )
  const z = rows[0]
  if (z === undefined) throw new Error('Keine offene Stufe')
  return { laufId: z.lauf_id, stufeId: z.stufe_id, typ: z.typ, aufgabeId: z.id }
}

async function vierAugen(stufentyp: string, wert: boolean): Promise<void> {
  await alsEigentuemer((c) =>
    c.query(`update prozessstufe set vier_augen_pflicht = $2 where definition_id = $1 and stufentyp = $3`, [
      DEFINITION_AKTIV,
      wert,
      stufentyp,
    ]),
  )
}

beforeEach(async () => {
  beleg = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42, ORDNUNGSGRUPPE_BK],
    )
    const id = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-VIERAUGEN', current_date, 1000, 190, 1190)`,
      [id, KREDITOR],
    )
    await laufStarten(c, id)
    return id
  })
})

afterEach(async () => {
  await belegEntfernen(beleg)
  await alsEigentuemer(async (c) => {
    if (geliehen.length > 0) {
      await c.query('delete from stempel_recht where id = any($1)', [geliehen])
      geliehen.length = 0
    }
    await c.query('update prozessstufe set vier_augen_pflicht = false')
    await c.query('update stempeltyp set vier_augen_pflicht = false')
    await c.query(
      `update prozessdefinition
          set status = 'abgeloest', entwurf_von = null, entwurf_seit = null, aktiv_bis = now()
        where id <> all($1::uuid[]) and status in ('entwurf', 'aktiv')`,
      [SEED_DEFINITIONEN],
    )
    await c.query(`update prozessdefinition set status = 'aktiv', aktiv_bis = null where id = any($1::uuid[])`, [
      SEED_DEFINITIONEN,
    ])
  })
})

afterAll(poolSchliessen)

describe('An der Stufe', () => {
  it('weist dieselbe Person an der naechsten Stufe ab -- und bietet ihr den Knopf nicht an', async () => {
    await rechtLeihen('rechnerisch', ANNA) // Anna *duerfte* jetzt beides.
    await vierAugen('rechnerisch', true)
    await freigeben(ANNA) // sachlich

    // Rechnerisch: kein Knopf fuer Anna ...
    const geladen = await aufgabe(ANNA)
    expect(geladen.stempel.some((s) => s.entscheidung === 'freigabe')).toBe(false)
    // ... und ein untergeschobener Stempel scheitert an derselben Regel.
    const { typ } = await freigabetypDerOffenenStufe()
    await expect(
      stempelSetzen(ANNA, { aufgabeId: geladen.zeile.aufgabeId, stempeltypId: typ }),
    ).rejects.toThrow(/nicht möglich|Vier-Augen/)
    // Bernd kann.
    await freigeben(BERND)
  })

  it('laesst eine andere Person die naechste Stufe abschliessen', async () => {
    await vierAugen('rechnerisch', true)
    await freigeben(ANNA)
    await freigeben(BERND)
  })

  it('ist ohne Schalter wie bisher: dieselbe Person darf beides', async () => {
    await rechtLeihen('rechnerisch', ANNA)
    await freigeben(ANNA)
    await freigeben(ANNA)
  })

  it('haelt auch ein direktes Ereignis ab -- die Grenze ist der Trigger', async () => {
    await rechtLeihen('rechnerisch', ANNA)
    await vierAugen('rechnerisch', true)
    await freigeben(ANNA)
    const { laufId, stufeId, typ } = await freigabetypDerOffenenStufe()
    await expect(
      alsBenutzer(ANNA, (c) =>
        c.query(
          `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, stempeltyp_id, entscheidung)
           values ($1, $2, $3, $4, 'freigabe')`,
          [laufId, stufeId, ANNA, typ],
        ),
      ),
    ).rejects.toThrow(/Vier-Augen/)
  })
})

describe('Am Stempeltyp', () => {
  it('laesst nur stempeln, wer auf dem Beleg noch nichts abgeschlossen hat', async () => {
    await rechtLeihen('freigabe', ANNA) // Anna duerfte die Geschaeftsleitungsfreigabe.
    await alsEigentuemer((c) =>
      c.query(`update stempeltyp set vier_augen_pflicht = true
                where id in (select st.stempeltyp_id from prozessstufe_stempeltyp st
                              join prozessstufe s on s.id = st.stufe_id
                              join stempeltyp t on t.id = st.stempeltyp_id
                             where s.definition_id = $1 and s.stufentyp = 'freigabe'
                               and t.entscheidung = 'freigabe')`, [DEFINITION_AKTIV]),
    )
    await freigeben(ANNA) // sachlich
    await freigeben(BERND) // rechnerisch
    // Freigabe: Anna hat schon eine Stufe abgeschlossen -- kein Knopf; Eva nicht -- Knopf.
    expect((await aufgabe(ANNA)).stempel.some((s) => s.entscheidung === 'freigabe')).toBe(false)
    expect((await aufgabe(EVA)).stempel.some((s) => s.entscheidung === 'freigabe')).toBe(true)
  })
})

describe('Die Pruefung des Ablaufs', () => {
  it('meldet, wenn vier Augen verlangt sind, aber es kein zweites Paar gibt', async () => {
    // Im Seed kann allein Bernd die Kontierung und die Zahlungsuebergabe
    // abschliessen -- zwei Stufen nacheinander, dieselbe einzige Person.
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    await alsEigentuemer((c) =>
      c.query(`update prozessstufe set vier_augen_pflicht = true where definition_id = $1 and stufentyp = 'zahlung'`, [
        entwurf,
      ]),
    )
    const befunde = await entwurfPruefung(EVA, entwurf)
    const treffer = befunde.filter((b) => b.befund.includes('verlangt vier Augen'))
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.schwere).toBe('fehler')
  })

  it('meldet nichts, wo ein zweites Paar da ist', async () => {
    // Rechnerische Pruefung (Bernd) nach sachlicher Pruefung (Anna).
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    await alsEigentuemer((c) =>
      c.query(`update prozessstufe set vier_augen_pflicht = true where definition_id = $1 and stufentyp = 'rechnerisch'`, [
        entwurf,
      ]),
    )
    const befunde = await entwurfPruefung(EVA, entwurf)
    expect(befunde.filter((b) => b.befund.includes('verlangt vier Augen'))).toEqual([])
  })
})
