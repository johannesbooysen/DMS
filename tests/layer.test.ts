/**
 * Tests der Layer (Konzept 16).
 *
 * Drei Zusagen werden geprüft:
 *
 *   * **Das Original bleibt bitgenau.** Alles liegt daneben — auch nach vier
 *     Stempeln ist die Datei dieselbe.
 *   * **Ein Stempel entsteht aus seinem Ereignis, nie von Hand.** Sonst gäbe
 *     es Stempel ohne Ereignis, und der Beleg widerspräche dem Protokoll.
 *   * **Die Sichtbarkeit ist je Layer steuerbar.** Eine interne Notiz geht
 *     nie nach draußen, eine Schwärzung immer.
 */

import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { laufStarten, stempeln } from '../src/workflow/engine'
import { einsichtGewaehren, einsichtLayer, pdfDarfHinaus } from '../src/einsicht'
import {
  gehtNachDraussen,
  LayerAbgelehnt,
  layerAnlegen,
  layerAusblenden,
  layerLaden,
} from '../src/layer'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

let dokumentId: string

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/** Ein aufbereiteter Beleg: Seite 1 kennt ihre freien Stempelplätze. */
beforeEach(async () => {
  const [d] = await direkt<{ id: string }>(
    `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                           inhalt_hash, storage_praefix, status)
     values ($1, $2, 'rechnung', 'upload', 'hash-layer-test',
             'test/layer', 'laufend')
     returning id`,
    [MANDANT, OBJEKT_42],
  )
  dokumentId = d.id

  await direkt(
    `insert into dokument_seite (dokument_id, seite, text, breite, hoehe, freie_bloecke)
     values ($1, 1, 'Rechnung', 595, 842, $2::jsonb)`,
    [
      dokumentId,
      JSON.stringify([
        { x: 393, y: 12, breite: 190, hoehe: 64 },
        { x: 393, y: 88, breite: 190, hoehe: 64 },
      ]),
    ],
  )
})

afterEach(async () => {
  await belegEntfernen(dokumentId)
})

afterAll(poolSchliessen)

describe('Layer von Hand', () => {
  it('legt eine Notiz an und liefert sie zurueck', async () => {
    const id = await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'notiz',
      seite: 1,
      x: 100,
      y: 200,
      breite: 160,
      hoehe: 40,
      text: 'Rueckfrage an die Buchhaltung',
    })
    expect(id).not.toBeNull()

    const [layer] = await layerLaden(ANNA, dokumentId)
    expect(layer.typ).toBe('notiz')
    expect(layer.text).toBe('Rueckfrage an die Buchhaltung')
    expect(layer.erstelltVon).toBe('Anna Ahrens')
    // Vorgabe ist intern -- die sichere Richtung.
    expect(layer.sichtbarkeit).toBe('intern')
  })

  it('weist eine Notiz ohne Text ab', async () => {
    await expect(
      layerAnlegen(ANNA, {
        dokumentId,
        typ: 'notiz',
        seite: 1,
        x: 10,
        y: 10,
        breite: 50,
        hoehe: 20,
        text: '   ',
      }),
    ).rejects.toThrow(LayerAbgelehnt)
  })

  it('weist einen Layer ohne Flaeche ab', async () => {
    await expect(
      layerAnlegen(ANNA, {
        dokumentId,
        typ: 'highlight',
        seite: 1,
        x: 10,
        y: 10,
        breite: 0,
        hoehe: 20,
      }),
    ).rejects.toThrow(LayerAbgelehnt)
  })

  it('laesst keinen Stempel von Hand anlegen', async () => {
    // Ein Stempel ohne Ereignis waere ein Beleg, der dem Protokoll
    // widerspricht.
    await expect(
      direkt(`select app.layer_anlegen($1, 'stempel', 1, 1, 1, 10, 10, null, 'alle')`, [
        dokumentId,
      ]),
    ).rejects.toThrow(/Ereignis/)
  })

  it('setzt eine Schwaerzung immer auf sichtbar', async () => {
    await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'schwaerzung',
      seite: 1,
      x: 60,
      y: 300,
      breite: 200,
      hoehe: 16,
      sichtbarkeit: 'intern',
    })

    const [layer] = await layerLaden(ANNA, dokumentId)
    // Eine Schwaerzung verdeckt. Sie auf `intern` zu setzen hiesse, dass sie
    // nach aussen verschwindet -- und damit das Verdeckte sichtbar wird.
    expect(layer.sichtbarkeit).toBe('alle')
    expect(gehtNachDraussen(layer)).toBe(true)
  })
})

describe('Ausblenden', () => {
  it('nimmt die Notiz vom Beleg, aber nicht aus der Tabelle', async () => {
    const id = await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'notiz',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
      text: 'weg damit',
    })

    expect(await layerAusblenden(ANNA, String(id))).toBe(true)
    expect(await layerLaden(ANNA, dokumentId)).toEqual([])

    // Die Zeile bleibt: Eine Notiz, die spurlos verschwindet, macht den
    // Beleg unerklaerbar.
    const [zeile] = await direkt<{ geloescht_von: string }>(
      'select geloescht_von from dokument_layer where id = $1',
      [id],
    )
    expect(zeile.geloescht_von).toBe(ANNA)
  })

  it('blendet zweimal nicht zweimal aus', async () => {
    const id = await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'highlight',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
    })
    expect(await layerAusblenden(ANNA, String(id))).toBe(true)
    expect(await layerAusblenden(ANNA, String(id))).toBe(false)
  })

  it('holt einen ausgeblendeten Layer nicht zurueck', async () => {
    const id = await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'highlight',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
    })
    await layerAusblenden(ANNA, String(id))

    await expect(
      direkt('update dokument_layer set geloescht_am = null, geloescht_von = null where id = $1', [
        id,
      ]),
    ).rejects.toThrow(/kommt nicht zurueck/)
  })

  it('laesst den Text einer Notiz nicht nachtraeglich aendern', async () => {
    const id = await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'notiz',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
      text: 'so war es gemeint',
    })

    // Wer den Text aendern koennte, koennte eine Entscheidung umschreiben,
    // die jemand anders getroffen hat.
    await expect(
      direkt(`update dokument_layer set inhalt_text = 'so nicht' where id = $1`, [id]),
    ).rejects.toThrow(/nicht geaendert/)
  })
})

describe('Mandantengrenze', () => {
  it('zeigt Doris die Layer eines fremden Belegs nicht', async () => {
    await layerAnlegen(ANNA, {
      dokumentId,
      typ: 'notiz',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
      text: 'intern',
    })

    expect(await layerLaden(ANNA, dokumentId)).toHaveLength(1)
    expect(await layerLaden(DORIS, dokumentId)).toEqual([])
  })

  it('laesst Doris keinen Layer an einem fremden Beleg anlegen', async () => {
    // `layer_anlegen` sieht den Beleg nicht und legt deshalb nichts an --
    // die Policy ist die Grenze, nicht eine Pruefung im Code.
    expect(
      await layerAnlegen(DORIS, {
        dokumentId,
        typ: 'notiz',
        seite: 1,
        x: 10,
        y: 10,
        breite: 50,
        hoehe: 20,
        text: 'fremd',
      }),
    ).toBeNull()
  })
})

/**
 * Der Stempel entsteht aus seinem Ereignis.
 *
 * Das ist die Verbindung zwischen Konzept 8 („Stempel sind Ereignisse") und
 * Konzept 16 („alles liegt neben dem PDF"): Der Layer ist die *Darstellung*
 * des Ereignisses. Deshalb ein Trigger und nicht ein Aufruf in der Anwendung
 * — ein Ereignis ohne Layer wäre ein Stempel, den man im Beleg nicht sieht,
 * und niemand wüsste, ob er fehlt oder nie gesetzt wurde.
 */
describe('Stempel-Layer', () => {
  async function stempelnAmBeleg(entscheidung = 'freigabe'): Promise<void> {
    await alsBenutzer(ANNA, async (c) => {
      const lauf = await laufStarten(c, dokumentId)
      const { rows } = await c.query<{ stufe_id: string }>(
        `select stufe_id from aufgabe where lauf_id = $1 and status = 'offen' limit 1`,
        [lauf!.laufId],
      )
      await stempeln(c, {
        laufId: lauf!.laufId,
        stufeId: rows[0].stufe_id,
        benutzerId: ANNA,
        entscheidung: entscheidung as never,
      })
    })
  }

  it('entsteht mit dem Ereignis, auf dem ersten freien Platz', async () => {
    await stempelnAmBeleg()

    const [layer] = await layerLaden(ANNA, dokumentId)
    expect(layer.typ).toBe('stempel')
    expect(layer.seite).toBe(1)
    // Der erste Platz aus `freie_bloecke` -- rechts oben.
    expect(layer.x).toBe(393)
    expect(layer.y).toBe(12)
    expect(layer.text).toContain('Anna Ahrens')
    // Stempel gehen mit nach draussen: Wer einen Beleg zur Einsicht bekommt,
    // soll sehen, dass und von wem er geprueft wurde.
    expect(layer.sichtbarkeit).toBe('alle')
  })

  it('laesst das Original unberuehrt', async () => {
    const [vorher] = await direkt<{ inhalt_hash: string }>(
      'select inhalt_hash from dokument where id = $1',
      [dokumentId],
    )
    await stempelnAmBeleg()
    const [nachher] = await direkt<{ inhalt_hash: string }>(
      'select inhalt_hash from dokument where id = $1',
      [dokumentId],
    )

    // Alles liegt neben dem PDF, nichts darin -- der Hash im Archiv gilt
    // weiter, auch nachdem gestempelt wurde.
    expect(nachher.inhalt_hash).toBe(vorher.inhalt_hash)
  })

  it('setzt den zweiten Stempel auf den zweiten Platz', async () => {
    await stempelnAmBeleg()
    await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ id: string; stufe_id: string }>(
        `select l.id, a.stufe_id
           from dokument_lauf l
           join aufgabe a on a.lauf_id = l.id and a.status = 'offen'
          where l.dokument_id = $1 limit 1`,
        [dokumentId],
      )
      if (rows.length === 0) return
      await stempeln(c, {
        laufId: rows[0].id,
        stufeId: rows[0].stufe_id,
        benutzerId: ANNA,
        entscheidung: 'freigabe',
      })
    })

    const stempel = (await layerLaden(ANNA, dokumentId)).filter((l) => l.typ === 'stempel')
    expect(stempel).toHaveLength(2)
    // Kein Stempel ueberdeckt einen anderen.
    expect(stempel[1].y).toBe(88)
  })

  it('setzt Seite 0, wenn kein Platz mehr ist', async () => {
    await direkt(`update dokument_seite set freie_bloecke = '[]'::jsonb where dokument_id = $1`, [
      dokumentId,
    ])
    await stempelnAmBeleg()

    const [layer] = await layerLaden(ANNA, dokumentId)
    // Seite 0 heisst "gehoert auf eine angehaengte Leerseite". Ein Stempel
    // darf nie verloren gehen, nur weil die Seite voll ist.
    expect(layer.seite).toBe(0)
  })

  it('blendet den Stempel aus, wenn die Freigabe verfaellt', async () => {
    await stempelnAmBeleg()
    expect(await layerLaden(ANNA, dokumentId)).toHaveLength(1)

    await alsBenutzer(ANNA, async (c) => {
      const { rows } = await c.query<{ id: string; stufe_id: string | null }>(
        `select e.lauf_id as id, e.stufe_id from stempel_ereignis e
           join dokument_lauf l on l.id = e.lauf_id
          where l.dokument_id = $1 order by e.folge limit 1`,
        [dokumentId],
      )
      await c.query(
        `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, entscheidung, eintrag_hash)
         values ($1, $2, $3, 'verfallen', 'test')`,
        [rows[0].id, rows[0].stufe_id, ANNA],
      )
    })

    // Ein Beleg mit Stempeln, von denen einer nicht mehr gilt, muss beim
    // Ansehen als solcher erkennbar sein.
    expect(await layerLaden(ANNA, dokumentId)).toEqual([])
  })

  it('laesst sich nicht von Hand ausblenden', async () => {
    await stempelnAmBeleg()
    const [layer] = await layerLaden(ANNA, dokumentId)

    // Ein Stempel verfaellt -- das ist ein Ereignis, kein Handgriff an der
    // Darstellung.
    expect(await layerAusblenden(ANNA, layer.id)).toBe(false)
    expect(await layerLaden(ANNA, dokumentId)).toHaveLength(1)
  })
})

/**
 * Was die externe Einsicht von den Layern sieht.
 *
 * Hier laufen zwei Regeln zusammen, die einzeln harmlos aussehen und
 * zusammen zählen: Eine interne Notiz darf nie hinaus, und eine Schwärzung
 * muss immer hinaus. Die zweite ist die gefährlichere — eine Schwärzung, die
 * beim Ausliefern fehlt, zeigt genau das, was verdeckt werden sollte.
 */
describe('Einsicht', () => {
  const MEIKE = '85000000-0000-0000-0000-000000000001'
  // Der Seed-Beleg: Nur er erfuellt die gerechnete Mietersicht (umlagefaehige
  // Kontierungszeile und Ueberschneidung mit der Mietzeit). Ein frisch
  // angelegter Beleg wird von `einsicht_darf_beleg` zu Recht abgelehnt.
  const D1 = '70000000-0000-0000-0000-000000000001'

  // Der Seed-Beleg hat keine erfassten Seitenmasse -- fuer die Umrechnung
  // der Layerkoordinaten braucht es sie.
  beforeEach(async () => {
    await direkt(
      'update dokument_seite set breite = 595, hoehe = 842 where dokument_id = $1',
      [D1],
    )
  })

  async function gewaehrungAnlegen(): Promise<string> {
    const { gewaehrungId } = await einsichtGewaehren(ANNA, {
      objektId: OBJEKT_42,
      personId: MEIKE,
      empfaengerTyp: 'mieter',
      umfang: 'belegliste',
      tage: 7,
    })
    return gewaehrungId
  }

  afterEach(async () => {
    const c = await verbindungspool().connect()
    try {
      await c.query('alter table zugriff_protokoll disable trigger zugriff_protokoll_unveraenderlich')
      await c.query('delete from zugriff_protokoll')
      await c.query('delete from einsicht_gewaehrung')
      await c.query('delete from dokument_layer where dokument_id = $1', [D1])
    } finally {
      await c.query('alter table zugriff_protokoll enable trigger zugriff_protokoll_unveraenderlich')
      c.release()
    }
  })

  it('reicht eine Schwaerzung hinaus, auch wenn sie intern gesetzt wurde', async () => {
    await layerAnlegen(ANNA, {
      dokumentId: D1,
      typ: 'schwaerzung',
      seite: 1,
      x: 60,
      y: 300,
      breite: 200,
      hoehe: 16,
      sichtbarkeit: 'intern',
    })
    const gewaehrungId = await gewaehrungAnlegen()

    const { layer, seitenbreite } = await einsichtLayer(gewaehrungId, D1, 1)
    expect(layer.map((l) => l.typ)).toContain('schwaerzung')
    // Ohne die Seitenbreite laesst sich nichts umrechnen -- dann laege die
    // Schwaerzung an der falschen Stelle.
    expect(seitenbreite).toBe(595)
  })

  it('behaelt eine interne Notiz drinnen', async () => {
    await layerAnlegen(ANNA, {
      dokumentId: D1,
      typ: 'notiz',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
      text: 'Kreditor mahnt seit Wochen',
      sichtbarkeit: 'intern',
    })
    const gewaehrungId = await gewaehrungAnlegen()

    const { layer } = await einsichtLayer(gewaehrungId, D1, 1)
    expect(layer).toEqual([])
  })

  it('reicht eine ausdruecklich freigegebene Notiz hinaus', async () => {
    await layerAnlegen(ANNA, {
      dokumentId: D1,
      typ: 'notiz',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
      text: 'Anteil laut Beschluss',
      sichtbarkeit: 'extern',
    })
    const gewaehrungId = await gewaehrungAnlegen()

    const { layer } = await einsichtLayer(gewaehrungId, D1, 1)
    expect(layer.map((l) => l.text)).toEqual(['Anteil laut Beschluss'])
  })

  it('legt die Schwaerzung zuletzt, damit sie oben liegt', async () => {
    await layerAnlegen(ANNA, {
      dokumentId: D1,
      typ: 'schwaerzung',
      seite: 1,
      x: 60,
      y: 300,
      breite: 200,
      hoehe: 16,
    })
    await layerAnlegen(ANNA, {
      dokumentId: D1,
      typ: 'notiz',
      seite: 1,
      x: 10,
      y: 10,
      breite: 50,
      hoehe: 20,
      text: 'sichtbar',
      sichtbarkeit: 'extern',
    })
    const gewaehrungId = await gewaehrungAnlegen()

    const { layer } = await einsichtLayer(gewaehrungId, D1, 1)
    // Zuerst gesetzt, aber zuletzt gezeichnet: Eine Schwaerzung unter einer
    // Hervorhebung waere keine.
    expect(layer.at(-1)?.typ).toBe('schwaerzung')
  })

  it('sperrt den PDF-Download, sobald geschwaerzt wurde', async () => {
    expect(await pdfDarfHinaus(D1)).toBe(true)

    await layerAnlegen(ANNA, {
      dokumentId: D1,
      typ: 'schwaerzung',
      seite: 1,
      x: 60,
      y: 300,
      breite: 200,
      hoehe: 16,
    })

    // Ein schwarzes Rechteck in einem PDF verdeckt den Text nur optisch --
    // er bleibt markierbar. Also geht der Beleg nur als Bild hinaus.
    expect(await pdfDarfHinaus(D1)).toBe(false)
  })

  it('gibt den Download wieder frei, wenn die Schwaerzung ausgeblendet wird', async () => {
    const id = await layerAnlegen(ANNA, {
      dokumentId: D1,
      typ: 'schwaerzung',
      seite: 1,
      x: 60,
      y: 300,
      breite: 200,
      hoehe: 16,
    })
    await layerAusblenden(ANNA, String(id))
    expect(await pdfDarfHinaus(D1)).toBe(true)
  })
})

describe('Was nach draussen geht', () => {
  const grund = (typ: string, sichtbarkeit: string) =>
    gehtNachDraussen({
      typ,
      sichtbarkeit,
    } as never)

  it('laesst interne Notizen drinnen', () => {
    expect(grund('notiz', 'intern')).toBe(false)
  })

  it('laesst ausdruecklich freigegebene Notizen hinaus', () => {
    expect(grund('notiz', 'extern')).toBe(true)
    expect(grund('notiz', 'alle')).toBe(true)
  })

  it('laesst Schwaerzungen immer hinaus', () => {
    // Eine Schwaerzung, die drinnen bleibt, zeigt draussen das Verdeckte.
    expect(grund('schwaerzung', 'intern')).toBe(true)
  })

  it('laesst Stempel hinaus', () => {
    // Wer einen Beleg zur Einsicht bekommt, soll sehen, dass und von wem er
    // geprueft wurde (Konzept 16).
    expect(grund('stempel', 'alle')).toBe(true)
  })
})
