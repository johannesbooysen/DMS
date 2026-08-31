/**
 * Tests der Nebenlaufmechanik.
 *
 * Geprüft werden die **zwei Mechanismen** aus Konzept 10 — nicht die
 * Versicherungs- und Technikabläufe. Die sind Prozessdefinitionen und gehören
 * in die Konfigurationstests.
 *
 * Der Wartecontainer hat genau eine Aufgabe: verhindern, dass ein Beleg still
 * liegen bleibt. Entsprechend dreht sich das Meiste hier um die
 * Wiedervorlage — sie ist Pflicht, sie muss in der Zukunft liegen, und ohne
 * Ergebnis wird nicht geschlossen.
 *
 * Bei der Gewährleistung ist der **Stichtag** die Pointe: Die Frage lautet
 * „war zum Schadenszeitpunkt Gewährleistung offen", nicht „ist sie heute
 * offen".
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  bauteilErfassen,
  bauteileLaden,
  gewaehrleistungOffen,
  WartenAbgelehnt,
  wartenBeenden,
  wartenBeginnen,
  wartendeLaden,
  wartenZumBeleg,
} from '../src/nebenlauf'
import { laufStarten } from '../src/workflow/engine'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const CLARA = '20000000-0000-0000-0000-000000000003'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const ORDNUNGSGRUPPE_BK = '40000000-0000-0000-0000-000000000001'

let beleg = ''

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

function inTagen(tage: number): string {
  const d = new Date()
  d.setDate(d.getDate() + tage)
  return d.toISOString().slice(0, 10)
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
       values ($1, $2, 'RE-NEBENLAUF', current_date, 1000, 190, 1190)`,
      [id, KREDITOR],
    )
    await laufStarten(c, id)
    return id
  })
})

afterEach(async () => {
  await belegEntfernen(beleg)
  await direkt('delete from bauteil')
})

afterAll(poolSchliessen)

async function warten(tage = 30) {
  return wartenBeginnen(ANNA, {
    dokumentId: beleg,
    art: 'zur Erstattung Vers.RE',
    ereignis: 'erstattung',
    wiedervorlageAm: inTagen(tage),
    erwarteterBetrag: 890,
  })
}

describe('Wartecontainer', () => {
  it('setzt den Lauf auf wartend', async () => {
    await warten()
    const [zeile] = await direkt<{ status: string }>(
      'select status from dokument_lauf where dokument_id = $1',
      [beleg],
    )
    // Ohne diesen Zustand waere der Beleg entweder eine offene Aufgabe, die
    // niemand bearbeiten kann, oder gar nichts.
    expect(zeile.status).toBe('wartend')
  })

  it('erscheint in der Wartenliste', async () => {
    const id = await warten()
    const zeilen = await wartendeLaden(ANNA)
    const meiner = zeilen.find((z) => z.containerId === id)
    expect(meiner?.art).toBe('zur Erstattung Vers.RE')
    expect(meiner?.erwarteterBetrag).toBe(890)
  })

  it('verlangt eine Wiedervorlage', async () => {
    await expect(
      wartenBeginnen(ANNA, {
        dokumentId: beleg,
        art: 'ohne Frist',
        ereignis: 'erstattung',
        wiedervorlageAm: '',
      }),
    ).rejects.toThrow()
  })

  it('verlangt eine Wiedervorlage in der Zukunft', async () => {
    // Eine Wiedervorlage von gestern ist keine.
    await expect(
      wartenBeginnen(ANNA, {
        dokumentId: beleg,
        art: 'rueckwaerts',
        ereignis: 'erstattung',
        wiedervorlageAm: inTagen(-1),
      }),
    ).rejects.toThrow(/Zukunft/)
  })

  it('verlangt eine Bezeichnung', async () => {
    await expect(
      wartenBeginnen(ANNA, {
        dokumentId: beleg,
        art: '   ',
        ereignis: 'erstattung',
        wiedervorlageAm: inTagen(10),
      }),
    ).rejects.toBeInstanceOf(WartenAbgelehnt)
  })

  it('braucht einen Lauf', async () => {
    const ohneLauf = await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                               inhalt_hash, storage_praefix)
         values ($1, $2, 'rechnung', 'mail', md5(random()::text),
                 'test/' || gen_random_uuid())
         returning id`,
        [MANDANT, OBJEKT_42],
      )
      return rows[0].id
    })
    try {
      await expect(
        wartenBeginnen(ANNA, {
          dokumentId: ohneLauf,
          art: 'ohne Lauf',
          ereignis: 'erstattung',
          wiedervorlageAm: inTagen(10),
        }),
      ).rejects.toBeInstanceOf(WartenAbgelehnt)
    } finally {
      await belegEntfernen(ohneLauf)
    }
  })
})

describe('Warten beenden', () => {
  it('schliesst den Container und setzt den Lauf fort', async () => {
    const id = await warten()
    expect(await wartenBeenden(ANNA, id, 'Erstattung eingegangen, 890,00')).toBe(true)

    const [zeile] = await direkt<{ status: string }>(
      'select status from dokument_lauf where dokument_id = $1',
      [beleg],
    )
    expect(zeile.status).toBe('laufend')
  })

  it('verlangt ein Ergebnis', async () => {
    const id = await warten()
    // Ein Container, der ohne Ergebnis endet, hinterlaesst die Frage, warum
    // nicht mehr gewartet wird.
    await expect(wartenBeenden(ANNA, id, '  ')).rejects.toThrow(/Ergebnis/)
  })

  it('laesst sich nicht zweimal schliessen', async () => {
    const id = await warten()
    await wartenBeenden(ANNA, id, 'erledigt')
    expect(await wartenBeenden(ANNA, id, 'nochmal')).toBe(false)
  })

  it('setzt den Lauf erst fort, wenn kein Container mehr offen ist', async () => {
    // Ein Beleg kann gleichzeitig auf eine Versicherungszahlung und auf eine
    // Gewaehrleistungsantwort warten.
    const eins = await warten(20)
    const zwei = await wartenBeginnen(ANNA, {
      dokumentId: beleg,
      art: 'Gewaehrleistung Firma Meier',
      ereignis: 'gewaehrleistungsantwort',
      wiedervorlageAm: inTagen(40),
    })

    await wartenBeenden(ANNA, eins, 'Erstattung da')
    const [zwischen] = await direkt<{ status: string }>(
      'select status from dokument_lauf where dokument_id = $1',
      [beleg],
    )
    expect(zwischen.status).toBe('wartend')

    await wartenBeenden(ANNA, zwei, 'Firma hat geantwortet')
    const [nachher] = await direkt<{ status: string }>(
      'select status from dokument_lauf where dokument_id = $1',
      [beleg],
    )
    expect(nachher.status).toBe('laufend')
  })

  it('haelt den Verlauf am Beleg fest', async () => {
    const id = await warten()
    await wartenBeenden(ANNA, id, 'Erstattung eingegangen')

    const verlauf = await alsBenutzer(ANNA, (c) => wartenZumBeleg(c, beleg))
    expect(verlauf).toHaveLength(1)
    expect(verlauf[0].ergebnis).toBe('Erstattung eingegangen')
    expect(verlauf[0].erledigtAm).not.toBeNull()
  })
})

describe('Faelligkeit', () => {
  it('meldet einen ueberfaelligen Container', async () => {
    const id = await warten(10)
    await direkt(
      `update wartecontainer set wiedervorlage_am = current_date - 3 where id = $1`,
      [id],
    )

    const zeilen = await wartendeLaden(ANNA, { nurFaellige: true })
    const meiner = zeilen.find((z) => z.containerId === id)
    expect(meiner?.ueberfaellig).toBe(true)
    expect(meiner?.ueberfaelligTage).toBe(3)
  })

  it('meldet einen nicht faelligen nicht', async () => {
    const id = await warten(30)
    const zeilen = await wartendeLaden(ANNA, { nurFaellige: true })
    expect(zeilen.map((z) => z.containerId)).not.toContain(id)
  })

  it('nimmt einen geschlossenen aus der Liste', async () => {
    const id = await warten(10)
    await direkt(
      `update wartecontainer set wiedervorlage_am = current_date - 1 where id = $1`,
      [id],
    )
    await wartenBeenden(ANNA, id, 'erledigt')
    expect((await wartendeLaden(ANNA)).map((z) => z.containerId)).not.toContain(id)
  })
})

describe('Gewaehrleistung', () => {
  async function bauteil(eigenschaften: { bis: string | null; name?: string }) {
    return bauteilErfassen(ANNA, {
      objektId: OBJEKT_42,
      bezeichnung: eigenschaften.name ?? 'Heizungspumpe',
      einbauAm: '2024-06-01',
      gewaehrleistungBis: eigenschaften.bis,
      lieferantId: KREDITOR,
    })
  }

  it('schlaegt ein Bauteil mit laufender Frist vor', async () => {
    const id = await bauteil({ bis: inTagen(200) })
    const offen = await gewaehrleistungOffen(ANNA, OBJEKT_42)
    expect(offen.map((b) => b.bauteilId)).toContain(id)
    expect(offen[0].lieferant).toBe('Musterreinigung GmbH')
  })

  it('laesst ein abgelaufenes Bauteil weg', async () => {
    const id = await bauteil({ bis: inTagen(-1) })
    const offen = await gewaehrleistungOffen(ANNA, OBJEKT_42)
    expect(offen.map((b) => b.bauteilId)).not.toContain(id)
  })

  it('laesst ein Bauteil ohne Frist weg', async () => {
    const id = await bauteil({ bis: null })
    const offen = await gewaehrleistungOffen(ANNA, OBJEKT_42)
    expect(offen.map((b) => b.bauteilId)).not.toContain(id)
  })

  it('antwortet zum Stichtag, nicht zum heutigen Tag', async () => {
    // Der eigentliche Punkt: Zwischen Schaden und Rechnung vergehen Wochen.
    // Wer heute fragt, verliert genau die Faelle, auf die es ankommt.
    const id = await bauteil({ bis: inTagen(-30) })

    expect((await gewaehrleistungOffen(ANNA, OBJEKT_42)).map((b) => b.bauteilId))
      .not.toContain(id)
    expect(
      (await gewaehrleistungOffen(ANNA, OBJEKT_42, inTagen(-60))).map((b) => b.bauteilId),
    ).toContain(id)
  })

  it('rechnet die Resttage', async () => {
    await bauteil({ bis: inTagen(100) })
    const offen = await gewaehrleistungOffen(ANNA, OBJEKT_42)
    expect(offen[0].resttage).toBe(100)
  })

  it('sortiert die naechste Frist nach oben', async () => {
    await bauteil({ bis: inTagen(300), name: 'Aufzug' })
    const bald = await bauteil({ bis: inTagen(20), name: 'Pumpe' })
    const offen = await gewaehrleistungOffen(ANNA, OBJEKT_42)
    expect(offen[0].bauteilId).toBe(bald)
  })
})

describe('Erneuerung haelt die Kette', () => {
  it('legt das alte Teil still und verkettet das neue', async () => {
    const alt = await bauteilErfassen(ANNA, {
      objektId: OBJEKT_42,
      bezeichnung: 'Heizungspumpe (2018)',
      einbauAm: '2018-03-01',
      gewaehrleistungBis: '2020-03-01',
    })
    const neu = await bauteilErfassen(ANNA, {
      objektId: OBJEKT_42,
      bezeichnung: 'Heizungspumpe (2026)',
      einbauAm: '2026-08-01',
      gewaehrleistungBis: inTagen(700),
      ersetztBauteilId: alt,
    })

    const alle = await bauteileLaden(ANNA, OBJEKT_42)
    const altesTeil = alle.find((b) => b.bauteilId === alt)
    const neuesTeil = alle.find((b) => b.bauteilId === neu)

    // Stillgelegt, nicht geloescht: Die Historie ist der Zweck der Tabelle.
    expect(altesTeil?.aktiv).toBe(false)
    expect(neuesTeil?.aktiv).toBe(true)
    expect(neuesTeil?.ersetztBauteilId).toBe(alt)
  })

  it('schlaegt das stillgelegte Teil nicht mehr vor', async () => {
    const alt = await bauteilErfassen(ANNA, {
      objektId: OBJEKT_42,
      bezeichnung: 'alte Pumpe',
      gewaehrleistungBis: inTagen(300),
    })
    expect((await gewaehrleistungOffen(ANNA, OBJEKT_42)).map((b) => b.bauteilId))
      .toContain(alt)

    await bauteilErfassen(ANNA, {
      objektId: OBJEKT_42,
      bezeichnung: 'neue Pumpe',
      gewaehrleistungBis: inTagen(700),
      ersetztBauteilId: alt,
    })
    expect((await gewaehrleistungOffen(ANNA, OBJEKT_42)).map((b) => b.bauteilId))
      .not.toContain(alt)
  })
})

describe('Die Sichtbarkeitsgrenze', () => {
  it('zeigt einem nicht zustaendigen Kollegen keinen Wartecontainer', async () => {
    await warten()
    expect(await wartendeLaden(CLARA)).toEqual([])
  })

  it('zeigt ihm auch keine Bauteile', async () => {
    await bauteilErfassen(ANNA, {
      objektId: OBJEKT_42,
      bezeichnung: 'Heizung',
      gewaehrleistungBis: inTagen(200),
    })
    expect(await gewaehrleistungOffen(CLARA, OBJEKT_42)).toEqual([])
    expect(await bauteileLaden(CLARA, OBJEKT_42)).toEqual([])
  })

  it('laesst ihn keinen Container schliessen', async () => {
    const id = await warten()
    expect(await wartenBeenden(CLARA, id, 'fremd')).toBe(false)
    // Und der Lauf wartet weiter.
    const [zeile] = await direkt<{ status: string }>(
      'select status from dokument_lauf where dokument_id = $1',
      [beleg],
    )
    expect(zeile.status).toBe('wartend')
  })
})
