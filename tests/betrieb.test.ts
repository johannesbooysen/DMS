/**
 * Tests der Lebenszeichen (ADR 0007).
 *
 * Die tragende Zusicherung dieser Datei steht im zweiten Test: **Ein Dienst,
 * der nie eingetragen hat, ist ein Befund und kein Nichts.** Der naheliegende
 * Entwurf liest die Tabelle, findet keine Zeile und meldet nichts
 * Auffälliges — und gibt damit ausgerechnet für den toten Dienst Entwarnung.
 * Dieselbe Regel wie bei `sicherung:pruefen`.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { FRIST_S, WORKER, gesundheit, lebenszeichenSetzen } from '../src/betrieb'

const ANNA = '20000000-0000-0000-0000-000000000001'
const BERND = '20000000-0000-0000-0000-000000000002'

/** Eigene Dienstnamen, damit die Tests einander nicht in die Quere kommen. */
const PRUEF = 'test-dienst'

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
  await direkt('delete from betrieb_lebenszeichen where dienst like $1', ['test-%'])
})

afterAll(poolSchliessen)

describe('Das Lebenszeichen', () => {
  it('wird eingetragen und gilt danach als frisch', async () => {
    await lebenszeichenSetzen(PRUEF)

    const befund = await gesundheit([PRUEF])
    expect(befund.gesund).toBe(true)
    expect(befund.datenbank).toBe(true)
    expect(befund.verstummt).toEqual([])

    const dienst = befund.dienste.find((d) => d.dienst === PRUEF)
    expect(dienst?.frisch).toBe(true)
    expect(dienst?.alterS).toBeLessThan(FRIST_S)
  })

  it('meldet einen Dienst, der nie eingetragen hat, als verstummt', async () => {
    /*
     * **Der wichtigste Test dieser Datei.** Wer nie eingetragen hat, fehlt in
     * der Tabelle -- ein Befund, der die Liste nur durchsieht, faende dann
     * nichts zu beanstanden. Genau so uebersieht man einen Dienst, der seit
     * dem letzten Neustart gar nicht mehr laeuft.
     */
    const befund = await gesundheit(['test-nie-gelaufen'])

    expect(befund.gesund).toBe(false)
    expect(befund.verstummt).toContain('test-nie-gelaufen')
  })

  it('meldet ein zu altes Lebenszeichen als verstummt', async () => {
    await lebenszeichenSetzen(PRUEF)
    // Ueber die Frist zurueckdatieren -- als Eigentuemer, weil die Anwendung
    // das gar nicht koennen soll (siehe letzter Test).
    await direkt(
      `update betrieb_lebenszeichen
          set zeitpunkt = now() - make_interval(secs => $2)
        where dienst = $1`,
      [PRUEF, FRIST_S + 60],
    )

    const befund = await gesundheit([PRUEF])
    expect(befund.gesund).toBe(false)
    expect(befund.verstummt).toContain(PRUEF)
    expect(befund.dienste.find((d) => d.dienst === PRUEF)?.frisch).toBe(false)
  })

  it('prueft nur die erwarteten Dienste', async () => {
    /*
     * Das ist die Trennung, an der die Container-Pruefung haengt: Der
     * Webcontainer fragt mit leerer Liste (`?dienste=`) und ist gesund, auch
     * wenn der Worker verstummt ist. Sonst startete Docker bei einem toten
     * Worker die Anwendung neu -- den einen Prozess, der nichts dafuer kann.
     */
    const befund = await gesundheit([])

    expect(befund.gesund).toBe(true)
    expect(befund.datenbank).toBe(true)
  })

  it('nennt die Fassung, die eingetragen hat', async () => {
    process.env['DMS_FASSUNG'] = 'test-abc1234'
    try {
      await lebenszeichenSetzen(PRUEF)
      const befund = await gesundheit([PRUEF])
      expect(befund.dienste.find((d) => d.dienst === PRUEF)?.fassung).toBe('test-abc1234')
    } finally {
      delete process.env['DMS_FASSUNG']
    }
  })

  it('laesst sich nicht von Hand setzen', async () => {
    /*
     * Es gibt keine Schreibpolicy und kein `insert`-Recht -- nur die
     * `security definer`-Funktion. Ein zweiter Weg, ein Lebenszeichen zu
     * setzen, waere ein Weg, eines vorzutaeuschen: Der Endpunkt meldete dann
     * gruen fuer einen Dienst, der laengst steht.
     */
    await expect(
      alsBenutzer(ANNA, (c) =>
        c.query("insert into betrieb_lebenszeichen (dienst) values ('test-gefaelscht')"),
      ),
    ).rejects.toThrow()

    const zeilen = await direkt('select 1 from betrieb_lebenszeichen where dienst = $1', [
      'test-gefaelscht',
    ])
    expect(zeilen).toHaveLength(0)
  })

  it('zeigt allen dasselbe -- die Tabelle hat bewusst keinen Mandanten', async () => {
    /*
     * **Ausdrueckliche Ausnahme von der Projektregel** "keine Abfrage ohne
     * Mandantenfilter". Sie gilt Daten mit Mandantenbezug; hier steht die
     * Aussage "ein Betriebssystemprozess laeuft". Die gibt es nicht je
     * Mandant -- der Worker bedient alle.
     *
     * Der Test steht trotzdem hier, damit die Ausnahme sichtbar ist statt
     * stillschweigend zu fehlen. Persoenliche oder fachliche Daten stehen
     * nicht darin: ein Dienstname, ein Alter, eine Programmfassung.
     */
    await lebenszeichenSetzen(PRUEF)

    const alsAnna = await alsBenutzer(ANNA, (c) =>
      c.query('select dienst from betrieb_lebenszeichen where dienst = $1', [PRUEF]),
    )
    const alsBernd = await alsBenutzer(BERND, (c) =>
      c.query('select dienst from betrieb_lebenszeichen where dienst = $1', [PRUEF]),
    )

    expect(alsAnna.rowCount).toBe(1)
    expect(alsBernd.rowCount).toBe(1)
  })
})

describe('Der Worker-Dienstname', () => {
  it('ist der, den der Worker eintraegt', () => {
    // Zwei Zeichenketten, die zusammenpassen muessen: Der Worker traegt
    // `WORKER` ein, die Vorgabe des Endpunkts erwartet `WORKER`. Ein
    // Tippfehler an einer Stelle waere ein dauerhaft roter Endpunkt.
    expect(WORKER).toBe('worker')
  })
})
