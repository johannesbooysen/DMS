/**
 * Ablage auf S3 — mit Object Lock im Compliance-Modus.
 *
 * **Warum es das braucht.** Die Revisionssicherheit ruht auf zwei Säulen. Die
 * eine ist die Hash-Kette: Sie *erkennt*, wenn eine Datei sich geändert hat.
 * Die andere ist unveränderlicher Speicher: Er *verhindert*, dass das
 * Original dabei verlorengeht. Mit der Dateisystem-Ablage gibt es nur die
 * erste — wer eine Datei überschreibt, wird beim Archivhash ertappt, aber das
 * Original ist weg.
 *
 * **Was Object Lock wirklich zusagt — und was nicht.** Der erste Entwurf
 * dieses Moduls behauptete im Kopf, eine gesperrte Datei lasse sich nicht
 * überschreiben. Das ist falsch, und der Test gegen MinIO hat es sofort
 * gezeigt. Object Lock schützt **Fassungen**, nicht Schlüssel:
 *
 *   - Das Überschreiben gelingt. Es entsteht eine *zweite* Fassung.
 *   - Ein gewöhnliches Lesen liefert ab dann die zweite — den gefälschten
 *     Inhalt.
 *   - Die gesperrte Fassung bleibt daneben liegen und lässt sich **nicht**
 *     löschen, von niemandem.
 *
 * Die Sperre ist also eine Zusage über *Erhalt*, nicht über *Abweisung*.
 * Eingelöst wird sie erst dadurch, dass beim Archivieren die Fassungskennung
 * festgehalten und beim Lesen wieder mitgegeben wird
 * (`archiv_eintrag.storage_fassung`). Ohne diesen Schritt wäre die Sperre
 * teurer Speicherplatz: das Original unzerstörbar, aber unerreichbar.
 *
 * **Compliance und nicht Governance.** Im Governance-Modus darf ein Konto mit
 * dem Recht `BypassGovernanceRetention` die Sperre aufheben. Das ist genau
 * das, was ein Angreifer mit Administratorrechten täte — und genau das, was
 * ein Prüfer ausschließen will. Compliance kann **niemand** aufheben, auch
 * der Wurzelbenutzer nicht, und die Frist lässt sich nur verlängern, nie
 * verkürzen.
 *
 * Das ist eine ernste Zusage in beide Richtungen: Wer hier ein falsches Datum
 * setzt, hat eine Datei, die bis dahin liegen bleibt. Deshalb wird die Sperre
 * erst **nach** dem Archivieren gesetzt, nie im selben Zug, und die Frist
 * kommt aus `aufbewahrung_bis` — einem Stammdatum, keiner Schätzung.
 */

import {
  GetObjectCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectRetentionCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import type { Ablage } from './ablage'

/**
 * Eine Ablage, die eine Datei gegen Änderung sperren kann.
 *
 * Getrennt von `Ablage`, damit der Unterschied im Typ steht: Wer sperren
 * will, muss prüfen, ob die Ablage das kann. Eine optionale Methode auf
 * `Ablage` ließe die Frage offen, und „nicht gesetzt" sähe aus wie „gesetzt".
 */
export interface SperrbareAblage extends Ablage {
  /**
   * Sperrt die **aktuelle Fassung** der Datei bis zum Datum — unwiderruflich.
   *
   * Gibt die Fassungskennung zurück, die gesperrt wurde. Die gehört
   * festgehalten: Sie ist der einzige Weg, später genau diese Bytes wieder
   * zu bekommen (siehe Modulkopf). Ein Aufrufer, der sie wegwirft, hat eine
   * unzerstörbare Datei, die er nicht mehr findet.
   *
   * Verlängern geht, verkürzen nicht.
   */
  sperren(schluessel: string, bis: Date): Promise<string | null>

  /** Bis wann die Fassung gesperrt ist, oder `null`. Für den Nachweis. */
  sperrstand(schluessel: string, fassung?: string | null): Promise<Date | null>
}

export function kannSperren(ablage: Ablage): ablage is SperrbareAblage {
  return typeof (ablage as Partial<SperrbareAblage>).sperren === 'function'
}

export interface S3Einstellungen {
  endpunkt?: string | undefined
  region?: string | undefined
  eimer: string
  zugriffsschluessel: string
  geheimnis: string
  /**
   * MinIO und die meisten selbstgehosteten Speicher brauchen die Pfadform
   * (`host/eimer/objekt`) statt der Unterdomänenform. AWS selbst kommt mit
   * beidem zurecht.
   */
  pfadform?: boolean | undefined
}

export class S3Ablage implements SperrbareAblage {
  private readonly klient: S3Client
  private readonly eimer: string

  constructor(einstellungen: S3Einstellungen) {
    this.eimer = einstellungen.eimer

    const konfiguration: S3ClientConfig = {
      region: einstellungen.region ?? 'us-east-1',
      credentials: {
        accessKeyId: einstellungen.zugriffsschluessel,
        secretAccessKey: einstellungen.geheimnis,
      },
      forcePathStyle: einstellungen.pfadform ?? true,
    }
    if (einstellungen.endpunkt !== undefined) konfiguration.endpoint = einstellungen.endpunkt

    this.klient = new S3Client(konfiguration)
  }

  async schreiben(schluessel: string, inhalt: Buffer): Promise<void> {
    await this.klient.send(
      new PutObjectCommand({
        Bucket: this.eimer,
        Key: schluessel,
        Body: inhalt,
        // Die Pruefsumme laesst S3 selbst rechnen und vergleichen: Eine
        // Uebertragung, die unterwegs kippt, wird abgewiesen statt still
        // abgelegt.
        ChecksumAlgorithm: 'SHA256',
      }),
    )
  }

  async lesen(schluessel: string, fassung?: string | null): Promise<Buffer> {
    const antwort = await this.klient.send(
      new GetObjectCommand({
        Bucket: this.eimer,
        Key: schluessel,
        // Ohne Fassung die aktuelle -- das ist der Normalfall fuer alles,
        // was nicht archiviert ist. Mit Fassung genau die archivierte, auch
        // wenn daneben inzwischen eine neuere liegt.
        ...(fassung != null && fassung !== '' ? { VersionId: fassung } : {}),
      }),
    )
    if (antwort.Body === undefined) {
      throw new Error(`Ablageobjekt ohne Inhalt: ${schluessel}`)
    }
    return Buffer.from(await antwort.Body.transformToByteArray())
  }

  /** Die Kennung der aktuellen Fassung, oder `null` ohne Versionierung. */
  async fassungVon(schluessel: string): Promise<string | null> {
    const antwort = await this.klient.send(
      new HeadObjectCommand({ Bucket: this.eimer, Key: schluessel }),
    )
    return antwort.VersionId ?? null
  }

  async sperren(schluessel: string, bis: Date): Promise<string | null> {
    /*
     * Erst die Fassung feststellen, dann sperren -- und **diese** Fassung
     * ausdruecklich benennen.
     *
     * Ohne `VersionId` sperrt S3 die zur Laufzeit aktuelle. Das ist fast
     * immer dieselbe, aber eben nur fast: Schriebe jemand genau dazwischen,
     * traegen wir eine Kennung ein und gesperrt waere eine andere. Das faellt
     * nie auf -- bis es darauf ankommt.
     */
    const fassung = await this.fassungVon(schluessel)

    await this.klient.send(
      new PutObjectRetentionCommand({
        Bucket: this.eimer,
        Key: schluessel,
        Retention: { Mode: 'COMPLIANCE', RetainUntilDate: bis },
        ...(fassung != null ? { VersionId: fassung } : {}),
      }),
    )
    return fassung
  }

  async sperrstand(schluessel: string, fassung?: string | null): Promise<Date | null> {
    try {
      const antwort = await this.klient.send(
        new GetObjectRetentionCommand({
          Bucket: this.eimer,
          Key: schluessel,
          ...(fassung != null && fassung !== '' ? { VersionId: fassung } : {}),
        }),
      )
      return antwort.Retention?.RetainUntilDate ?? null
    } catch (fehler) {
      /*
       * „Keine Sperre" ist kein Fehler, sondern eine Antwort.
       *
       * S3 meldet sie als Ausnahme (`NoSuchObjectLockConfiguration`). Wer sie
       * durchreicht, macht aus einer normalen Auskunft einen Abbruch -- und
       * der Aufrufer muesste sie doch wieder abfangen.
       */
      const name = (fehler as { name?: string }).name ?? ''
      if (name.includes('NoSuchObjectLockConfiguration') || name.includes('NoSuchKey')) {
        return null
      }
      throw fehler
    }
  }
}

/**
 * Die Ablage aus der Umgebung.
 *
 * Ohne `DMS_S3_EIMER` bleibt es beim Dateisystem — die Vorgabe für die
 * Entwicklung. Kein stiller Rückfall in die andere Richtung: Wer den Eimer
 * setzt, aber die Zugangsdaten vergisst, bekommt einen Fehler und keine
 * Ablage, die klaglos ins Dateisystem schreibt.
 */
export function s3AusUmgebung(): S3Ablage | null {
  const eimer = process.env['DMS_S3_EIMER']
  if (eimer === undefined || eimer === '') return null

  const zugriffsschluessel = process.env['DMS_S3_SCHLUESSEL']
  const geheimnis = process.env['DMS_S3_GEHEIMNIS']
  if (
    zugriffsschluessel === undefined ||
    zugriffsschluessel === '' ||
    geheimnis === undefined ||
    geheimnis === ''
  ) {
    throw new Error(
      'DMS_S3_EIMER ist gesetzt, aber DMS_S3_SCHLUESSEL oder DMS_S3_GEHEIMNIS fehlt.',
    )
  }

  return new S3Ablage({
    eimer,
    zugriffsschluessel,
    geheimnis,
    endpunkt: process.env['DMS_S3_ENDPUNKT'],
    region: process.env['DMS_S3_REGION'],
    pfadform: process.env['DMS_S3_PFADFORM'] !== 'nein',
  })
}
