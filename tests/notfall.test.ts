/**
 * Tests des Notfallzugriffs (Konzept §24.10).
 *
 * Die tragende Zusicherung dieser Datei ist **„Reichweite, nie Art"**: Ein
 * Notfallzugriff erweitert den Geltungsbereich vorhandener Rechte auf ein
 * weiteres Objekt — er verleiht kein neues. Wer nie stempeln durfte,
 * stempelt auch im Notfall nicht, und die vier Verwaltungsaktionen bleiben
 * ganz außen vor. Ohne diese Grenze wäre der Notfallzugriff die bequeme
 * Hintertür in ein Rechtemodell, das sonst an einer Stelle nachprüfbar ist.
 *
 * Die Lage im Seed passt dafür genau: Anna trägt die Objektbearbeitung
 * **nur für Objekt 42**. Objekt 43 sieht sie nicht — bis Eva ihr den Zugriff
 * einrichtet.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  HOECHSTDAUER_TAGE,
  NichtErlaubt,
  NichtMoeglich,
  beenden,
  einrichten,
  laufende,
} from '../src/notfall'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const DORIS = '20000000-0000-0000-0000-000000000004' // fremder Mandant
const EVA = '20000000-0000-0000-0000-000000000005' // Geschaeftsleitung
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042' // Annas Objekt
const OBJEKT_43 = '50000000-0000-0000-0000-000000000043' // nicht Annas Objekt
const ROLLE_OB = '90000000-0000-0000-0000-000000000001'

const GRUND = 'Vertretung fuer Objekt 43 waehrend Abwesenheit'

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/** Sieht dieser Benutzer das Objekt? Geprüft an der RLS selbst. */
async function siehtObjekt(benutzerId: string, objektId: string): Promise<boolean> {
  const { rowCount } = await alsBenutzer(benutzerId, (c) =>
    c.query('select 1 from objekt where id = $1', [objektId]),
  )
  return (rowCount ?? 0) > 0
}

async function darf(benutzerId: string, aktion: string, objektId: string): Promise<boolean> {
  const { rows } = await alsBenutzer(benutzerId, (c) =>
    c.query<{ d: boolean }>('select app.darf($1, $2) as d', [aktion, objektId]),
  )
  return rows[0]?.d === true
}

/** Legt einen laufenden Zugriff unmittelbar an, ohne den Weg über Eva. */
async function zugriffAnlegen(benutzerId: string, objektId: string, tage = 3): Promise<string> {
  const [z] = await direkt<{ id: string }>(
    `insert into notfallzugriff
       (mandant_id, benutzer_id, objekt_id, grund, ende, angelegt_von)
     values ((select mandant_id from benutzer where id = $1), $1, $2, $3,
             now() + make_interval(days => $4::integer), $5)
     returning id`,
    [benutzerId, objektId, GRUND, tage, EVA],
  )
  return z.id
}

afterEach(async () => {
  // Der Schutztrigger dieser Tabelle weist das Loeschen ab -- genau das
  // prueft ein Test weiter unten. Zum Aufraeumen wird er kurz abgeschaltet,
  // wie in den anderen Dateien mit append-only-Tabellen auch.
  await direkt('alter table notfallzugriff disable trigger notfallzugriff_unveraenderlich')
  try {
    await direkt('delete from notfallzugriff')
  } finally {
    await direkt('alter table notfallzugriff enable trigger notfallzugriff_unveraenderlich')
  }
  await direkt("delete from rolle_recht where aktion = 'stammdaten_pflegen' and rolle_id = $1", [
    ROLLE_OB,
  ])
})

afterAll(poolSchliessen)

describe('Ohne Notfallzugriff', () => {
  it('sieht Anna nur ihr eigenes Objekt', async () => {
    expect(await siehtObjekt(ANNA, OBJEKT_42)).toBe(true)
    expect(await siehtObjekt(ANNA, OBJEKT_43)).toBe(false)
  })
})

describe('Die Reichweite', () => {
  it('macht das fremde Objekt sichtbar', async () => {
    await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await siehtObjekt(ANNA, OBJEKT_43)).toBe(true)
  })

  it('nimmt ein Recht mit, das anderswo schon gilt', async () => {
    // Anna darf stempeln -- aber ihre Rollenzuweisung haengt an Objekt 42.
    expect(await darf(ANNA, 'stempeln', OBJEKT_43)).toBe(false)

    await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await darf(ANNA, 'stempeln', OBJEKT_43)).toBe(true)
  })

  it('verleiht kein Recht, das die Person nie hatte', async () => {
    /*
     * **Der Kern der Sache.** Anna hat kein `kontieren` -- in keiner Rolle,
     * auf keinem Objekt. Ein Notfallzugriff, der ihr das gaebe, waere eine
     * Rechteaenderung und genau das, was das Konzept ausschliesst.
     */
    await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await darf(ANNA, 'kontieren', OBJEKT_43)).toBe(false)
  })

  it('laesst die Verwaltungsrechte aussen vor', async () => {
    /*
     * Anna bekommt `stammdaten_pflegen` an ihrer Rolle -- die haengt an
     * Objekt 42, also gilt es dort und sonst nirgends. Genau wie `stempeln`
     * wuerde es sich sonst auf das gedeckte Objekt ausdehnen. Tut es nicht:
     * Wer im Notfall Stammdaten pflegen oder Rollen vergeben darf, gibt sich
     * jedes Recht dauerhaft selbst.
     */
    await direkt(
      "insert into rolle_recht (rolle_id, aktion) values ($1, 'stammdaten_pflegen')",
      [ROLLE_OB],
    )
    expect(await darf(ANNA, 'stammdaten_pflegen', OBJEKT_42)).toBe(true)

    await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await darf(ANNA, 'stempeln', OBJEKT_43)).toBe(true)
    expect(await darf(ANNA, 'stammdaten_pflegen', OBJEKT_43)).toBe(false)
  })

  it('laesst die Rollenvergabe unberuehrt', async () => {
    // Der eigentliche Grund fuer die eigene Tabelle: Nach dem Notfall steht
    // in `benutzer_rolle_objekt` keine Zustaendigkeit, die es nie gab.
    const vorher = await direkt('select count(*) as n from benutzer_rolle_objekt')
    await zugriffAnlegen(ANNA, OBJEKT_43)
    const nachher = await direkt('select count(*) as n from benutzer_rolle_objekt')
    expect(nachher).toEqual(vorher)
  })
})

describe('Die Befristung', () => {
  it('endet mit dem Ablauf', async () => {
    await direkt(
      `insert into notfallzugriff
         (mandant_id, benutzer_id, objekt_id, grund, beginn, ende, angelegt_von)
       values ((select mandant_id from benutzer where id = $1), $1, $2, $3,
               now() - interval '3 days', now() - interval '1 day', $4)`,
      [ANNA, OBJEKT_43, GRUND, EVA],
    )
    // Abgelaufen heisst weg -- ohne dass jemand aufraeumen muss.
    expect(await siehtObjekt(ANNA, OBJEKT_43)).toBe(false)
    expect(await darf(ANNA, 'stempeln', OBJEKT_43)).toBe(false)
  })

  it('endet mit dem vorzeitigen Beenden', async () => {
    const id = await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await siehtObjekt(ANNA, OBJEKT_43)).toBe(true)

    await alsBenutzer(EVA, (c) => beenden(c, id))
    expect(await siehtObjekt(ANNA, OBJEKT_43)).toBe(false)
  })

  it('laesst den Betroffenen selbst beenden', async () => {
    // Anna kommt frueher zurueck und soll nicht warten muessen.
    const id = await zugriffAnlegen(ANNA, OBJEKT_43)
    await alsBenutzer(ANNA, (c) => beenden(c, id))
    expect(await siehtObjekt(ANNA, OBJEKT_43)).toBe(false)
  })

  it('weist eine Dauer ueber der Hoechstgrenze ab', async () => {
    await expect(
      alsBenutzer(EVA, (c) =>
        einrichten(c, {
          benutzerId: ANNA,
          objektId: OBJEKT_43,
          grund: GRUND,
          tage: HOECHSTDAUER_TAGE + 1,
        }),
      ),
    ).rejects.toThrow(NichtMoeglich)
  })

  it('weist sie auch dann ab, wenn die Anwendung uebergangen wird', async () => {
    // Die Grenze steht als Check in der Datenbank, nicht nur im Modul --
    // sonst haengt sie an dem einen Weg, der sie prueft.
    await expect(
      direkt(
        `insert into notfallzugriff
           (mandant_id, benutzer_id, objekt_id, grund, ende, angelegt_von)
         values ((select mandant_id from benutzer where id = $1), $1, $2, $3,
                 now() + interval '60 days', $4)`,
        [ANNA, OBJEKT_43, GRUND, EVA],
      ),
    ).rejects.toThrow(/hoechstdauer/i)
  })
})

describe('Der Grund', () => {
  it('ist Pflicht', async () => {
    await expect(
      alsBenutzer(EVA, (c) =>
        einrichten(c, { benutzerId: ANNA, objektId: OBJEKT_43, grund: 'weil', tage: 3 }),
      ),
    ).rejects.toThrow(NichtMoeglich)
  })

  it('laesst sich nachtraeglich nicht umschreiben', async () => {
    // Ein nachtraeglich geaenderter Notfallzugriff waere kein Nachweis mehr.
    const id = await zugriffAnlegen(ANNA, OBJEKT_43)
    await expect(
      direkt('update notfallzugriff set grund = $2 where id = $1', [id, 'ein anderer Grund']),
    ).rejects.toThrow(/nicht geaendert/i)
  })

  it('haelt den Eintrag gegen das Loeschen', async () => {
    const id = await zugriffAnlegen(ANNA, OBJEKT_43)
    await expect(direkt('delete from notfallzugriff where id = $1', [id])).rejects.toThrow(
      /nicht geloescht/i,
    )
  })
})

describe('Das Recht, einen einzurichten', () => {
  it('hat die Geschaeftsleitung', async () => {
    const id = await alsBenutzer(EVA, (c) =>
      einrichten(c, { benutzerId: ANNA, objektId: OBJEKT_43, grund: GRUND, tage: 3 }),
    )
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await siehtObjekt(ANNA, OBJEKT_43)).toBe(true)
  })

  it('hat sonst niemand', async () => {
    // Bernd pflegt Stammdaten und sieht mandantenweit -- einen
    // Notfallzugriff einrichten darf er trotzdem nicht.
    await expect(
      alsBenutzer(BERND, (c) =>
        einrichten(c, { benutzerId: ANNA, objektId: OBJEKT_43, grund: GRUND, tage: 3 }),
      ),
    ).rejects.toThrow(NichtErlaubt)
  })

  it('gibt sich niemand ueber einen Notfallzugriff selbst', async () => {
    // `notfallzugriff` steht auf der Ausschlussliste -- sonst waere der
    // erste Zugriff der Schluessel zu allen weiteren.
    await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await darf(ANNA, 'notfallzugriff', OBJEKT_43)).toBe(false)
  })
})

describe('Die Sichtbarkeit', () => {
  it('zeigt den Zugriff allen im Mandanten', async () => {
    /*
     * Der Ersatz fuer die Vorabfreigabe, die im Notfall niemand geben kann:
     * Bernd ist unbeteiligt und sieht ihn trotzdem. Ein Zugriff, den nur der
     * Zugreifende sieht, waere eine leise Hintertuer.
     */
    await zugriffAnlegen(ANNA, OBJEKT_43)

    const beiBernd = await alsBenutzer(BERND, laufende)
    expect(beiBernd).toHaveLength(1)
    expect(beiBernd[0]?.benutzer).toBe('Anna Ahrens')
    expect(beiBernd[0]?.objektnummer).toBe('43')
    expect(beiBernd[0]?.eigener).toBe(false)

    const beiAnna = await alsBenutzer(ANNA, laufende)
    expect(beiAnna[0]?.eigener).toBe(true)
  })

  it('zeigt einem fremden Mandanten nichts', async () => {
    // Projektregel: Jede lesende Funktion braucht diesen Test. Hier zaehlt
    // er doppelt -- die Funktion ist `security definer` und traegt den
    // Mandantenfilter von Hand.
    await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await alsBenutzer(DORIS, laufende)).toHaveLength(0)
  })

  it('zeigt abgelaufene und beendete nicht mehr', async () => {
    const id = await zugriffAnlegen(ANNA, OBJEKT_43)
    expect(await alsBenutzer(BERND, laufende)).toHaveLength(1)

    await alsBenutzer(EVA, (c) => beenden(c, id))
    expect(await alsBenutzer(BERND, laufende)).toHaveLength(0)
  })
})
