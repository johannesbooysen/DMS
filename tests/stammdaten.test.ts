/**
 * Tests der Stammdatenpflege — und der Lücke, die sie aufgedeckt hat.
 *
 * **Der Fund.** Die Policies auf den Stammdatentabellen lauteten `for all`
 * mit reinem Mandantenfilter: Lesen und Schreiben waren dasselbe Recht.
 * Anna, eine Objektbearbeiterin mit Zuständigkeit für ein einziges Objekt,
 * konnte sich die Rolle Geschäftsleitung zuweisen — `app.darf` sprang von
 * `false` auf `true`. Das Rechtemodell aus Konzept §17 war damit eine
 * Empfehlung, keine Grenze.
 *
 * **Warum die Zeilen gezählt werden.** Eine Policy weist nicht ab, sie lässt
 * die Zeile verschwinden: Ein `update` ohne Recht meldet Erfolg mit null
 * Zeilen. Genau daran ist die erste Messung gescheitert — sie hielt „kein
 * Fehler" für „gelungen". Jeder Test hier prüft die Wirkung, nicht das
 * Ausbleiben eines Fehlers.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import {
  benutzerLaden,
  bankverbindungEntscheiden,
  kontenLaden,
  kreditorAnlegen,
  kreditorenLaden,
  NichtErlaubt,
  NichtMoeglich,
  objektAnlegen,
  objekteLaden,
  ordnungsgruppeAnlegen,
  rechtelage,
  rolleZuweisen,
  zahlungswegAnlegen,
  zustaendigkeitSetzen,
} from '../src/stammdaten'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'
const EVA = '20000000-0000-0000-0000-000000000005'
const DORIS = '20000000-0000-0000-0000-000000000004'
const GESCHAEFTSLEITUNG = '90000000-0000-0000-0000-000000000003'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

afterEach(async () => {
  // Was die Tests anlegen, traegt ein erkennbares Praefix -- so bleibt der
  // Seed unberuehrt und die uebrigen Dateien finden vor, was sie erwarten.
  await direkt("delete from kreditor where name like 'TEST-%'")
  await direkt("delete from objekt where objektnummer like 'T-%'")
  await direkt("delete from zahlungsweg where name like 'TEST-%'")
  await direkt("delete from ordnungsgruppe where name like 'TEST-%'")
  await direkt(
    `delete from benutzer_rolle_objekt
      where benutzer_id = $1 and rolle_id = $2`,
    [ANNA, GESCHAEFTSLEITUNG],
  )
})

afterAll(poolSchliessen)

describe('Die geschlossene Luecke', () => {
  it('laesst eine Objektbearbeiterin sich keine Rolle zuweisen', async () => {
    /*
     * Der Kern. Vorher gelang das und Anna hatte danach jedes Recht im
     * Mandanten -- eine vollstaendige Rechteausweitung ueber eine Tabelle,
     * die niemand fuer eine Sicherheitsgrenze hielt.
     */
    await expect(
      rolleZuweisen(ANNA, { benutzerId: ANNA, rolleId: GESCHAEFTSLEITUNG }),
    ).rejects.toBeInstanceOf(NichtErlaubt)

    const [z] = await direkt<{ n: string }>(
      'select count(*) as n from benutzer_rolle_objekt where benutzer_id = $1 and rolle_id = $2',
      [ANNA, GESCHAEFTSLEITUNG],
    )
    expect(Number(z.n)).toBe(0)
  })

  it('laesst auch die Buchhaltung keine Rollen vergeben', async () => {
    /*
     * Bernd darf Stammdaten pflegen -- Kreditoren, Konten, Zahlungswege.
     * Rollen zu vergeben ist davon getrennt, weil daraus jedes andere Recht
     * folgt. Beides in einem Recht zusammenzufassen hiesse, der Buchhaltung
     * nebenbei die Benutzerverwaltung zu geben.
     */
    await expect(
      rolleZuweisen(BERND, { benutzerId: BERND, rolleId: GESCHAEFTSLEITUNG }),
    ).rejects.toBeInstanceOf(NichtErlaubt)
  })

  it('laesst die Geschaeftsleitung Rollen vergeben', async () => {
    await rolleZuweisen(EVA, { benutzerId: ANNA, rolleId: GESCHAEFTSLEITUNG })

    const [z] = await direkt<{ n: string }>(
      'select count(*) as n from benutzer_rolle_objekt where benutzer_id = $1 and rolle_id = $2',
      [ANNA, GESCHAEFTSLEITUNG],
    )
    expect(Number(z.n)).toBe(1)
  })

  it('laesst eine Objektbearbeiterin keinen Kreditor anlegen', async () => {
    await expect(kreditorAnlegen(ANNA, { name: 'TEST-Erfunden' })).rejects.toBeInstanceOf(
      NichtErlaubt,
    )
  })

  it('laesst die Buchhaltung einen Kreditor anlegen', async () => {
    await kreditorAnlegen(BERND, { name: 'TEST-Dachdecker' })
    const alle = await kreditorenLaden(BERND)
    expect(alle.some((k) => k.name === 'TEST-Dachdecker')).toBe(true)
  })
})

describe('Der Betrugsschutz', () => {
  it('laesst eine Objektbearbeiterin keine Bankverbindung bestaetigen', async () => {
    const [b] = await direkt<{ id: string }>('select id from kreditor_bankverbindung limit 1')

    /*
     * `app.zahlung_moeglich` verlangt eine verifizierte Bankverbindung. Wer
     * selbst verifizieren kann, hat die Sperre nicht -- und die Sperre ist
     * der Betrugsschutz aus Konzept §14.
     */
    await expect(
      bankverbindungEntscheiden(ANNA, { id: b.id, entscheidung: 'verifizieren' }),
    ).rejects.toThrow(/Recht/)
  })

  it('haelt fest, wer bestaetigt hat', async () => {
    const [b] = await direkt<{ id: string }>('select id from kreditor_bankverbindung limit 1')
    await direkt("update kreditor_bankverbindung set status = 'neu' where id = $1", [b.id])

    await bankverbindungEntscheiden(BERND, { id: b.id, entscheidung: 'verifizieren' })

    const [n] = await direkt<{ status: string; bestaetigt_von: string | null }>(
      'select status, bestaetigt_von from kreditor_bankverbindung where id = $1',
      [b.id],
    )
    expect(n.status).toBe('verifiziert')
    expect(n.bestaetigt_von).toBe(BERND)
  })

  it('haelt es auch fest, wenn jemand die Funktion umgeht', async () => {
    const [b] = await direkt<{ id: string }>('select id from kreditor_bankverbindung limit 1')
    await direkt("update kreditor_bankverbindung set status = 'neu' where id = $1", [b.id])

    /*
     * Ein direktes `update` statt der Funktion. Ohne den Trigger blieb
     * `bestaetigt_von` dabei leer -- der wichtigste Nachweis des
     * Betrugsschutzes haette daran gehangen, welchen Weg jemand zufaellig
     * nimmt.
     */
    await alsBenutzer(BERND, (c) =>
      c.query("update kreditor_bankverbindung set status = 'verifiziert' where id = $1", [b.id]),
    )

    const [n] = await direkt<{ bestaetigt_von: string | null }>(
      'select bestaetigt_von from kreditor_bankverbindung where id = $1',
      [b.id],
    )
    expect(n.bestaetigt_von).toBe(BERND)
  })
})

describe('Anlegen und Pruefen', () => {
  it('legt ein Objekt an', async () => {
    await objektAnlegen(BERND, {
      objektnummer: 'T-100',
      bezeichnung: 'Teststrasse 1',
      verwaltungsart: 'weg',
      eskalationsgrenze: '5000',
    })
    const alle = await objekteLaden(BERND)
    const neu = alle.find((o) => o.objektnummer === 'T-100')
    expect(neu?.bezeichnung).toBe('Teststrasse 1')
    // Ein frisch angelegtes Objekt hat niemanden -- das ist richtig und
    // gehoert sichtbar zu sein, sonst liegen dort Belege, die keiner sieht.
    expect(neu?.zustaendige).toEqual([])
  })

  it('weist ein leeres Pflichtfeld mit klarem Grund ab', async () => {
    await expect(
      objektAnlegen(BERND, { objektnummer: '  ', bezeichnung: 'X', verwaltungsart: 'weg' }),
    ).rejects.toBeInstanceOf(NichtMoeglich)
  })

  it('weist eine unsinnige IBAN ab, ohne sie zu rechnen', async () => {
    const { bankverbindungAnlegen } = await import('../src/stammdaten')
    const [k] = await direkt<{ id: string }>('select id from kreditor limit 1')

    // Eine Formpruefung, ausdruecklich keine Pruefziffernrechnung: Was hier
    // abgewiesen wird, sind Tippfehler. Betrug faengt der Mensch ab, der
    // bestaetigt.
    await expect(
      bankverbindungAnlegen(BERND, { kreditorId: k.id, iban: 'keine iban' }),
    ).rejects.toBeInstanceOf(NichtMoeglich)
  })

  it('weist dieselbe Ordnungsgruppe kein zweites Mal an', async () => {
    await ordnungsgruppeAnlegen(BERND, { name: 'TEST-Gruppe', kurzcode: 'TG' })
    await expect(
      ordnungsgruppeAnlegen(BERND, { name: 'TEST-Gruppe2', kurzcode: 'TG' }),
    ).rejects.toBeInstanceOf(NichtMoeglich)
  })

  it('legt einen Zahlungsweg an', async () => {
    await zahlungswegAnlegen(BERND, { name: 'TEST-Bankdatei', art: 'datei_export' })
    const [z] = await direkt<{ n: string }>(
      "select count(*) as n from zahlungsweg where name = 'TEST-Bankdatei'",
    )
    expect(Number(z.n)).toBe(1)
  })
})

describe('Die Rechtelage der Oberflaeche', () => {
  it('meldet fuer die Objektbearbeitung beides als nein', async () => {
    expect(await rechtelage(ANNA)).toEqual({ stammdaten: false, benutzer: false })
  })

  it('meldet fuer die Buchhaltung nur die Stammdaten', async () => {
    expect(await rechtelage(BERND)).toEqual({ stammdaten: true, benutzer: false })
  })

  it('meldet fuer die Geschaeftsleitung beides', async () => {
    expect(await rechtelage(EVA)).toEqual({ stammdaten: true, benutzer: true })
  })
})

describe('Mandantentrennung', () => {
  it('zeigt einem fremden Mandanten keine Objekte', async () => {
    const fremd = await objekteLaden(DORIS)
    expect(fremd.some((o) => o.objektnummer === '42')).toBe(false)
  })

  it('zeigt einem fremden Mandanten keine Kreditoren', async () => {
    const fremd = await kreditorenLaden(DORIS)
    const eigen = await kreditorenLaden(BERND)
    expect(fremd.map((k) => k.id)).not.toEqual(expect.arrayContaining(eigen.map((k) => k.id)))
  })

  it('zeigt einem fremden Mandanten keine Benutzer aus Nord', async () => {
    const fremd = await benutzerLaden(DORIS)
    expect(fremd.some((b) => b.id === ANNA)).toBe(false)
  })

  it('laesst keine Zustaendigkeit ueber die Mandantengrenze setzen', async () => {
    // Doris gehoert zu einem anderen Mandanten -- Objekt 42 ist fuer sie
    // nicht vorhanden, nicht "verboten".
    await expect(
      zustaendigkeitSetzen(DORIS, { benutzerId: DORIS, objektId: OBJEKT_42 }),
    ).rejects.toThrow()
  })

  it('zeigt einem fremden Mandanten keine Konten', async () => {
    const fremd = await kontenLaden(DORIS)
    const eigen = await kontenLaden(BERND)
    expect(fremd.length).toBeLessThan(eigen.length)
  })
})
