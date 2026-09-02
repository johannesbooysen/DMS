/**
 * Tests der Objektsperre — der zweiten Säule der Revisionssicherheit.
 *
 * Die erste, die Hash-Kette, *erkennt* eine Änderung. Diese hier soll
 * verhindern, dass das Original dabei verlorengeht. Geprüft wird beides
 * getrennt:
 *
 *   * **Die Datenbank** — dass ein Sperrvermerk nur einmal gesetzt werden
 *     kann und danach feststeht. Läuft immer.
 *   * **Der Durchgang** — dass am Ende wirklich eine gesperrte Fassung im
 *     Speicher liegt und der Beleg sie wiederfindet. Braucht MinIO und wird
 *     sonst übersprungen (siehe `ablage-s3.test.ts`).
 *
 * Die interessantere Hälfte ist die zweite. Der Vermerk in der Datenbank ist
 * eine Behauptung; erst der Speicher löst sie ein.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { belegEntfernen } from './hilfe/aufraeumen'
import { alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { archivieren, archivstandLaden } from '../src/archiv'
import { objektsperrenSetzen } from '../src/archiv/objektsperre'
import { S3Ablage } from '../src/ablage-s3'
import { DateisystemAblage } from '../src/ablage'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'
const KREDITOR = '55000000-0000-0000-0000-000000000001'
const KONTO = '37000000-0000-0000-0000-000000000001'

const ENDPUNKT = process.env['DMS_S3_ENDPUNKT'] ?? 'http://127.0.0.1:9000'
const SCHLUESSEL = process.env['DMS_S3_SCHLUESSEL'] ?? 'dmsminio'
const GEHEIMNIS = process.env['DMS_S3_GEHEIMNIS'] ?? 'dmsminio123'

let beleg = ''
let schluesselAktuell = ''
let ablage: S3Ablage | null = null

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/**
 * Legt einen Beleg mit Datei an.
 *
 * Die Datei ist Pflicht: `app.objektsperre_offen` verbindet über
 * `dokument_datei`, und ein Beleg ohne Original hat nichts zu sperren.
 */
async function belegAnlegen(): Promise<{ id: string; schluessel: string }> {
  const schluessel = `test/${randomUUID()}/original.pdf`
  const id = await alsBenutzer(ANNA, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                             inhalt_hash, storage_praefix, ampel_gesamt)
       values ($1, $2, 'rechnung', 'mail', md5(random()::text),
               'test/' || gen_random_uuid(), 'gruen')
       returning id`,
      [MANDANT, OBJEKT_42],
    )
    const neu = rows[0].id
    await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer,
                                    rechnungsdatum, netto, steuer, brutto,
                                    wirtschaftsjahr)
       values ($1, $2, 'RE-SPERRE', current_date, 1000, 190, 1190, 2026)`,
      [neu, KREDITOR],
    )
    await c.query(
      `insert into kontierung (dokument_id, zeile_nr, konto_id, betrag_netto,
                               steuersatz, betrag_brutto, umlagefaehig, quelle)
       values ($1, 1, $2, 1000, 19, 1190, true, 'mensch')`,
      [neu, KONTO],
    )
    await c.query(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
       values ($1, 'original', $2, 'application/pdf', 12)`,
      [neu, schluessel],
    )
    return neu
  })
  return { id, schluessel }
}

beforeEach(async () => {
  const angelegt = await belegAnlegen()
  beleg = angelegt.id
  schluesselAktuell = angelegt.schluessel
})

afterEach(async () => {
  await belegEntfernen(beleg)
})

afterAll(poolSchliessen)

describe('Der Vermerk in der Datenbank', () => {
  it('bleibt leer, solange nicht gesperrt wurde', async () => {
    const stand = await alsBenutzer(ANNA, async (c) => {
      await archivieren(c, beleg)
      return archivstandLaden(c, beleg)
    })

    /*
     * Eine leere Spalte ist ehrlicher als ein Datum, das nichts bewirkt.
     * Genau deshalb traegt `app.dokument_archivieren` die Sperre nicht selbst
     * ein -- sie ist zu diesem Zeitpunkt noch nicht gesetzt.
     */
    expect(stand?.archiviertAm).not.toBeNull()
    expect(stand?.objectLockBis).toBeNull()
  })

  it('meldet den Beleg als offen, bis er gesperrt ist', async () => {
    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

    const offen = await direkt<{ dokument_id: string }>(
      'select dokument_id from app.objektsperre_offen(500)',
    )
    expect(offen.some((z) => z.dokument_id === beleg)).toBe(true)

    await direkt('select app.objektsperre_vermerken($1, $2::date, $3)', [
      beleg,
      '2036-12-31',
      'v1',
    ])

    const danach = await direkt<{ dokument_id: string }>(
      'select dokument_id from app.objektsperre_offen(500)',
    )
    // Der Archiveintrag ist die Warteschlange -- gesetzt heisst erledigt.
    expect(danach.some((z) => z.dokument_id === beleg)).toBe(false)
  })

  it('nimmt den Vermerk nur einmal an', async () => {
    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

    const [erst] = await direkt<{ objektsperre_vermerken: boolean }>(
      'select app.objektsperre_vermerken($1, $2::date, $3)',
      [beleg, '2036-12-31', 'v1'],
    )
    expect(erst?.objektsperre_vermerken).toBe(true)

    /*
     * Der zweite Aufruf trifft keine Zeile und meldet das. Kein Fehler --
     * genau so laeuft der Wiederholversuch: Bricht es zwischen Sperren und
     * Vermerken ab, holt der naechste Durchgang den Beleg erneut, und dann
     * darf der zweite Vermerk nicht abbrechen.
     */
    const [nochmal] = await direkt<{ objektsperre_vermerken: boolean }>(
      'select app.objektsperre_vermerken($1, $2::date, $3)',
      [beleg, '2040-12-31', 'v2'],
    )
    expect(nochmal?.objektsperre_vermerken).toBe(false)

    const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
    // Und der erste Wert steht noch -- nicht der zweite.
    expect(stand?.objectLockBis).toBe('2036-12-31')
  })

  it('laesst eine gesetzte Sperre nicht mehr aendern', async () => {
    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))
    await direkt('select app.objektsperre_vermerken($1, $2::date, $3)', [
      beleg,
      '2036-12-31',
      'v1',
    ])

    /*
     * Am Trigger vorbei geht es auch nicht.
     *
     * Waere die Spalte frei aenderbar, koennte jemand ein Sperrdatum
     * eintragen, das im Speicher nie gesetzt wurde -- ein Schutz auf dem
     * Papier ist schlimmer als keiner, weil niemand mehr nachsieht.
     */
    await expect(
      direkt('update archiv_eintrag set storage_object_lock_bis = $2 where dokument_id = $1', [
        beleg,
        '2040-12-31',
      ]),
    ).rejects.toThrow(/Compliance/)

    await expect(
      direkt('update archiv_eintrag set storage_fassung = $2 where dokument_id = $1', [
        beleg,
        'andere',
      ]),
    ).rejects.toThrow(/Fassung steht fest/)
  })

  it('laesst die Loeschsperre weiterhin setzen', async () => {
    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))
    await direkt('select app.objektsperre_vermerken($1, $2::date, $3)', [
      beleg,
      '2036-12-31',
      'v1',
    ])

    // Der gelockerte Trigger darf die alte Zusage nicht mitreissen: Ein
    // laufendes Verfahren beginnt und endet, und beides ist keine
    // nachtraegliche Aenderung des Archivierten.
    await direkt(
      `update archiv_eintrag set loeschsperre = true, loeschsperre_grund = 'Pruefung'
        where dokument_id = $1`,
      [beleg],
    )
    const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
    expect(stand?.loeschsperre).toBe(true)
  })
})

describe('Der Durchgang ohne sperrfaehige Ablage', () => {
  it('tut nichts und behauptet nichts', async () => {
    await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

    const bilanz = await objektsperrenSetzen(new DateisystemAblage('.ablage'))
    expect(bilanz).toEqual({ gesperrt: 0, gescheitert: 0 })

    /*
     * Das Entscheidende ist die zweite Zusicherung: Er traegt **kein** Datum
     * ein. Ein Verzeichnis kann nichts sperren, und ein Vermerk darueber
     * waere eine Luege, die niemand je bemerkt.
     */
    const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
    expect(stand?.objectLockBis).toBeNull()
  })
})

describe('Der Durchgang gegen den Speicher', () => {
  let erreichbar = false

  /*
   * Das Ueberspringen wird gemeldet.
   *
   * Ein Test, der ohne Speicher stillschweigend gruen wird, ist schlimmer als
   * keiner -- und in diesem Projekt ist genau das schon einmal passiert: Ein
   * Suchtest lief gegen einen Begriff, der schon im Seed stand, und war
   * gruen, waehrend die gepruefte Verarbeitung gar nicht lief.
   */
  afterAll(() => {
    if (!erreichbar) {
      process.stdout.write(
        `
  Hinweis: MinIO unter ${ENDPUNKT} nicht erreichbar — ` +
          `die Objektsperre wurde nur in der Datenbank geprueft.
`,
      )
    }
  })

  beforeEach(async () => {
    if (ablage !== null) return
    const klient = new S3Client({
      region: 'us-east-1',
      endpoint: ENDPUNKT,
      forcePathStyle: true,
      credentials: { accessKeyId: SCHLUESSEL, secretAccessKey: GEHEIMNIS },
    })
    const eimer = `dms-sperre-${randomUUID().slice(0, 8)}`
    try {
      await klient.send(
        new CreateBucketCommand({ Bucket: eimer, ObjectLockEnabledForBucket: true }),
      )
      ablage = new S3Ablage({
        eimer,
        endpunkt: ENDPUNKT,
        zugriffsschluessel: SCHLUESSEL,
        geheimnis: GEHEIMNIS,
      })
      erreichbar = true
    } catch {
      erreichbar = false
    }
  }, 30_000)

  it(
    'sperrt die archivierte Fassung und findet sie wieder',
    async () => {
      if (!erreichbar || ablage === null) return
      const s3 = ablage

      const original = Buffer.from('%PDF-1.4 das Original von 2026')
      await s3.schreiben(schluesselAktuell, original)

      const frist = await alsBenutzer(ANNA, (c) => archivieren(c, beleg))
      expect(frist).toBe('2036-12-31')

      const bilanz = await objektsperrenSetzen(s3)
      expect(bilanz.gesperrt).toBeGreaterThanOrEqual(1)
      expect(bilanz.gescheitert).toBe(0)

      const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
      // Das Datum stammt aus der Aufbewahrungsfrist, nicht aus einer
      // Schaetzung -- und es ist dasselbe, das im Speicher steht.
      expect(stand?.objectLockBis).toBe('2036-12-31')

      const [z] = await direkt<{ storage_fassung: string | null }>(
        'select storage_fassung from archiv_eintrag where dokument_id = $1',
        [beleg],
      )
      expect(z?.storage_fassung).toBeTruthy()

      /*
       * **Der Beweis.** Jemand schiebt eine andere Datei unter -- der
       * Speicher laesst das zu, Object Lock schuetzt Fassungen und nicht
       * Schluessel.
       */
      await s3.schreiben(schluesselAktuell, Buffer.from('%PDF-1.4 untergeschoben'))

      // Wer schlicht liest, bekaeme das Untergeschobene.
      expect((await s3.lesen(schluesselAktuell)).toString()).toContain('untergeschoben')

      // Mit der vermerkten Fassung kommt das Archivierte zurueck. Genau
      // dafuer steht die Kennung in der Datenbank.
      const zurueck = await s3.lesen(schluesselAktuell, z?.storage_fassung)
      expect(zurueck.equals(original)).toBe(true)

      // Und die Sperre gilt fuer genau diese Fassung.
      expect(await s3.sperrstand(schluesselAktuell, z?.storage_fassung)).not.toBeNull()
    },
    60_000,
  )

  it(
    'holt nach, was vor der Einrichtung des Speichers archiviert wurde',
    async () => {
      if (!erreichbar || ablage === null) return
      const s3 = ablage

      /*
       * Der Fall, den es im Betrieb wirklich gibt: erst archiviert, S3 kam
       * spaeter. Weil der Archiveintrag die Warteschlange ist, braucht es
       * dafuer keinen Nachlauf und kein Skript -- der naechste Durchgang
       * greift ihn auf.
       */
      await alsBenutzer(ANNA, (c) => archivieren(c, beleg))
      await s3.schreiben(schluesselAktuell, Buffer.from('%PDF-1.4 nachtraeglich'))

      const bilanz = await objektsperrenSetzen(s3)
      expect(bilanz.gesperrt).toBeGreaterThanOrEqual(1)

      const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
      expect(stand?.objectLockBis).toBe('2036-12-31')
    },
    60_000,
  )

  it(
    'laesst einen Beleg offen, dessen Datei fehlt',
    async () => {
      if (!erreichbar || ablage === null) return

      // Archiviert, aber nie geschrieben. Der Durchgang darf hier nicht
      // abbrechen -- ein einzelner Fehlschlag haelt sonst alle folgenden auf.
      await alsBenutzer(ANNA, (c) => archivieren(c, beleg))

      const bilanz = await objektsperrenSetzen(ablage)
      expect(bilanz.gescheitert).toBeGreaterThanOrEqual(1)

      const stand = await alsBenutzer(ANNA, (c) => archivstandLaden(c, beleg))
      // Offen geblieben statt falsch vermerkt: Der naechste Durchgang
      // versucht es wieder, und bis dahin sieht man, dass etwas fehlt.
      expect(stand?.objectLockBis).toBeNull()
    },
    60_000,
  )
})
