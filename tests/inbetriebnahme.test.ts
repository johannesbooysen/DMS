/**
 * Tests der Inbetriebnahmeprüfung und des Probenprotokolls.
 *
 * Die Frage ist überall dieselbe wie bei `sicherung:pruefen`: **Merkt die
 * Prüfung es, wenn etwas fehlt?** Ein Eimer ohne Object Lock, eine
 * Datenbank ohne Probe, eine Freigabe, die einen anderen Stand beschreibt —
 * nichts davon stört den Betrieb, und alles davon fällt sonst erst im
 * Prüfungsfall auf.
 *
 * Die Objektspeicherhälfte braucht MinIO und wird sonst übersprungen — und
 * sagt das (siehe `ablage-s3.test.ts`).
 */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { alsAnmeldung, alsBenutzer, poolSchliessen, verbindungspool } from '../src/db'
import { S3Ablage } from '../src/ablage-s3'
import type { Ablage } from '../src/ablage'
import { fassungFreigeben } from '../src/verfahrensdoku'
import { letzteProbe, probeVermerken, probeergebnis } from '../src/sicherung'
import {
  PROBE_HOECHSTALTER_TAGE,
  datenbankPruefen,
  hatHarte,
  objektspeicherPruefen,
  sicherungsprobePruefen,
  umgebungPruefen,
  verfahrensdokuPruefen,
} from '../src/betrieb/inbetriebnahme'

const ANNA = '20000000-0000-0000-0000-000000000001'

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

class Merkablage implements Ablage {
  readonly dateien = new Map<string, Buffer>()
  async schreiben(schluessel: string, inhalt: Buffer): Promise<void> {
    this.dateien.set(schluessel, inhalt)
  }
  async lesen(schluessel: string): Promise<Buffer> {
    const treffer = this.dateien.get(schluessel)
    if (treffer === undefined) throw new Error('nicht gefunden')
    return treffer
  }
  async entfernen(schluessel: string): Promise<void> {
    this.dateien.delete(schluessel)
  }
}

/** Beide Tabellen sind append-only; fuer den Aufraeumer wird der Trigger kurz ausgesetzt. */
async function leeren(tabelle: string, trigger: string): Promise<void> {
  await direkt(`alter table ${tabelle} disable trigger ${trigger}`)
  await direkt(`delete from ${tabelle}`)
  await direkt(`alter table ${tabelle} enable trigger ${trigger}`)
}

// Vorher **und** nachher: Eine echte Probe (`npm run sicherung:pruefen`)
// hinterlaesst eine Zeile, und "kennt ohne Probe keine" waere dann falsch --
// nicht weil die Pruefung versagt, sondern weil geprobt wurde.
async function aufraeumen(): Promise<void> {
  await leeren('sicherungs_probe', 'sicherungs_probe_unveraenderlich')
  await leeren('verfahrensdokumentation', 'verfahrensdoku_unveraenderlich')
}
beforeEach(aufraeumen)
afterEach(aufraeumen)

afterAll(poolSchliessen)

const VOLLSTAENDIG: Record<string, string> = {
  DMS_ANMELDUNG: '',
  ENTRA_TENANT_ID: 't',
  ENTRA_CLIENT_ID: 'c',
  ENTRA_CLIENT_SECRET: 's',
  DMS_SITZUNGS_GEHEIMNIS: 'x'.repeat(64),
  DMS_BASIS_URL: 'https://dms.example.de',
  DMS_S3_EIMER: 'dms-belege',
  DMS_S3_SCHLUESSEL: 'k',
  DMS_S3_GEHEIMNIS: 'g',
  DMS_S3_ENDPUNKT: 'https://nbg1.your-objectstorage.com',
  DMS_S3_PFADFORM: 'nein',
  SMTP_URL: 'smtps://mail',
  DMS_ABSENDER: 'dms@example.de',
  DMS_OCR: 'ocrmypdf',
  DMS_FASSUNG: 'abc1234',
}

describe('Umgebung', () => {
  it('hat bei vollstaendiger Umgebung keinen Befund und sagt, was sie sah', () => {
    const b = umgebungPruefen(VOLLSTAENDIG)
    expect(b.befunde).toEqual([])
    expect(b.geprueft.join('\n')).toMatch(/Entwicklungsanmeldung aus/)
    expect(b.geprueft.join('\n')).toMatch(/dms-belege/)
  })

  it('weist die Entwicklungsanmeldung hart ab', () => {
    const b = umgebungPruefen({ ...VOLLSTAENDIG, DMS_ANMELDUNG: 'entwicklung' })
    expect(b.befunde.filter((f) => f.schwere === 'hart').map((f) => f.text).join()).toMatch(/Entwicklungsanmeldung/)
  })

  it('verlangt fuer Hetzner die Unterdomaenenform', () => {
    // Die Vorgabe ist die Pfadform -- gegen Hetzner scheitert damit jeder
    // Zugriff, und die Meldung des SDK sagt nicht, warum.
    const b = umgebungPruefen({ ...VOLLSTAENDIG, DMS_S3_PFADFORM: '' })
    expect(b.befunde.map((f) => f.text).join()).toMatch(/DMS_S3_PFADFORM=nein/)
    expect(hatHarte([b])).toBe(true)
  })

  it('macht aus fehlendem Objektspeicher einen harten und aus fehlendem Postausgang einen weichen Befund', () => {
    const b = umgebungPruefen({ ...VOLLSTAENDIG, DMS_S3_EIMER: '', SMTP_URL: '' })
    const hart = b.befunde.filter((f) => f.schwere === 'hart').map((f) => f.text).join()
    const weich = b.befunde.filter((f) => f.schwere === 'weich').map((f) => f.text).join()
    expect(hart).toMatch(/DMS_S3_EIMER/)
    expect(weich).toMatch(/SMTP_URL/)
  })
})

describe('Das Probenprotokoll', () => {
  it('kennt ohne Probe keine -- und das ist ein harter Befund', async () => {
    expect(await alsEigentuemer(letzteProbe)).toBeNull()
    const b = await alsEigentuemer(sicherungsprobePruefen)
    expect(hatHarte([b])).toBe(true)
    expect(b.befunde[0]?.text).toMatch(/Nie eine Wiederherstellung geprobt/)
  })

  it('vermerkt eine Probe und liest sie als letzte zurueck', async () => {
    await alsEigentuemer((c) =>
      probeVermerken(c, {
        sicherungVom: '2026-09-20T02:00:00Z',
        ergebnis: 'getragen',
        geprueft: { ereignisse: 12, archiveintraege: 3, dateien: 3 },
        befunde: 0,
        fassung: 'abc1234',
      }),
    )
    const p = await alsEigentuemer(letzteProbe)
    expect(p?.ergebnis).toBe('getragen')
    expect(p?.sicherungVom).toBe('2026-09-20T02:00:00Z')
    expect(p?.geprueft).toEqual({ ereignisse: 12, archiveintraege: 3, dateien: 3 })
    expect(p?.alterTage).toBe(0)

    const b = await alsEigentuemer(sicherungsprobePruefen)
    expect(b.befunde).toEqual([])
    expect(b.geprueft.join('\n')).toMatch(/12 Ereignisse/)
  })

  it('leitet den Ausgang an einer Stelle ab', () => {
    const leer = { ereignisse: 0, archiveintraege: 0, dateien: 0 }
    expect(probeergebnis([], leer)).toBe('leer')
    expect(probeergebnis([], { ...leer, ereignisse: 1 })).toBe('getragen')
    expect(probeergebnis([{ art: 'x', schwere: 'hart', gegenstand: 'y', text: '' }], { ...leer, ereignisse: 1 })).toBe(
      'befunde',
    )
  })

  it('macht aus Befunden einen harten und aus "leer" einen weichen Befund', async () => {
    const leer = { ereignisse: 0, archiveintraege: 0, dateien: 0 }
    await alsEigentuemer((c) => probeVermerken(c, { sicherungVom: '2026-09-20T02:00:00Z', ergebnis: 'leer', geprueft: leer, befunde: 0 }))
    const weich = await alsEigentuemer(sicherungsprobePruefen)
    expect(hatHarte([weich])).toBe(false)
    expect(weich.befunde[0]?.text).toMatch(/nichts vorgefunden|weder/)

    await alsEigentuemer((c) => probeVermerken(c, { sicherungVom: '2026-09-21T02:00:00Z', ergebnis: 'befunde', geprueft: leer, befunde: 2 }))
    const hart = await alsEigentuemer(sicherungsprobePruefen)
    expect(hatHarte([hart])).toBe(true)
    expect(hart.befunde[0]?.text).toMatch(/2 Befund/)
  })

  it('meldet eine alte Probe als weichen Befund', async () => {
    await direkt(
      `insert into sicherungs_probe (zeitpunkt, sicherung_vom, ergebnis, ereignisse, archiveintraege, dateien)
       values (now() - make_interval(days => $1), now() - make_interval(days => $1), 'getragen', 5, 1, 1)`,
      [PROBE_HOECHSTALTER_TAGE + 5],
    )
    const b = await alsEigentuemer(sicherungsprobePruefen)
    expect(hatHarte([b])).toBe(false)
    expect(b.befunde.map((f) => f.text).join()).toMatch(/Tage alt/)
  })

  it('laesst die Anwendung keine Probe vortaeuschen und keine aendern', async () => {
    /*
     * Unter dms_app gibt es keine Schreibpolicy -- ein insert wird
     * abgewiesen (bei insert meldet RLS einen Fehler, statt die Zeile
     * verschwinden zu lassen). Und was einmal vermerkt ist, bleibt so.
     */
    await expect(
      alsAnmeldung((c) =>
        c.query(
          `insert into sicherungs_probe (sicherung_vom, ergebnis, ereignisse, archiveintraege, dateien)
           values (now(), 'getragen', 0, 0, 0)`,
        ),
      ),
    ).rejects.toThrow(/row-level security|permission denied/)

    await alsEigentuemer((c) =>
      probeVermerken(c, { sicherungVom: '2026-09-20T02:00:00Z', ergebnis: 'getragen', geprueft: { ereignisse: 1, archiveintraege: 0, dateien: 0 }, befunde: 0 }),
    )
    await expect(direkt("update sicherungs_probe set ergebnis = 'befunde'")).rejects.toThrow(/append-only/)
    await expect(direkt('delete from sicherungs_probe')).rejects.toThrow(/append-only/)
    expect((await alsEigentuemer(letzteProbe))?.ergebnis).toBe('getragen')
  })

  it('zeigt die letzte Probe auch der Anwendungsrolle', async () => {
    await alsEigentuemer((c) =>
      probeVermerken(c, { sicherungVom: '2026-09-20T02:00:00Z', ergebnis: 'getragen', geprueft: { ereignisse: 1, archiveintraege: 0, dateien: 0 }, befunde: 0 }),
    )
    expect((await alsAnmeldung(letzteProbe))?.ergebnis).toBe('getragen')
  })
})

describe('Datenbank', () => {
  it('findet die lokale Datenbank vollstaendig migriert und geschuetzt', async () => {
    const b = await alsEigentuemer((c) => datenbankPruefen(c, resolve('supabase/migrations')))
    expect(b.befunde.filter((f) => f.schwere === 'hart')).toEqual([])
    expect(b.geprueft.join('\n')).toMatch(/Alle \d+ Migrationen eingespielt/)
    expect(b.geprueft.join('\n')).toMatch(/Unveränderlichkeitstrigger vollständig/)
    expect(b.geprueft.join('\n')).toMatch(/Hash-Kette/)
  })

  it('sagt, wenn es die Migrationsdateien nicht pruefen konnte', async () => {
    const b = await alsEigentuemer((c) => datenbankPruefen(c, null))
    expect(b.befunde.map((f) => f.text).join()).toMatch(/nicht auffindbar/)
    expect(b.geprueft.join('\n')).not.toMatch(/Migrationen eingespielt/)
  })
})

describe('Verfahrensdokumentation', () => {
  const organisation = { verfahren: 'a ⬜ b ⬜ c', verzeichnis: 'nichts offen' }

  it('meldet jeden Mandanten ohne Freigabe hart', async () => {
    const b = await alsEigentuemer((c) => verfahrensdokuPruefen(c, '# Text', organisation))
    const hart = b.befunde.filter((f) => f.schwere === 'hart').map((f) => f.text)
    expect(hart.join('\n')).toMatch(/Nord.*keine freigegebene/)
    expect(hart.join('\n')).toMatch(/Sued.*keine freigegebene/)
    // Die offenen Punkte werden gezaehlt, nicht erraten.
    expect(b.befunde.map((f) => f.text).join()).toMatch(/2 offene Punkte im organisatorischen/)
    expect(b.geprueft.join('\n')).toMatch(/Verzeichnis .* ohne offene Punkte/)
  })

  it('erkennt eine Freigabe, die den laufenden Stand beschreibt -- und eine, die es nicht tut', async () => {
    const text = `# Verfahrensdokumentation ${randomUUID()}`
    await alsBenutzer(ANNA, (c) =>
      fassungFreigeben(c, new Merkablage(), { version: '2026-09-22', gueltigAb: '2026-09-22', titel: 'T', text }),
    )

    const passt = await alsEigentuemer((c) => verfahrensdokuPruefen(c, text, organisation))
    expect(passt.geprueft.join('\n')).toMatch(/Nord.*2026-09-22 entspricht dem Repository/)
    expect(passt.befunde.map((f) => f.text).join()).not.toMatch(/Nord/)
    // Sued hat weiterhin keine.
    expect(passt.befunde.map((f) => f.text).join()).toMatch(/Sued.*keine freigegebene/)

    const veraltet = await alsEigentuemer((c) => verfahrensdokuPruefen(c, `${text}\nneu`, organisation))
    expect(veraltet.befunde.filter((f) => f.schwere === 'hart').map((f) => f.text).join()).toMatch(
      /Nord.*beschreibt nicht den laufenden Stand/,
    )
  })
})

describe('Objektspeicher', () => {
  const ENDPUNKT = process.env['DMS_S3_ENDPUNKT'] ?? 'http://127.0.0.1:9000'
  const SCHLUESSEL = process.env['DMS_S3_SCHLUESSEL'] ?? 'dmsminio'
  const GEHEIMNIS = process.env['DMS_S3_GEHEIMNIS'] ?? 'dmsminio123'
  const mitSperre = `dms-inb-${randomUUID().slice(0, 8)}`
  const ohneSperre = `dms-inb-${randomUUID().slice(0, 8)}`
  let erreichbar = false

  beforeAll(async () => {
    const klient = new S3Client({
      region: 'us-east-1',
      endpoint: ENDPUNKT,
      forcePathStyle: true,
      credentials: { accessKeyId: SCHLUESSEL, secretAccessKey: GEHEIMNIS },
    })
    try {
      await klient.send(new CreateBucketCommand({ Bucket: mitSperre, ObjectLockEnabledForBucket: true }))
      await klient.send(new CreateBucketCommand({ Bucket: ohneSperre }))
      erreichbar = true
    } catch {
      erreichbar = false
      process.stdout.write(
        `\n  Hinweis: MinIO unter ${ENDPUNKT} nicht erreichbar — die Objektspeicherpruefung wurde uebersprungen.\n`,
      )
    }
  }, 30_000)

  const ablage = (eimer: string) =>
    new S3Ablage({ eimer, endpunkt: ENDPUNKT, zugriffsschluessel: SCHLUESSEL, geheimnis: GEHEIMNIS })

  it('findet einen Eimer mit Object Lock in Ordnung und beschreibt die Probe', async () => {
    if (!erreichbar) return
    const b = await objektspeicherPruefen(ablage(mitSperre), mitSperre)
    expect(b.befunde).toEqual([])
    expect(b.geprueft.join('\n')).toMatch(/Object Lock am Eimer eingeschaltet/)
    expect(b.geprueft.join('\n')).toMatch(/Compliance-Modus gesperrt/)
    expect(b.geprueft.join('\n')).toMatch(/über ihre Kennung zurückgelesen/)
  }, 30_000)

  it('weist einen Eimer ohne Object Lock hart ab', async () => {
    if (!erreichbar) return
    const b = await objektspeicherPruefen(ablage(ohneSperre), ohneSperre)
    expect(hatHarte([b])).toBe(true)
    expect(b.befunde.map((f) => f.text).join('\n')).toMatch(/ohne Object Lock angelegt/)
  }, 30_000)
})
