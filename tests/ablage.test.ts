/**
 * Ablagen: wo ein Beleg liegt und wer ihn sieht (Migration 20261006150000).
 *
 * Zusicherungen:
 *   - Jeder Beleg hat eine Ablage; ohne Angabe legt ihn die Datenbank ueber
 *     seine Belegart ab (dms.ablage_fuer), eine gewaehlte Ablage bleibt.
 *   - Die Belegart-Erkennung stellt die Ablage mit um -- aber nur, solange
 *     kein Mensch sie gewaehlt hat.
 *   - Wer eine Ablage nicht ansehen darf, sieht ihre Belege nicht -- auch
 *     nicht ueber eine Objektzustaendigkeit. Ohne jedes Sichtrecht aus einer
 *     Rolle gelten alle Ablagen (nichts wird genommen, was heute da ist).
 *   - Ablagen pflegt, wer Stammdaten pflegt; Rechte je Ablage vergibt, wer
 *     Benutzer verwaltet. Beides wird an der Wirkung gemessen.
 *   - Einen Beleg in eine andere Ablage legen darf, wer dort bearbeiten
 *     darf -- mit Belegart- und Gruppengeltung des Rechts; der Wechsel
 *     hinterlaesst ein Korrekturereignis.
 *   - Eine mitgegebene Ablage muss zum Mandanten gehoeren und aktiv sein;
 *     ein Recht zeigt nie auf die Ablage eines anderen Hauses.
 *   - Einer Rolle mit Sichtrecht laesst sich das ansehen nicht ganz nehmen,
 *     nur einschraenken (sonst kehrte die Rueckfallregel "additiv" um).
 *   - Ein fremder Mandant sieht keine Ablage und keinen Beleg.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { ablageWechseln, AblagewechselAbgelehnt } from '../src/belege/ablage'
import { suchen } from '../src/belege/liste'
import { NichtErlaubt, NichtMoeglich } from '../src/stammdaten'
import {
  ablageAnlegen,
  ablagenLaden,
  ablagerechteLaden,
  ablagerechteSetzen,
  ablageUmschalten,
} from '../src/stammdaten/ablagen'
import { belegartWechseln } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001' // Objektbearbeitung, Objekt 42
const BERND = '20000000-0000-0000-0000-000000000002' // Buchhaltung, mandantenweit
const CLARA = '20000000-0000-0000-0000-000000000003' // keine Rolle
const DORIS = '20000000-0000-0000-0000-000000000004' // anderer Mandant
const ADMIN = '20000000-0000-0000-0000-000000000006'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const GRUPPE_BK = '40000000-0000-0000-0000-000000000001'
const ROLLE_OB = '90000000-0000-0000-0000-000000000001'
const ABLAGE_LR = '38000000-0000-0000-0000-000000000001'
const ABLAGE_SV = '38000000-0000-0000-0000-000000000002'
const ABLAGE_SUED_LR = '38000000-0000-0000-0000-000000000011'

const belege: string[] = []
const angelegteAblagen: string[] = []

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

async function belegAnlegen(belegart = 'rechnung', ablageId: string | null = null): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl, erfasst_von,
                             ablage_id, ablage_quelle)
       values ($1, $2, $3, $4, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'gruen', 1, $5,
               $6, case when $6::uuid is null then 'eingang' else 'mensch' end)
       returning id`,
      [MANDANT, OBJEKT_42, belegart, GRUPPE_BK, ANNA, ablageId],
    )
    return rows[0]!.id
  })
  belege.push(id)
  return id
}

async function ablageVon(id: string): Promise<{ ablage_id: string; ablage_quelle: string }> {
  return alsEigentuemer(async (c) => {
    const { rows } = await c.query<{ ablage_id: string; ablage_quelle: string }>(
      'select ablage_id, ablage_quelle from dokument where id = $1',
      [id],
    )
    return rows[0]!
  })
}

/**
 * Die ablage-faehigen Rechte einer Rolle, wie sie gerade stehen -- gelesen,
 * nicht behauptet: Eine Konstante waere eine zweite Wahrheit ueber den Seed,
 * und das finally stellte falsch wieder her, sobald der Seed sich aendert.
 */
async function rechteVon(rolleId: string): Promise<string[]> {
  const alle = await ablagerechteLaden(ADMIN)
  return (alle.find((r) => r.rolleId === rolleId)?.eintraege ?? []).map((e) => `${e.aktion}|${e.ablageId ?? 'alle'}`)
}

afterEach(async () => {
  for (const id of belege.splice(0)) await belegEntfernen(id)
  await alsEigentuemer(async (c) => {
    for (const id of angelegteAblagen.splice(0)) {
      await c.query('delete from rolle_recht where ablage_id = $1', [id])
      await c.query('delete from ablage where id = $1', [id])
    }
  })
})

afterAll(async () => {
  await poolSchliessen()
})

describe('Ablage eines Belegs', () => {
  it('legt einen Beleg ohne Angabe ueber seine Belegart ab', async () => {
    const rechnung = await belegAnlegen('rechnung')
    const brief = await belegAnlegen('schriftverkehr')
    expect(await ablageVon(rechnung)).toEqual({ ablage_id: ABLAGE_LR, ablage_quelle: 'eingang' })
    expect(await ablageVon(brief)).toEqual({ ablage_id: ABLAGE_SV, ablage_quelle: 'eingang' })
  })

  it('nimmt eine gewaehlte Ablage und merkt sich den Menschen', async () => {
    const id = await belegAnlegen('rechnung', ABLAGE_SV)
    expect(await ablageVon(id)).toEqual({ ablage_id: ABLAGE_SV, ablage_quelle: 'mensch' })
  })

  it('faellt fuer eine Belegart ohne Ablage auf den Standard zurueck', async () => {
    const { rows } = await alsEigentuemer((c) =>
      c.query<{ a: string }>('select dms.ablage_fuer($1, $2) as a', [MANDANT, 'unbekannt']),
    )
    expect(rows[0]!.a).toBe(ABLAGE_LR)
  })

  it('stellt die Ablage mit der Belegart um -- nur ohne Wahl eines Menschen', async () => {
    const vomEingang = await belegAnlegen('rechnung')
    const gewaehlt = await belegAnlegen('rechnung', ABLAGE_LR)
    await alsBenutzer(ANNA, async (c) => {
      await belegartWechseln(c, vomEingang, 'schriftverkehr', 'erkannt', 'Test')
      await belegartWechseln(c, gewaehlt, 'schriftverkehr', 'erkannt', 'Test')
    })
    expect((await ablageVon(vomEingang)).ablage_id).toBe(ABLAGE_SV)
    expect((await ablageVon(gewaehlt)).ablage_id).toBe(ABLAGE_LR)
  })
})

describe('Sichtbarkeit je Ablage', () => {
  it('ein Sichtrecht auf eine Ablage versteckt die anderen -- auch im eigenen Objekt', async () => {
    const rechnung = await belegAnlegen('rechnung')
    const brief = await belegAnlegen('schriftverkehr')
    const sieht = async (wer: string): Promise<string[]> =>
      alsBenutzer(wer, async (c) => {
        const zeilen = await suchen(c, { objektId: OBJEKT_42, limit: 200 })
        return zeilen.map((z) => z.id).filter((id) => id === rechnung || id === brief)
      })

    expect(await sieht(ANNA)).toEqual(expect.arrayContaining([rechnung, brief]))

    const vorher = await rechteVon(ROLLE_OB)
    try {
      await ablagerechteSetzen(ADMIN, ROLLE_OB, ['ansehen|' + ABLAGE_SV, 'bearbeiten|alle'])
      const annaSieht = await sieht(ANNA)
      expect(annaSieht).toEqual([brief])
      // Bernd (Buchhaltung, ansehen in allen Ablagen) ist davon nicht beruehrt.
      expect(await sieht(BERND)).toEqual(expect.arrayContaining([rechnung, brief]))
    } finally {
      await ablagerechteSetzen(ADMIN, ROLLE_OB, vorher)
    }
    expect(await sieht(ANNA)).toEqual(expect.arrayContaining([rechnung, brief]))
    // Das Stempelrecht der Rolle ist kein Ablagerecht und blieb unangetastet.
    const { rows } = await alsEigentuemer((c) =>
      c.query("select 1 from rolle_recht where rolle_id = $1 and aktion = 'stempeln'", [ROLLE_OB]),
    )
    expect(rows).toHaveLength(1)
  })

  it('"alle" schlaegt die Einzelwahl derselben Aktion -- es steht nur einmal da', async () => {
    const vorher = await rechteVon(ROLLE_OB)
    try {
      await ablagerechteSetzen(ADMIN, ROLLE_OB, ['ansehen|alle', 'ansehen|' + ABLAGE_SV, 'bearbeiten|alle'])
      const rechte = await ablagerechteLaden(ADMIN)
      const ob = rechte.find((r) => r.rolleId === ROLLE_OB)!.eintraege.filter((e) => e.aktion === 'ansehen')
      expect(ob).toEqual([{ aktion: 'ansehen', ablageId: null }])
    } finally {
      await ablagerechteSetzen(ADMIN, ROLLE_OB, vorher)
    }
  })

  it('einer Rolle mit Sichtrecht laesst sich das ansehen nicht ganz nehmen -- nur einschraenken', async () => {
    const vorher = await rechteVon(ROLLE_OB)
    await expect(ablagerechteSetzen(ADMIN, ROLLE_OB, ['bearbeiten|alle'])).rejects.toBeInstanceOf(NichtMoeglich)
    expect(await rechteVon(ROLLE_OB)).toEqual(vorher)
  })

  it('nur ein Recht, das je Ablage wirkt, laesst sich je Ablage vergeben', async () => {
    await expect(ablagerechteSetzen(ADMIN, ROLLE_OB, ['ansehen|alle', 'kontieren|' + ABLAGE_SV])).rejects.toBeInstanceOf(
      NichtMoeglich,
    )
  })

  it('ohne jedes Sichtrecht aus einer Rolle gelten alle Ablagen -- gemessen am Beleg', async () => {
    // Clara hat keine Rolle; sie sieht Belege ohne Objekt ueber das Haus.
    const { rows } = await alsBenutzer(CLARA, (c) => c.query<{ a: string[] }>('select dms.meine_ablagen() as a'))
    expect(rows[0]!.a).toEqual(expect.arrayContaining([ABLAGE_LR, ABLAGE_SV]))

    const ohneObjekt = async (belegart: string): Promise<string> => {
      const id = await alsBenutzer(ANNA, async (c) => {
        const r = await c.query<{ id: string }>(
          `insert into dokument (mandant_id, belegart, eingangskanal, inhalt_hash, storage_praefix, ampel_gesamt, seitenzahl, erfasst_von)
           values ($1, $2, 'upload', md5(random()::text), 'test/' || gen_random_uuid(), 'gruen', 1, $3) returning id`,
          [MANDANT, belegart, ANNA],
        )
        return r.rows[0]!.id
      })
      belege.push(id)
      return id
    }
    const rechnung = await ohneObjekt('rechnung')
    const brief = await ohneObjekt('schriftverkehr')
    const claraSieht = await alsBenutzer(CLARA, async (c) => {
      const r = await c.query<{ id: string }>('select id from dokument where id = any ($1::uuid[])', [[rechnung, brief]])
      return r.rows.map((z) => z.id).sort()
    })
    expect(claraSieht).toEqual([rechnung, brief].sort())
  })

  it('eine fremde oder deaktivierte Ablage laesst sich an keinem Beleg setzen', async () => {
    // Ablage von Sued an einem Beleg von Nord: fuer jeden unsichtbar -- der
    // Fremdschluessel allein kennt keinen Mandanten.
    await expect(belegAnlegen('rechnung', ABLAGE_SUED_LR)).rejects.toThrow(/nicht zu diesem Mandanten/)
    const id = await belegAnlegen('rechnung')
    await expect(
      alsEigentuemer((c) => c.query('update dokument set ablage_id = $2 where id = $1', [id, ABLAGE_SUED_LR])),
    ).rejects.toThrow(/nicht zu diesem Mandanten/)

    await ablageAnlegen(ADMIN, { name: 'Alt', kurzcode: 'ALT', belegarten: '' })
    const alt = (await ablagenLaden(ADMIN)).find((a) => a.kurzcode === 'ALT')!
    angelegteAblagen.push(alt.id)
    await ablageUmschalten(ADMIN, { id: alt.id })
    await expect(belegAnlegen('rechnung', alt.id)).rejects.toThrow(/deaktiviert/)
  })

  it('ein Recht zeigt nie auf die Ablage eines anderen Hauses', async () => {
    await expect(
      alsEigentuemer((c) =>
        c.query("insert into rolle_recht (rolle_id, aktion, ablage_id) values ($1, 'ansehen', $2)", [ROLLE_OB, ABLAGE_SUED_LR]),
      ),
    ).rejects.toThrow(/Mandanten der Rolle/)
  })

  it('ein fremder Mandant sieht keine Ablage von Nord', async () => {
    const ablagen = await ablagenLaden(DORIS)
    expect(ablagen.map((a) => a.id)).not.toContain(ABLAGE_LR)
    expect(ablagen.length).toBeGreaterThan(0)
  })

  it('Rechte vergeben darf nur, wer Benutzer verwaltet -- gemessen an der Wirkung', async () => {
    const vorher = await rechteVon(ROLLE_OB)
    expect(vorher.length).toBeGreaterThan(0)
    await expect(ablagerechteSetzen(ANNA, ROLLE_OB, ['ansehen|' + ABLAGE_SV])).rejects.toBeInstanceOf(NichtErlaubt)
    expect(await rechteVon(ROLLE_OB)).toEqual(vorher)
  })
})

describe('Ablagen pflegen', () => {
  it('eine neue Ablage legt an, wer Stammdaten pflegt; Anna nicht', async () => {
    await expect(
      ablageAnlegen(ANNA, { name: 'Verträge', kurzcode: 'vt', belegarten: '' }),
    ).rejects.toBeInstanceOf(NichtErlaubt)

    await ablageAnlegen(ADMIN, { name: 'Verträge', kurzcode: 'vt', belegarten: 'sonstiges', beschreibung: '' })
    const neu = (await ablagenLaden(ADMIN)).find((a) => a.kurzcode === 'VT')
    expect(neu).toBeDefined()
    angelegteAblagen.push(neu!.id)
    expect(neu!.belegarten).toEqual(['sonstiges'])
    expect(neu!.istStandard).toBe(false)

    // 'sonstiges' faellt jetzt in die neue Ablage, nicht mehr in Schriftverkehr.
    const { rows } = await alsEigentuemer((c) =>
      c.query<{ a: string }>('select dms.ablage_fuer($1, $2) as a', [MANDANT, 'sonstiges']),
    )
    // Schriftverkehr (Sortierung 20) kennt 'sonstiges' auch -- und gewinnt
    // ueber die niedrigere Sortierung. Das ist die dokumentierte Regel.
    expect(rows[0]!.a).toBe(ABLAGE_SV)
  })

  it('weist einen doppelten Kurzcode und eine unbekannte Belegart ab', async () => {
    await expect(ablageAnlegen(ADMIN, { name: 'X', kurzcode: 'LR', belegarten: '' })).rejects.toBeInstanceOf(NichtMoeglich)
    await expect(ablageAnlegen(ADMIN, { name: 'X', kurzcode: 'XX', belegarten: 'vertrag' })).rejects.toBeInstanceOf(
      NichtMoeglich,
    )
  })

  it('die Standard-Ablage laesst sich nicht deaktivieren', async () => {
    await expect(ablageUmschalten(ADMIN, { id: ABLAGE_LR })).rejects.toBeInstanceOf(NichtMoeglich)
  })
})

describe('Beleg in eine andere Ablage legen', () => {
  it('wechselt mit Begruendung und hinterlaesst ein Korrekturereignis', async () => {
    const id = await belegAnlegen('rechnung')
    const ergebnis = await ablageWechseln(ANNA, id, ABLAGE_SV, 'Ist ein Begleitschreiben')
    expect(ergebnis).toEqual({ von: 'Lieferantenrechnungen', nach: 'Schriftverkehr' })
    expect(await ablageVon(id)).toEqual({ ablage_id: ABLAGE_SV, ablage_quelle: 'mensch' })

    const { rows } = await alsEigentuemer((c) =>
      c.query<{ feld: string; vorschlag: string; korrektur: string }>(
        'select feld, vorschlag, korrektur from korrektur_ereignis where dokument_id = $1',
        [id],
      ),
    )
    expect(rows).toEqual([
      {
        feld: 'ablage',
        vorschlag: `Lieferantenrechnungen (${ABLAGE_LR})`,
        korrektur: `Schriftverkehr (${ABLAGE_SV}) — Ist ein Begleitschreiben`,
      },
    ])
  })

  it('verlangt eine Begruendung und weist dieselbe Ablage ab', async () => {
    const id = await belegAnlegen('rechnung')
    await expect(ablageWechseln(ANNA, id, ABLAGE_SV, '  ')).rejects.toBeInstanceOf(AblagewechselAbgelehnt)
    await expect(ablageWechseln(ANNA, id, '', 'x')).rejects.toThrow(/Ablage wählen/)
    await expect(ablageWechseln(ANNA, id, ABLAGE_LR, 'x')).rejects.toThrow(/schon in dieser Ablage/)
  })

  it('in eine Ablage legen darf nur, wer dort bearbeiten darf', async () => {
    const id = await belegAnlegen('rechnung')
    const vorher = await rechteVon(ROLLE_OB)
    try {
      // Anna darf bearbeiten -- aber nur noch in Lieferantenrechnungen.
      await ablagerechteSetzen(ADMIN, ROLLE_OB, ['ansehen|alle', 'bearbeiten|' + ABLAGE_LR])
      await expect(ablageWechseln(ANNA, id, ABLAGE_SV, 'Test')).rejects.toThrow(/bearbeiten darf/)
      expect((await ablageVon(id)).ablage_id).toBe(ABLAGE_LR)
    } finally {
      await ablagerechteSetzen(ADMIN, ROLLE_OB, vorher)
    }
  })

  it('ein bearbeiten mit Belegartgeltung oeffnet den Wechsel nur fuer diese Belegart', async () => {
    const rechnung = await belegAnlegen('rechnung')
    const brief = await belegAnlegen('schriftverkehr')
    await alsEigentuemer((c) =>
      c.query("update rolle_recht set belegart = 'rechnung' where rolle_id = $1 and aktion = 'bearbeiten' and belegart is null", [
        ROLLE_OB,
      ]),
    )
    try {
      await expect(ablageWechseln(ANNA, brief, ABLAGE_LR, 'Test')).rejects.toThrow(/bearbeiten darf/)
      await expect(ablageWechseln(ANNA, rechnung, ABLAGE_SV, 'Test')).resolves.toMatchObject({ nach: 'Schriftverkehr' })
    } finally {
      await alsEigentuemer((c) =>
        c.query("update rolle_recht set belegart = null where rolle_id = $1 and aktion = 'bearbeiten' and belegart = 'rechnung'", [
          ROLLE_OB,
        ]),
      )
    }
  })

  it('ein fremder Mandant findet den Beleg nicht', async () => {
    const id = await belegAnlegen('rechnung')
    await expect(ablageWechseln(DORIS, id, ABLAGE_SV, 'Test')).rejects.toThrow(/nicht sichtbar/)
  })
})
