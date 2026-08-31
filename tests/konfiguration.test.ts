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
  NichtMoeglich,
} from '../src/workflow/konfiguration'
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
afterEach(async () => {
  const c = await verbindungspool().connect()
  try {
    await c.query(
      `update prozessdefinition
          set status = 'abgeloest', entwurf_von = null, entwurf_seit = null, aktiv_bis = now()
        where id <> $1 and status in ('entwurf', 'aktiv')`,
      [DEFINITION_AKTIV],
    )
    await c.query(
      `update prozessdefinition set status = 'aktiv', aktiv_bis = null where id = $1`,
      [DEFINITION_AKTIV],
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
      // Drei Stufen mit drei, zwei und drei Stempeln.
      expect(Number(rows[0].anzahl)).toBe(8)
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
    expect(nachher!.kinder.map((k) => k.stufe?.bezeichnung)).toEqual([
      namenVorher[1],
      namenVorher[0],
      namenVorher[2],
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
    expect(await entwurfPruefung(EVA, entwurf)).toEqual([])

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
