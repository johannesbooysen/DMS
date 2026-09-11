/**
 * Tests der Kategoriezuordnung.
 *
 * Die Kategorie ist der Schluessel, an dem Mitarbeiter, Ablauf und Konto
 * haengen — eine falsche Kategorie verteilt den Beleg zuverlaessig an den
 * Falschen. Geprueft wird deshalb nicht nur, *was* vorgeschlagen wird,
 * sondern vor allem, wann die Ampel **faellt**:
 *
 *   * Die Angabe eines Menschen schlaegt jede Ableitung.
 *   * Uneinigkeit macht orange, nicht gruen.
 *   * Mehrere Kandidaten sind schlechter als keiner.
 *   * Kein Wissenstransfer ueber Mandantengrenzen.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { kategorieVorschlagen } from '../src/lernen/kategorie'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const MANDANT_SUED = '10000000-0000-0000-0000-000000000002'
const ANNA = '20000000-0000-0000-0000-000000000001'
const CLARA = '20000000-0000-0000-0000-000000000003'
const DORIS = '20000000-0000-0000-0000-000000000004'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const BETRIEBSKOSTEN = '40000000-0000-0000-0000-000000000001'
const VERSICHERUNGSSCHAEDEN = '40000000-0000-0000-0000-000000000002'
const SPEZIALGEBIET_VERSICHERUNG = '30000000-0000-0000-0000-000000000001'
const KONTO = '37000000-0000-0000-0000-000000000001'

const angelegt: string[] = []

async function belegAnlegen(
  text: string,
  mandantId = MANDANT,
  kreditorId: string | null = KREDITOR,
  objektId: string | null = OBJEKT_42,
): Promise<string> {
  const benutzer = mandantId === MANDANT ? ANNA : DORIS
  const id = await alsBenutzer(benutzer, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, belegart, eingangskanal, inhalt_hash,
                             storage_praefix, erfasst_von, objekt_id)
       values ($1, 'rechnung', 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), $2, $3)
       returning id`,
      [mandantId, benutzer, mandantId === MANDANT ? objektId : null],
    )
    const dokumentId = rows[0].id
    await c.query('insert into dokument_seite (dokument_id, seite, text) values ($1, 1, $2)', [
      dokumentId,
      text,
    ])
    if (kreditorId !== null) {
      await c.query('insert into rechnung_fakten (dokument_id, kreditor_id) values ($1, $2)', [
        dokumentId,
        kreditorId,
      ])
    }
    return dokumentId
  })
  angelegt.push(id)
  return id
}

/**
 * Legt ein gelerntes Kontierungsmuster an.
 *
 * Als Tabelleneigentuemer, nicht ueber `alsBenutzer`: Der Lernspeicher
 * entsteht im Betrieb aus bestaetigten Kontierungen, nicht durch Handeingabe
 * — hier wird nur der Zustand hergestellt, den ein solcher Verlauf hinterlaesst.
 */
async function musterLernen(
  positionstext: string,
  ordnungsgruppeId: string,
  trefferzahl = 1,
  objektId: string | null = OBJEKT_42,
): Promise<void> {
  const c = await verbindungspool().connect()
  try {
    await c.query(
      `insert into kontierungs_muster (mandant_id, kreditor_id, objekt_id,
                                       positionstext_normalisiert, konto_id,
                                       ordnungsgruppe_id, trefferzahl)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [MANDANT, KREDITOR, objektId, positionstext, KONTO, ordnungsgruppeId, trefferzahl],
    )
  } finally {
    c.release()
  }
}

async function alsEigentuemer(sql: string, werte: unknown[] = []): Promise<void> {
  const c = await verbindungspool().connect()
  try {
    await c.query(sql, werte)
  } finally {
    c.release()
  }
}

/**
 * Wie `alsEigentuemer`, aber mit gesetztem Benutzer.
 *
 * Der Eigentuemer umgeht die RLS -- **Trigger fireen trotzdem**. Ohne
 * Benutzerkontext ist `app.darf_prozess()` falsch, und schon das Aufraeumen
 * von `prozessdefinition_id` scheitert am Rechtetrigger. Der Kontext gilt nur
 * bis zum Ende der Transaktion, damit die Kennung nicht ueber die
 * wiederverwendete Verbindung in andere Tests sickert.
 */
async function alsEigentuemerMit(
  benutzerId: string,
  sql: string,
  werte: unknown[] = [],
): Promise<void> {
  const c = await verbindungspool().connect()
  try {
    await c.query('begin')
    await c.query('select set_config($1, $2, true)', ['app.benutzer_id', benutzerId])
    await c.query(sql, werte)
    await c.query('commit')
  } catch (fehler) {
    await c.query('rollback')
    throw fehler
  } finally {
    c.release()
  }
}

beforeEach(async () => {
  angelegt.length = 0
  await alsEigentuemer('delete from kontierungs_muster')
  await alsEigentuemer('update kreditor set standard_ordnungsgruppe_id = null')
  await alsEigentuemer("update ordnungsgruppe set schluesselwoerter = '{}'")
})

afterEach(async () => {
  await alsEigentuemer('delete from dokument where id = any($1)', [angelegt])
  await alsEigentuemer('delete from kontierungs_muster')
  await alsEigentuemer('update kreditor set standard_ordnungsgruppe_id = null')
  await alsEigentuemer("update ordnungsgruppe set schluesselwoerter = '{}'")
})

afterAll(poolSchliessen)

describe('Standard am Kreditor', () => {
  it('gilt und ist gruen', async () => {
    await alsEigentuemer('update kreditor set standard_ordnungsgruppe_id = $2 where id = $1', [
      KREDITOR,
      BETRIEBSKOSTEN,
    ])
    const beleg = await belegAnlegen('Rechnung ueber Hausreinigung')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    expect(vorschlag.ordnungsgruppeId).toBe(BETRIEBSKOSTEN)
    expect(vorschlag.sicherheit).toBe('gruen')
    expect(vorschlag.quelle).toBe('kreditor')
  })

  it('schlaegt das gelernte Muster — senkt dabei aber die Ampel', async () => {
    await alsEigentuemer('update kreditor set standard_ordnungsgruppe_id = $2 where id = $1', [
      KREDITOR,
      BETRIEBSKOSTEN,
    ])
    await musterLernen('sanierung nach leitungswasser', VERSICHERUNGSSCHAEDEN, 5)
    const beleg = await belegAnlegen('Rechnung')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    // Der Mensch gewinnt — aber die Abweichung ist sichtbar, statt still
    // aufgeloest zu werden.
    expect(vorschlag.ordnungsgruppeId).toBe(BETRIEBSKOSTEN)
    expect(vorschlag.sicherheit).toBe('orange')
    expect(vorschlag.begruendung).toContain('Versicherungsschaeden')
  })
})

describe('Gelerntes Kontierungsmuster', () => {
  it('ist gruen, wenn bei diesem Kreditor immer gleich kontiert wurde', async () => {
    await musterLernen('hausreinigung monatlich', BETRIEBSKOSTEN, 12)
    const beleg = await belegAnlegen('Rechnung')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    expect(vorschlag.ordnungsgruppeId).toBe(BETRIEBSKOSTEN)
    expect(vorschlag.sicherheit).toBe('gruen')
    expect(vorschlag.quelle).toBe('muster')
    expect(vorschlag.begruendung).toContain('12')
  })

  it('ist orange, wenn derselbe Kreditor auf mehrere Kategorien lief', async () => {
    await musterLernen('hausreinigung', BETRIEBSKOSTEN, 9)
    await musterLernen('sanierung', VERSICHERUNGSSCHAEDEN, 2)
    const beleg = await belegAnlegen('Rechnung')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    // Die haeufigere gewinnt, aber nicht gruen: Dieser Lieferant schickt
    // nachweislich zweierlei.
    expect(vorschlag.ordnungsgruppeId).toBe(BETRIEBSKOSTEN)
    expect(vorschlag.sicherheit).toBe('orange')
  })

  it('zaehlt Muster ohne Objektbezug mit', async () => {
    await musterLernen('hausreinigung', BETRIEBSKOSTEN, 3, null)
    const beleg = await belegAnlegen('Rechnung')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    expect(vorschlag.ordnungsgruppeId).toBe(BETRIEBSKOSTEN)
    expect(vorschlag.quelle).toBe('muster')
  })
})

describe('Schluesselworte', () => {
  it('ergeben nie besser als orange', async () => {
    await alsEigentuemer('update ordnungsgruppe set schluesselwoerter = $2 where id = $1', [
      VERSICHERUNGSSCHAEDEN,
      ['Leitungswasser', 'Schadensnummer'],
    ])
    const beleg = await belegAnlegen('Gutachten zum Schaden durch Leitungswasser im Keller')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    expect(vorschlag.ordnungsgruppeId).toBe(VERSICHERUNGSSCHAEDEN)
    expect(vorschlag.sicherheit).toBe('orange')
    expect(vorschlag.quelle).toBe('schluesselwort')
  })

  it('ergeben nichts, wenn zwei Kategorien passen', async () => {
    await alsEigentuemer('update ordnungsgruppe set schluesselwoerter = $2 where id = $1', [
      VERSICHERUNGSSCHAEDEN,
      ['Leitungswasser'],
    ])
    await alsEigentuemer('update ordnungsgruppe set schluesselwoerter = $2 where id = $1', [
      BETRIEBSKOSTEN,
      ['Hausreinigung'],
    ])
    const beleg = await belegAnlegen('Hausreinigung nach Leitungswasser im Treppenhaus')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    // Mehrere Kandidaten sind schlechter als keiner.
    expect(vorschlag.ordnungsgruppeId).toBeNull()
    expect(vorschlag.sicherheit).toBe('rot')
  })

  it('greifen erst, wenn Kreditor und Muster nichts hergeben', async () => {
    await alsEigentuemer('update kreditor set standard_ordnungsgruppe_id = $2 where id = $1', [
      KREDITOR,
      BETRIEBSKOSTEN,
    ])
    await alsEigentuemer('update ordnungsgruppe set schluesselwoerter = $2 where id = $1', [
      VERSICHERUNGSSCHAEDEN,
      ['Leitungswasser'],
    ])
    const beleg = await belegAnlegen('Schaden durch Leitungswasser')

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    expect(vorschlag.quelle).toBe('kreditor')
    expect(vorschlag.ordnungsgruppeId).toBe(BETRIEBSKOSTEN)
  })
})

describe('Ohne jeden Anhaltspunkt', () => {
  it('wird rot und sagt warum', async () => {
    const beleg = await belegAnlegen('Rechnung ohne alles', MANDANT, null)

    const vorschlag = await alsBenutzer(ANNA, (c) => kategorieVorschlagen(c, beleg))

    expect(vorschlag.ordnungsgruppeId).toBeNull()
    expect(vorschlag.sicherheit).toBe('rot')
    expect(vorschlag.quelle).toBe('keine')
  })
})

describe('Mandantentrennung', () => {
  it('schlaegt keine Kategorie eines fremden Mandanten vor', async () => {
    await alsEigentuemer('update ordnungsgruppe set schluesselwoerter = $2 where id = $1', [
      VERSICHERUNGSSCHAEDEN,
      ['Leitungswasser'],
    ])
    const fremd = await belegAnlegen('Schaden durch Leitungswasser', MANDANT_SUED, null)

    const vorschlag = await alsBenutzer(DORIS, (c) => kategorieVorschlagen(c, fremd))

    expect(vorschlag.ordnungsgruppeId).toBeNull()
    expect(vorschlag.sicherheit).toBe('rot')
  })
})

describe('Aus der Kategorie faellt das Spezialgebiet', () => {
  it('wird beim Setzen der Kategorie abgeleitet', async () => {
    const beleg = await belegAnlegen('Rechnung')

    await alsBenutzer(ANNA, (c) =>
      c.query('update dokument set ordnungsgruppe_id = $2 where id = $1', [
        beleg,
        VERSICHERUNGSSCHAEDEN,
      ]),
    )

    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query<{ spezialgebiet_id: string | null }>(
        'select spezialgebiet_id from dokument where id = $1',
        [beleg],
      ),
    )
    expect(rows[0]?.spezialgebiet_id).toBe(SPEZIALGEBIET_VERSICHERUNG)
  })

  it('ueberschreibt kein von Hand gewaehltes Spezialgebiet', async () => {
    const beleg = await belegAnlegen('Rechnung')

    await alsBenutzer(ANNA, async (c) => {
      await c.query('update dokument set spezialgebiet_id = $2 where id = $1', [
        beleg,
        SPEZIALGEBIET_VERSICHERUNG,
      ])
      // Eine Kategorie ohne Spezialgebiet darf das gesetzte nicht loeschen.
      await c.query('update dokument set ordnungsgruppe_id = $2 where id = $1', [
        beleg,
        BETRIEBSKOSTEN,
      ])
    })

    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query<{ spezialgebiet_id: string | null }>(
        'select spezialgebiet_id from dokument where id = $1',
        [beleg],
      ),
    )
    expect(rows[0]?.spezialgebiet_id).toBe(SPEZIALGEBIET_VERSICHERUNG)
  })

  it('fuehrt ueber die Zustaendigkeit zu einem Menschen', async () => {
    // Der eigentliche Ertrag: Die Kategorie benennt keinen Mitarbeiter, aber
    // sie fuehrt zu einem. Clara traegt das Spezialgebiet Versicherung.
    const beleg = await belegAnlegen('Rechnung')
    await alsBenutzer(ANNA, (c) =>
      c.query('update dokument set ordnungsgruppe_id = $2 where id = $1', [
        beleg,
        VERSICHERUNGSSCHAEDEN,
      ]),
    )

    const { rows } = await alsBenutzer(ANNA, (c) =>
      c.query<{ benutzer_id: string }>(
        `select sz.benutzer_id
           from dokument d
           join spezialgebiet_zustaendigkeit sz on sz.spezialgebiet_id = d.spezialgebiet_id
          where d.id = $1`,
        [beleg],
      ),
    )
    expect(rows[0]?.benutzer_id).toBe(CLARA)
  })
})

/**
 * Wer die Kategorie auf einen Ablauf zeigen laesst, aendert den Ablauf.
 *
 * Seit die Engine `ordnungsgruppe.prozessdefinition_id` liest, ist diese eine
 * Spalte Ablaufsteuerung -- sie steht nur zufaellig auf einer
 * Stammdatentabelle, deren Schreibpolicy `stammdaten_pflegen` verlangt.
 * Ohne eigene Pruefung koennte, wer Kreditoren pflegt, eine Kategorie auf
 * einen Ablauf ohne Freigabestufe zeigen lassen -- und alle Belege dieser
 * Kategorie liefen an der Geschaeftsleitung vorbei.
 */
describe('Recht an der Ablaufsteuerung', () => {
  // Bernd ist der Pruefstein: Er pflegt Stammdaten, konfiguriert aber keine
  // Ablaeufe. Eva darf beides, Anna keines von beidem.
  const BERND = '20000000-0000-0000-0000-000000000002'
  const EVA = '20000000-0000-0000-0000-000000000005'
  const SEED_ABLAUF = '65000000-0000-0000-0000-000000000001'

  /*
   * **Vorher** zuruecksetzen, nicht nur nachher.
   *
   * Diese Tests laufen ohne Rollback. Beim ersten Entwurf stand die Spalte
   * nach einem frueheren Lauf noch auf demselben Wert -- und `is distinct
   * from` schlaegt dann zu Recht nicht an. Der Rechtetest war gruen, weil
   * gar keine Aenderung stattfand.
   */
  beforeEach(async () => {
    await alsEigentuemerMit(EVA, 'update ordnungsgruppe set prozessdefinition_id = null')
  })

  afterEach(async () => {
    await alsEigentuemerMit(EVA, 'update ordnungsgruppe set prozessdefinition_id = null')
  })

  it('weist Bernd ab, obwohl er Stammdaten pflegen darf', async () => {
    await expect(
      alsBenutzer(BERND, (c) =>
        c.query('update ordnungsgruppe set prozessdefinition_id = $2 where id = $1', [
          BETRIEBSKOSTEN,
          SEED_ABLAUF,
        ]),
      ),
    ).rejects.toThrow(/Ablauf/)
  })

  it('laesst Bernd die uebrigen Spalten weiterhin aendern', async () => {
    // Sonst waere die Trennung eine Sperre statt einer Unterscheidung: Wer
    // eine Farbe aendert, bestimmt keinen Ablauf.
    const { rowCount } = await alsBenutzer(BERND, (c) =>
      c.query('update ordnungsgruppe set farbe = $2 where id = $1', [BETRIEBSKOSTEN, '#123456']),
    )
    expect(rowCount).toBe(1)
  })

  it('laesst Eva die Steuerung setzen', async () => {
    const { rowCount } = await alsBenutzer(EVA, (c) =>
      c.query('update ordnungsgruppe set prozessdefinition_id = $2 where id = $1', [
        BETRIEBSKOSTEN,
        SEED_ABLAUF,
      ]),
    )
    expect(rowCount).toBe(1)
  })

  /*
   * Und der Grund, warum der Trigger nicht genuegt haette, um das zu pruefen.
   *
   * Anna traegt keines der beiden Rechte. Ihr `update` wirft **nichts** -- die
   * Lesepolicy laesst die Zeile verschwinden, und ein `update` ohne Treffer
   * ist erfolgreich. Der Trigger kommt gar nicht zum Zug.
   *
   * Beim ersten Entwurf dieses Tests stand hier Anna, der Test war gruen, und
   * er hat nichts bewiesen. Deshalb steht der Fall jetzt ausdruecklich da.
   */
  it('wirkt bei Anna gar nicht -- die Policy, nicht der Trigger', async () => {
    const { rowCount } = await alsBenutzer(ANNA, (c) =>
      c.query('update ordnungsgruppe set prozessdefinition_id = $2 where id = $1', [
        BETRIEBSKOSTEN,
        SEED_ABLAUF,
      ]),
    )
    expect(rowCount).toBe(0)
  })
})
