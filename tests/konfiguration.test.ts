/**
 * Tests des Baukastens.
 *
 * Geprüft wird vor allem, was ein Baukasten gefährlich machen würde:
 * Bearbeiten der laufenden Fassung, gleichzeitiges Arbeiten zweier Personen,
 * Scharfschalten eines ungültigen Ablaufs, Konfigurieren ohne Recht.
 *
 * Wie der Postfachtest schreibt dieser fest und räumt danach auf.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { poolSchliessen, verbindungspool } from '../src/db'
import {
  definitionenLaden,
  entwurfAktivieren,
  entwurfAnlegen,
  entwurfPruefung,
  fassungSimulieren,
  knotenEinfuegen,
  knotenEntfernen,
  knotenVerschieben,
  NichtErlaubt,
} from '../src/workflow/konfiguration'
import {
  auswahlLaden,
  stempelJeStufe,
  stufeAendern,
  stufeAnlegen,
  stufeEntfernen,
  type Stufeneingabe,
} from '../src/workflow/stufen'
import { baumFuerAnzeige } from '../src/workflow/konfiguration'
import { alleBlaetter } from '../src/workflow/baum'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const EVA = '20000000-0000-0000-0000-000000000005'
const DEFINITION_AKTIV = '65000000-0000-0000-0000-000000000001'

/**
 * Aufräumen ohne Löschen.
 *
 * Der erste Versuch löschte die angelegten Fassungen — und lief in den
 * Append-only-Schutz des Protokolls, der auch die Kaskade abfängt. Das ist
 * richtig so: Eine aktivierte Fassung ist die Erklärung dafür, warum ein
 * Beleg seinen Weg genommen hat, und verschwindet nicht.
 *
 * Die Testfassungen werden deshalb abgelöst statt entfernt. Das gibt auch
 * den Platz im Index für den nächsten Entwurf wieder frei.
 */
/**
 * Die Definitionen aus dem Seed -- Rechnung und Schriftverkehr.
 *
 * Was dieser Test anlegt, wird abgeraeumt; was der Seed mitbringt, bleibt.
 */
const SEED_DEFINITIONEN = [
  DEFINITION_AKTIV,
  '65000000-0000-0000-0000-000000000002',
]

afterEach(async () => {
  const c = await verbindungspool().connect()
  try {
    /*
     * Nur die Entwuerfe dieses Tests, nicht alles ausser der Rechnung.
     *
     * Vorher stand hier `id <> DEFINITION_AKTIV`. Das raeumte auch die
     * Definitionen des Seeds weg, die dieser Test nie angelegt hat -- mit
     * der zweiten Belegart fiel es auf: Die Stufenfolge fuer Schriftverkehr
     * war nach diesem afterEach abgeloest, und ein Test in einer spaeteren
     * Datei fand sie nicht mehr. Aufraeumen heisst den Seed wiederherstellen,
     * nicht ihn zusammenstreichen.
     */
    await c.query(
      `update prozessdefinition
          set status = 'abgeloest', entwurf_von = null, entwurf_seit = null, aktiv_bis = now()
        where id <> all($1::uuid[]) and status in ('entwurf', 'aktiv')`,
      [SEED_DEFINITIONEN],
    )
    await c.query(
      `update prozessdefinition set status = 'aktiv', aktiv_bis = null
        where id = any($1::uuid[])`,
      [SEED_DEFINITIONEN],
    )
  } finally {
    c.release()
  }
})

afterAll(poolSchliessen)

describe('Recht am Baukasten', () => {
  it('laesst die Geschaeftsleitung einen Entwurf anlegen', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    expect(entwurf).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('verweigert es dem Objektbearbeiter', async () => {
    // Anna darf stempeln, aber nicht den Ablauf aendern -- zwei verschiedene
    // Rechte, absichtlich getrennt.
    await expect(entwurfAnlegen(ANNA, DEFINITION_AKTIV)).rejects.toThrow(NichtErlaubt)
  })

  it('verweigert es der Buchhaltung', async () => {
    await expect(entwurfAnlegen(BERND, DEFINITION_AKTIV)).rejects.toThrow(NichtErlaubt)
  })
})

describe('Entwurf', () => {
  it('kopiert Stufen und Baum vollstaendig', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)

    const vorlage = await baumFuerAnzeige(EVA, DEFINITION_AKTIV)
    const kopie = await baumFuerAnzeige(EVA, entwurf)

    expect(alleBlaetter(kopie!).map((b) => b.stufe?.bezeichnung)).toEqual(
      alleBlaetter(vorlage!).map((b) => b.stufe?.bezeichnung),
    )
  })

  it('gibt der Kopie eigene Stufen -- sonst aendert sie laufende Belege mit', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const vorlage = await baumFuerAnzeige(EVA, DEFINITION_AKTIV)
    const kopie = await baumFuerAnzeige(EVA, entwurf)

    const alteIds = alleBlaetter(vorlage!).map((b) => b.stufe?.id)
    for (const blatt of alleBlaetter(kopie!)) {
      expect(alteIds).not.toContain(blatt.stufe?.id)
    }
  })

  it('uebernimmt auch die erlaubten Stempel je Stufe', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query<{ anzahl: string }>(
        `select count(*) as anzahl from prozessstufe_stempeltyp pst
           join prozessstufe s on s.id = pst.stufe_id
          where s.definition_id = $1`,
        [entwurf],
      )
      // Fuenf Stufen mit drei, zwei, drei, zwei und zwei Stempeln.
      expect(Number(rows[0].anzahl)).toBe(12)
    } finally {
      c.release()
    }
  })

  it('laesst keinen zweiten Entwurf zu derselben Belegart zu', async () => {
    await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    await expect(entwurfAnlegen(EVA, DEFINITION_AKTIV)).rejects.toThrow(/bereits einen Entwurf/)
  })

  it('verweigert das Bearbeiten der aktiven Fassung', async () => {
    const wurzel = await baumFuerAnzeige(EVA, DEFINITION_AKTIV)
    await expect(
      knotenEinfuegen(EVA, DEFINITION_AKTIV, {
        elternId: wurzel!.id,
        knotentyp: 'gleichzeitig',
      }),
    ).rejects.toThrow(/keine aktive Fassung/)
  })
})

describe('Bausteine bearbeiten', () => {
  it('haengt einen Baustein an und zaehlt ihn mit', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const wurzel = await baumFuerAnzeige(EVA, entwurf)
    const vorher = wurzel!.kinder.length

    await knotenEinfuegen(EVA, entwurf, { elternId: wurzel!.id, knotentyp: 'gleichzeitig' })

    const nachher = await baumFuerAnzeige(EVA, entwurf)
    expect(nachher!.kinder).toHaveLength(vorher + 1)
  })

  it('vertauscht zwei Geschwister', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const wurzel = await baumFuerAnzeige(EVA, entwurf)
    const namenVorher = wurzel!.kinder.map((k) => k.stufe?.bezeichnung)

    await knotenVerschieben(EVA, entwurf, wurzel!.kinder[1].id, 'hoch')

    const nachher = await baumFuerAnzeige(EVA, entwurf)
    // Nur die ersten beiden tauschen; der Rest der Kette bleibt, wo er war.
    expect(nachher!.kinder.map((k) => k.stufe?.bezeichnung)).toEqual([
      namenVorher[1],
      namenVorher[0],
      ...namenVorher.slice(2),
    ])
  })

  it('bewegt den obersten Baustein nicht weiter nach oben', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const wurzel = await baumFuerAnzeige(EVA, entwurf)
    const vorher = wurzel!.kinder.map((k) => k.id)

    await knotenVerschieben(EVA, entwurf, wurzel!.kinder[0].id, 'hoch')

    const nachher = await baumFuerAnzeige(EVA, entwurf)
    expect(nachher!.kinder.map((k) => k.id)).toEqual(vorher)
  })

  it('laesst die Wurzel weder bewegen noch entfernen', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const wurzel = await baumFuerAnzeige(EVA, entwurf)

    await expect(knotenVerschieben(EVA, entwurf, wurzel!.id, 'runter')).rejects.toThrow(/Wurzel/)
    await expect(knotenEntfernen(EVA, entwurf, wurzel!.id)).rejects.toThrow(/Wurzel/)
  })

  it('weist eine Bedingung ausserhalb der Weissliste ab', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const wurzel = await baumFuerAnzeige(EVA, entwurf)

    await expect(
      knotenEinfuegen(EVA, entwurf, {
        elternId: wurzel!.id,
        knotentyp: 'verzweigung',
        bedingung: { feld: 'iban_im_beleg', op: '=', wert: 'DE00' },
      }),
    ).rejects.toThrow(/steht nicht zur Verfügung/)
  })
})

describe('Aktivieren', () => {
  it('schaltet einen gueltigen Entwurf scharf und loest die alte Fassung ab', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    await entwurfAktivieren(EVA, entwurf)

    const fassungen = await definitionenLaden(EVA)
    expect(fassungen.find((f) => f.id === entwurf)?.status).toBe('aktiv')
    expect(fassungen.find((f) => f.id === DEFINITION_AKTIV)?.status).toBe('abgeloest')
  })

  it('weigert sich bei einem ungueltigen Ablauf', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const wurzel = await baumFuerAnzeige(EVA, entwurf)
    // Ein leerer Behaelter: strukturell erlaubt, fachlich sinnlos.
    await knotenEinfuegen(EVA, entwurf, { elternId: wurzel!.id, knotentyp: 'gleichzeitig' })

    await expect(entwurfAktivieren(EVA, entwurf)).rejects.toThrow(/nicht gültig/)

    // Und die alte Fassung laeuft unveraendert weiter.
    const fassungen = await definitionenLaden(EVA)
    expect(fassungen.find((f) => f.id === DEFINITION_AKTIV)?.status).toBe('aktiv')
  })

  it('meldet die Befunde vor dem Aktivieren', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    // Nur Fehler, nicht alle Befunde: Seit der Ausfuehrbarkeitspruefung
    // (20260916100000) warnt der Seed zu Recht an jeder Stufe -- dort kann
    // genau eine Person entscheiden. Eine Warnung ist kein Hindernis.
    const vorher = await entwurfPruefung(EVA, entwurf)
    expect(vorher.filter((b) => b.schwere === 'fehler')).toEqual([])

    const wurzel = await baumFuerAnzeige(EVA, entwurf)
    await knotenEinfuegen(EVA, entwurf, { elternId: wurzel!.id, knotentyp: 'gleichzeitig' })

    const befunde = await entwurfPruefung(EVA, entwurf)
    expect(befunde.some((b) => b.schwere === 'fehler')).toBe(true)
  })

  it('protokolliert, wer aktiviert hat', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    await entwurfAktivieren(EVA, entwurf)

    const c = await verbindungspool().connect()
    try {
      const { rows } = await c.query<{ art: string; benutzer_id: string }>(
        'select art, benutzer_id from prozessdefinition_ereignis where definition_id = $1 order by zeitpunkt',
        [entwurf],
      )
      expect(rows.map((r) => r.art)).toEqual(['angelegt', 'aktiviert'])
      expect(rows[1].benutzer_id).toBe(EVA)
    } finally {
      c.release()
    }
  })

  it('laesst das Protokoll nicht nachtraeglich aendern', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const c = await verbindungspool().connect()
    try {
      await expect(
        c.query(`update prozessdefinition_ereignis set art = 'aktiviert' where definition_id = $1`, [
          entwurf,
        ]),
      ).rejects.toThrow(/append-only/i)
    } finally {
      c.release()
    }
  })
})

describe('Simulation', () => {
  it('zeigt die Kette fuer einen gedachten Beleg', async () => {
    const schritte = await fassungSimulieren(EVA, DEFINITION_AKTIV, {
      brutto: 3000,
      belegart: 'rechnung',
    })
    expect(schritte.flatMap((s) => s.stufen.map((st) => st.bezeichnung))).toEqual([
      'Sachliche Pruefung',
      'Rechnerische Pruefung',
      'Freigabe Geschaeftsleitung',
      'Kontierung',
      'Zahlungsuebergabe',
    ])
  })

  it('zeigt dieselbe Fassung fuer verschiedene Belege verschieden', async () => {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const c = await verbindungspool().connect()
    try {
      await c.query(
        `update prozessstufe set betrag_von = 5000
          where definition_id = $1 and bezeichnung = 'Freigabe Geschaeftsleitung'`,
        [entwurf],
      )
    } finally {
      c.release()
    }

    const klein = await fassungSimulieren(EVA, entwurf, { brutto: 1200 })
    const gross = await fassungSimulieren(EVA, entwurf, { brutto: 9000 })

    expect(klein.flatMap((s) => s.stufen.map((st) => st.bezeichnung))).not.toContain(
      'Freigabe Geschaeftsleitung',
    )
    expect(gross.flatMap((s) => s.stufen.map((st) => st.bezeichnung))).toContain(
      'Freigabe Geschaeftsleitung',
    )
  })
})

describe('Stufen als Liste', () => {
  const STUFE = (teil: Partial<Stufeneingabe> = {}): Stufeneingabe => ({
    bezeichnung: 'Beiratsfreigabe',
    stufentyp: 'freigabe',
    zustaendigkeitTyp: 'rolle',
    zustaendigkeitRef: null,
    betragVon: 1000,
    betragBis: null,
    pflicht: true,
    slaStunden: 48,
    stempeltypIds: [],
    ...teil,
  })

  async function vorbereiten() {
    const entwurf = await entwurfAnlegen(EVA, DEFINITION_AKTIV)
    const auswahl = await auswahlLaden(EVA)
    const rolle = auswahl.rollen.find((r) => r.name.match(/Gesch/))?.id ?? auswahl.rollen[0]!.id
    const freigabe = auswahl.stempeltypen.find((t) => t.entscheidung === 'freigabe')!.id
    const klaerung = auswahl.stempeltypen.find((t) => t.entscheidung === 'klaerung')!.id
    return { entwurf, rolle, freigabe, klaerung }
  }

  it('legt eine Stufe an, haengt sie in den Baum und ordnet die Stempel zu', async () => {
    const { entwurf, rolle, freigabe, klaerung } = await vorbereiten()
    const vorher = alleBlaetter((await baumFuerAnzeige(EVA, entwurf))!).length

    const stufeId = await stufeAnlegen(EVA, entwurf, STUFE({ zustaendigkeitRef: rolle, stempeltypIds: [freigabe, klaerung] }))

    const baum = (await baumFuerAnzeige(EVA, entwurf))!
    const blaetter = alleBlaetter(baum)
    expect(blaetter).toHaveLength(vorher + 1)
    const neu = blaetter.at(-1)!.stufe!
    expect(neu.id).toBe(stufeId)
    expect(neu.bezeichnung).toBe('Beiratsfreigabe')
    expect(neu.betragVon).toBe(1000)
    expect(neu.zustaendigkeitRef).toBe(rolle)
    expect((await stempelJeStufe(EVA, entwurf)).get(stufeId)?.map((s) => s.id)).toEqual([freigabe, klaerung])

    // Und die Simulation kennt sie: Bei 3.000 EUR steht sie in der Kette, bei 500 nicht.
    const gross = await fassungSimulieren(EVA, entwurf, { brutto: 3000, belegart: 'rechnung' })
    expect(gross.flatMap((s) => s.stufen.map((x) => x.bezeichnung))).toContain('Beiratsfreigabe')
    const klein = await fassungSimulieren(EVA, entwurf, { brutto: 500, belegart: 'rechnung' })
    expect(klein.flatMap((s) => s.stufen.map((x) => x.bezeichnung))).not.toContain('Beiratsfreigabe')
  })

  it('aendert eine Stufe und ersetzt die Stempel als Ganzes', async () => {
    const { entwurf, rolle, freigabe, klaerung } = await vorbereiten()
    const stufeId = await stufeAnlegen(EVA, entwurf, STUFE({ zustaendigkeitRef: rolle, stempeltypIds: [freigabe, klaerung] }))

    await stufeAendern(EVA, entwurf, stufeId, STUFE({ bezeichnung: 'Beirat', zustaendigkeitRef: rolle, betragVon: 2500, stempeltypIds: [freigabe] }))

    const stufe = alleBlaetter((await baumFuerAnzeige(EVA, entwurf))!).find((b) => b.stufe?.id === stufeId)!.stufe!
    expect(stufe.bezeichnung).toBe('Beirat')
    expect(stufe.betragVon).toBe(2500)
    expect((await stempelJeStufe(EVA, entwurf)).get(stufeId)?.map((s) => s.id)).toEqual([freigabe])
  })

  it('entfernt eine Stufe samt Blatt', async () => {
    const { entwurf, rolle } = await vorbereiten()
    const vorher = alleBlaetter((await baumFuerAnzeige(EVA, entwurf))!).length
    const stufeId = await stufeAnlegen(EVA, entwurf, STUFE({ zustaendigkeitRef: rolle }))
    await stufeEntfernen(EVA, entwurf, stufeId)
    expect(alleBlaetter((await baumFuerAnzeige(EVA, entwurf))!)).toHaveLength(vorher)
  })

  it('weist ab, was nicht zusammenpasst -- und sagt, was fehlt', async () => {
    const { entwurf, rolle } = await vorbereiten()
    await expect(stufeAnlegen(EVA, entwurf, STUFE({ bezeichnung: '  ', zustaendigkeitRef: rolle }))).rejects.toThrow(/Bezeichnung/)
    await expect(stufeAnlegen(EVA, entwurf, STUFE({ zustaendigkeitRef: null }))).rejects.toThrow(/braucht eine Auswahl/)
    await expect(stufeAnlegen(EVA, entwurf, STUFE({ stufentyp: 'zauber', zustaendigkeitRef: rolle }))).rejects.toThrow(/Stufentyp/)
    await expect(
      stufeAnlegen(EVA, entwurf, STUFE({ zustaendigkeitRef: rolle, betragVon: 1000, betragBis: 500 })),
    ).rejects.toThrow(/Betrag bis/)
  })

  it('nimmt keinen Stempel und keine Rolle aus einem anderen Haus', async () => {
    const { entwurf, rolle } = await vorbereiten()
    // Doris' Haus: Was dort existiert, findet die Fremdschluesselpruefung --
    // die Policy nicht. Genau das unterscheidet "gibt es" von "gehoert uns".
    // Das Haus Sued hat im Seed weder Stempel noch Rollen; beides wird hier
    // als Eigentuemer angelegt und danach wieder entfernt.
    const c = await verbindungspool().connect()
    const SUED = '10000000-0000-0000-0000-000000000002'
    let fremderStempel = ''
    let fremdeRolle = ''
    try {
      fremderStempel = (
        await c.query<{ id: string }>(
          `insert into stempeltyp (mandant_id, name, kurzcode, entscheidung)
           values ($1, 'Fremdstempel', 'FREMD-TEST', 'freigabe') returning id`,
          [SUED],
        )
      ).rows[0]!.id
      fremdeRolle = (
        await c.query<{ id: string }>(
          `insert into rolle (mandant_id, name, kurzcode) values ($1, 'Fremdrolle', 'FREMD-TEST') returning id`,
          [SUED],
        )
      ).rows[0]!.id
      await expect(
        stufeAnlegen(EVA, entwurf, STUFE({ zustaendigkeitRef: rolle, stempeltypIds: [fremderStempel] })),
      ).rejects.toThrow(/nicht zu diesem Haus/)
      await expect(stufeAnlegen(EVA, entwurf, STUFE({ zustaendigkeitRef: fremdeRolle }))).rejects.toThrow(
        /gibt es nicht/,
      )
    } finally {
      await c.query('delete from stempeltyp where id = $1', [fremderStempel])
      await c.query('delete from rolle where id = $1', [fremdeRolle])
      c.release()
    }
  })

  it('verlangt das Recht und einen Entwurf', async () => {
    const { entwurf, rolle } = await vorbereiten()
    await expect(stufeAnlegen(BERND, entwurf, STUFE({ zustaendigkeitRef: rolle }))).rejects.toThrow(NichtErlaubt)
    await expect(stufeAnlegen(EVA, DEFINITION_AKTIV, STUFE({ zustaendigkeitRef: rolle }))).rejects.toThrow(/Entwurf/)
  })
})
