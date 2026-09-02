/**
 * Tests der S3-Ablage mit Object Lock — gegen einen echten Objektspeicher.
 *
 * **Warum gegen einen echten.** Object Lock ist eine Zusage des Speichers,
 * nicht unseres Codes. Ein Test mit einer nachgebauten Ablage prüfte, dass
 * wir den richtigen Befehl abschicken — nicht, was danach gilt.
 *
 * Der Unterschied war hier kein theoretischer. Der erste Entwurf dieser Datei
 * prüfte, dass ein Überschreiben **abgewiesen** wird. Es wird nicht
 * abgewiesen: Object Lock schützt Fassungen, nicht Schlüssel. Das
 * Überschreiben gelingt, legt eine zweite Fassung darüber, und ein
 * gewöhnliches Lesen liefert ab dann diese. Die gesperrte Fassung bleibt
 * unzerstörbar daneben liegen — erreichbar nur über ihre Kennung.
 *
 * Die Zusage lautet also: **Erhalt**, nicht Abweisung. Und sie ist erst dann
 * etwas wert, wenn die Kennung festgehalten wird — sonst ist das Original
 * unzerstörbar und unauffindbar zugleich.
 *
 * Gebraucht wird dafür MinIO:
 *
 *   docker run -d --name dms-minio -p 9000:9000 \
 *     -e MINIO_ROOT_USER=dmsminio -e MINIO_ROOT_PASSWORD=dmsminio123 \
 *     quay.io/minio/minio:latest server /data
 *
 * Läuft es nicht, werden diese Tests **übersprungen** und sagen das. Ein
 * Test, der ohne Speicher stillschweigend grün wird, wäre schlimmer als
 * keiner.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { kannSperren, S3Ablage } from '../src/ablage-s3'
import { DateisystemAblage } from '../src/ablage'

const ENDPUNKT = process.env['DMS_S3_ENDPUNKT'] ?? 'http://127.0.0.1:9000'
const SCHLUESSEL = process.env['DMS_S3_SCHLUESSEL'] ?? 'dmsminio'
const GEHEIMNIS = process.env['DMS_S3_GEHEIMNIS'] ?? 'dmsminio123'

const eimer = `dms-test-${randomUUID().slice(0, 8)}`
let ablage: S3Ablage
let erreichbar = false

beforeAll(async () => {
  const klient = new S3Client({
    region: 'us-east-1',
    endpoint: ENDPUNKT,
    forcePathStyle: true,
    credentials: { accessKeyId: SCHLUESSEL, secretAccessKey: GEHEIMNIS },
  })

  try {
    /*
     * Object Lock lässt sich **nur beim Anlegen** einschalten, nicht
     * nachträglich. Ein bestehender Eimer ohne Sperre bleibt für immer einer
     * ohne — das gehört in die Einrichtungsanleitung, nicht in eine
     * Fehlermeldung im Betrieb.
     */
    await klient.send(
      new CreateBucketCommand({ Bucket: eimer, ObjectLockEnabledForBucket: true }),
    )
    erreichbar = true
  } catch {
    erreichbar = false
  }

  ablage = new S3Ablage({
    eimer,
    endpunkt: ENDPUNKT,
    zugriffsschluessel: SCHLUESSEL,
    geheimnis: GEHEIMNIS,
  })
}, 30_000)

afterAll(() => {
  if (!erreichbar) {
    // Kein stilles Durchwinken: Wer die Suite laufen laesst, soll sehen,
    // dass diese Zusage ungeprueft blieb.
    process.stdout.write(
      `\n  Hinweis: MinIO unter ${ENDPUNKT} nicht erreichbar — ` +
        `die Object-Lock-Tests wurden uebersprungen.\n`,
    )
  }
})

/** Läuft nur mit erreichbarem Speicher. */
const wennSpeicher = (name: string, pruefung: () => Promise<void>) =>
  it(name, async () => {
    if (!erreichbar) return
    await pruefung()
  }, 30_000)

describe('Schreiben und Lesen', () => {
  wennSpeicher('legt eine Datei ab und liest sie unveraendert zurueck', async () => {
    const inhalt = Buffer.from('Rechnung RE-2026-0001, 1.240,00 EUR', 'utf8')
    await ablage.schreiben('nord/42/original.pdf', inhalt)
    expect(await ablage.lesen('nord/42/original.pdf')).toEqual(inhalt)
  })

  wennSpeicher('meldet eine fehlende Datei als Fehler', async () => {
    await expect(ablage.lesen('gibt/es/nicht.pdf')).rejects.toThrow()
  })
})

describe('Object Lock', () => {
  wennSpeicher('meldet ohne Sperre schlicht keine', async () => {
    await ablage.schreiben('ohne-sperre.pdf', Buffer.from('frei'))

    // "Keine Sperre" ist eine Antwort, kein Abbruch -- S3 meldet sie als
    // Ausnahme, und die faengt die Ablage ab.
    expect(await ablage.sperrstand('ohne-sperre.pdf')).toBeNull()
  })

  wennSpeicher('sperrt bis zum Datum und sagt das auch', async () => {
    const schluessel = 'gesperrt.pdf'
    await ablage.schreiben(schluessel, Buffer.from('Beleg von 2026'))

    const bis = new Date(Date.now() + 60_000)
    const fassung = await ablage.sperren(schluessel, bis)

    const stand = await ablage.sperrstand(schluessel, fassung)
    expect(stand).not.toBeNull()
    // Auf die Sekunde genau: S3 rundet die Zeit auf Millisekunden.
    expect(Math.abs((stand?.getTime() ?? 0) - bis.getTime())).toBeLessThan(1000)
  })

  wennSpeicher('bewahrt das Original, wenn jemand darueber schreibt', async () => {
    const schluessel = 'unantastbar.pdf'
    await ablage.schreiben(schluessel, Buffer.from('das Original'))
    const fassung = await ablage.sperren(schluessel, new Date(Date.now() + 60_000))
    expect(fassung).not.toBeNull()

    /*
     * **Die eigentliche Zusage -- und der Grund fuer die ganze Fassungslogik.**
     *
     * Das Ueberschreiben gelingt. Genau daran ist die erste Fassung dieses
     * Tests gescheitert, und die Annahme dahinter stand als Zusage im
     * Modulkopf.
     */
    await ablage.schreiben(schluessel, Buffer.from('etwas anderes'))

    // Wer schlicht liest, bekommt ab jetzt das Untergeschobene. Deshalb
    // genuegt es nicht, zu sperren.
    expect((await ablage.lesen(schluessel)).toString('utf8')).toBe('etwas anderes')

    // Mit der Kennung kommen die archivierten Bytes zurueck -- unversehrt.
    expect((await ablage.lesen(schluessel, fassung)).toString('utf8')).toBe('das Original')
  })

  wennSpeicher('gibt die Kennung der Fassung heraus, die sie gesperrt hat', async () => {
    const schluessel = 'kennung.pdf'
    await ablage.schreiben(schluessel, Buffer.from('eins'))
    const erste = await ablage.sperren(schluessel, new Date(Date.now() + 60_000))

    await ablage.schreiben(schluessel, Buffer.from('zwei'))
    const zweite = await ablage.fassungVon(schluessel)

    // Zwei Fassungen, zwei Kennungen. Waere `sperren` ohne `VersionId`
    // gelaufen, koennte hier die falsche vermerkt sein -- und das faellt nie
    // auf, bis es darauf ankommt.
    expect(erste).not.toBe(zweite)
    expect(await ablage.sperrstand(schluessel, erste)).not.toBeNull()
    expect(await ablage.sperrstand(schluessel, zweite)).toBeNull()
  })

  wennSpeicher('laesst die Frist verlaengern', async () => {
    const schluessel = 'verlaengern.pdf'
    await ablage.schreiben(schluessel, Buffer.from('x'))

    const kurz = new Date(Date.now() + 60_000)
    const lang = new Date(Date.now() + 120_000)
    await ablage.sperren(schluessel, kurz)
    await ablage.sperren(schluessel, lang)

    const stand = await ablage.sperrstand(schluessel)
    expect((stand?.getTime() ?? 0) - kurz.getTime()).toBeGreaterThan(50_000)
  })

  wennSpeicher('laesst die Frist nicht verkuerzen', async () => {
    const schluessel = 'verkuerzen.pdf'
    await ablage.schreiben(schluessel, Buffer.from('x'))
    await ablage.sperren(schluessel, new Date(Date.now() + 120_000))

    /*
     * Das ist der Grund, warum die Sperre erst beim Archivieren gesetzt wird
     * und die Frist aus einem Stammdatum kommt: Ein zu spaetes Datum ist ein
     * Fehler, den niemand mehr behebt.
     */
    await expect(
      ablage.sperren(schluessel, new Date(Date.now() + 60_000)),
    ).rejects.toThrow()
  })
})

describe('Wer sperren kann', () => {
  it('erkennt die S3-Ablage als sperrbar', () => {
    expect(kannSperren(ablage)).toBe(true)
  })

  it('erkennt die Dateisystem-Ablage als nicht sperrbar', () => {
    /*
     * Der Unterschied steht im Typ, nicht in einer optionalen Methode. Sonst
     * saehe "nicht gesetzt" aus wie "gesetzt", und das Archiv behauptete
     * einen Schutz, den es nicht gibt.
     */
    expect(kannSperren(new DateisystemAblage('.ablage'))).toBe(false)
  })
})

describe('Einrichtung', () => {
  wennSpeicher('ohne Object Lock am Eimer schlaegt die Sperre fehl', async () => {
    const klient = new S3Client({
      region: 'us-east-1',
      endpoint: ENDPUNKT,
      forcePathStyle: true,
      credentials: { accessKeyId: SCHLUESSEL, secretAccessKey: GEHEIMNIS },
    })
    const ohne = `dms-test-ohne-${randomUUID().slice(0, 8)}`
    await klient.send(new CreateBucketCommand({ Bucket: ohne }))
    await klient.send(
      new PutObjectCommand({ Bucket: ohne, Key: 'x.pdf', Body: Buffer.from('x') }),
    )

    /*
     * Object Lock laesst sich nur beim Anlegen des Eimers einschalten. Wer
     * das versaeumt, merkt es erst beim ersten Archivieren -- deshalb steht
     * es in der Einrichtungsanleitung und nicht nur hier.
     */
    const falsche = new S3Ablage({
      eimer: ohne,
      endpunkt: ENDPUNKT,
      zugriffsschluessel: SCHLUESSEL,
      geheimnis: GEHEIMNIS,
    })
    await expect(falsche.sperren('x.pdf', new Date(Date.now() + 60_000))).rejects.toThrow()
  })
})
