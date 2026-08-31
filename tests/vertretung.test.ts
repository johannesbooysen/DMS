/**
 * Tests der Vertretung.
 *
 * Die entscheidende Aussage steht in Konzept 22, Entscheidung 8: Die Aufgabe
 * wandert, die Rolle bleibt. Der wichtigste Test hier ist deshalb nicht, dass
 * eine Vertretung wirkt — sondern dass sie **keine Rechte** mitgibt.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { aufgabeLaden, persoenlichesPostfach } from '../src/app/lib/postfach'
import { laufStarten } from '../src/workflow/engine'
import {
  meineVertretungen,
  VertretungAbgelehnt,
  vertretungAnlegen,
  vertretungWiderrufen,
} from '../src/workflow/vertretung'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const CLARA = '20000000-0000-0000-0000-000000000003'
const EVA = '20000000-0000-0000-0000-000000000005'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const OBJEKT_43 = '50000000-0000-0000-0000-000000000043'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'

const angelegteBelege: string[] = []

/** Legt einen Beleg an — aber noch ohne Lauf, damit die Vertretung vorher steht. */
async function belegAnlegen(): Promise<string> {
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, inhalt_hash, storage_praefix)
       values ($1, $2, 'rechnung', $3, 'mail', md5(random()::text),
               'test/' || gen_random_uuid())
       returning id`,
      [MANDANT, OBJEKT_42, ORDNUNGSGRUPPE_BK],
    )
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto)
       values ($1, $2, 'RE-VERTRETUNG', current_date, 1000, 190, 1190)`,
      [rows[0].id, KREDITOR],
    )
    return rows[0].id
  })
  angelegteBelege.push(id)
  return id
}

async function laufStartenFuer(dokumentId: string): Promise<void> {
  await alsBenutzer(ANNA, (c) => laufStarten(c, dokumentId))
}

beforeEach(async () => {
  const c = await verbindungspool().connect()
  try {
    await c.query('delete from delegation')
  } finally {
    c.release()
  }
})

afterEach(async () => {
  const c = await verbindungspool().connect()
  try {
    await c.query('alter table stempel_ereignis disable trigger stempel_ereignis_unveraenderlich')
    await c.query('delete from dokument where id = any($1)', [angelegteBelege])
    await c.query('delete from delegation')
  } finally {
    await c.query('alter table stempel_ereignis enable trigger stempel_ereignis_unveraenderlich')
    c.release()
  }
  angelegteBelege.length = 0
})

afterAll(poolSchliessen)

describe('Vertretung anlegen', () => {
  it('legt eine Vertretung fuer sich selbst an', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND, grund: 'Urlaub' })
    const { abgegeben } = await meineVertretungen(ANNA)
    expect(abgegeben).toHaveLength(1)
    expect(abgegeben[0].anName).toBe('Bernd Bruns')
    expect(abgegeben[0].gilt).toBe(true)
  })

  it('zeigt sie auch dem Vertreter', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND })
    const { uebernommen } = await meineVertretungen(BERND)
    expect(uebernommen.map((v) => v.vonName)).toEqual(['Anna Ahrens'])
  })

  it('weist die Vertretung an sich selbst ab', async () => {
    await expect(vertretungAnlegen(ANNA, { anBenutzer: ANNA })).rejects.toThrow(
      VertretungAbgelehnt,
    )
  })

  it('weist ein Ende vor dem Beginn ab', async () => {
    await expect(
      vertretungAnlegen(ANNA, {
        anBenutzer: BERND,
        gueltigVon: '2026-09-10',
        gueltigBis: '2026-09-01',
      }),
    ).rejects.toThrow(/Ende darf nicht vor dem Beginn/)
  })

  it('laesst niemanden ohne Recht fuer einen anderen delegieren', async () => {
    // Anna darf ihre eigenen Aufgaben weitergeben, aber nicht die von Clara.
    await expect(
      vertretungAnlegen(ANNA, { vonBenutzer: CLARA, anBenutzer: BERND }),
    ).rejects.toThrow(VertretungAbgelehnt)
  })

  it('erlaubt es der Geschaeftsleitung, die das Recht traegt', async () => {
    const id = await vertretungAnlegen(EVA, { vonBenutzer: ANNA, anBenutzer: BERND })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('Wirkung auf neue Aufgaben', () => {
  it('lenkt die Aufgabe an den Vertreter', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND, grund: 'Urlaub' })
    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)

    expect((await persoenlichesPostfach(BERND)).map((z) => z.dokumentId)).toContain(beleg)
    expect((await persoenlichesPostfach(ANNA)).map((z) => z.dokumentId)).not.toContain(beleg)
  })

  it('vermerkt an der Aufgabe, dass eine Vertretung gewirkt hat', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND })
    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)

    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query<{ wegen_delegation: string | null }>(
        `select a.wegen_delegation from aufgabe a
           join dokument_lauf l on l.id = a.lauf_id where l.dokument_id = $1`,
        [beleg],
      )
      expect(rows[0].wegen_delegation).not.toBeNull()
    } finally {
      c.release()
    }
  })

  it('greift nicht bei einer Vertretung fuer ein anderes Objekt', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND, objektId: OBJEKT_43 })
    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)

    expect((await persoenlichesPostfach(ANNA)).map((z) => z.dokumentId)).toContain(beleg)
  })

  it('greift nicht bei einer Vertretung fuer eine andere Stufenart', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND, stufentyp: 'kontierung' })
    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)

    expect((await persoenlichesPostfach(ANNA)).map((z) => z.dokumentId)).toContain(beleg)
  })

  it('greift ausserhalb des Zeitfensters nicht', async () => {
    await vertretungAnlegen(ANNA, {
      anBenutzer: BERND,
      gueltigVon: '2026-01-01',
      gueltigBis: '2026-01-31',
    })
    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)

    expect((await persoenlichesPostfach(ANNA)).map((z) => z.dokumentId)).toContain(beleg)
  })

  it('greift nach dem Widerruf nicht mehr', async () => {
    const id = await vertretungAnlegen(ANNA, { anBenutzer: BERND })
    await vertretungWiderrufen(ANNA, id)

    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)

    expect((await persoenlichesPostfach(ANNA)).map((z) => z.dokumentId)).toContain(beleg)
  })

  it('laesst bereits zugewiesene Aufgaben unberuehrt', async () => {
    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)
    // Erst danach die Vertretung -- wer eine Aufgabe schon hat, behaelt sie.
    await vertretungAnlegen(ANNA, { anBenutzer: BERND })

    expect((await persoenlichesPostfach(ANNA)).map((z) => z.dokumentId)).toContain(beleg)
    expect((await persoenlichesPostfach(BERND)).map((z) => z.dokumentId)).not.toContain(beleg)
  })
})

describe('Vertretung uebertraegt keine Rechte', () => {
  it('gibt dem Vertreter nur die Stempel, die seine eigenen Rollen hergeben', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND, grund: 'Urlaub' })
    const beleg = await belegAnlegen()
    await laufStartenFuer(beleg)

    const aufgabe = (await persoenlichesPostfach(BERND)).find((z) => z.dokumentId === beleg)
    const geladen = await aufgabeLaden(BERND, aufgabe!.aufgabeId)

    // Bernd hat die Aufgabe, aber nicht Annas Stempelrechte: An der
    // sachlichen Pruefung bleibt ihm nur die Klaerung.
    expect(geladen?.stempel.map((s) => s.name)).toEqual(['Zur Klaerung'])
  })

  it('aendert die Rollen des Vertreters nicht', async () => {
    await vertretungAnlegen(ANNA, { anBenutzer: BERND })

    const rechte = await alsBenutzer(BERND, async (c) => {
      const { rows } = await c.query<{ darf: boolean }>(
        `select app.darf('bearbeiten') as darf`,
      )
      return rows[0].darf
    })
    // "bearbeiten" traegt die Objektbearbeitung, nicht die Buchhaltung.
    expect(rechte).toBe(false)
  })
})
