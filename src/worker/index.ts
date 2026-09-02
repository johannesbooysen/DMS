/**
 * Worker-Prozess.
 *
 * Laeuft getrennt von der Next.js-Anwendung: OCR, Extraktion und Rendern
 * dauern zu lange fuer einen Request. Gestartet ueber `npm run dev:worker`
 * oder zusammen mit der Anwendung ueber `npm run dev`.
 */

import type { Job, JobWithMetadata } from 'pg-boss'
import { DateisystemAblage } from '../ablage'
import { kannSperren, s3AusUmgebung } from '../ablage-s3'
import { objektsperrenSetzen } from '../archiv/objektsperre'
import { alsSystem } from '../db'
import {
  AUFBEREITUNG,
  FEHLERKORB,
  STAPELAUFBEREITUNG,
  queueBeenden,
  queueStarten,
  type AufbereitungsAuftrag,
  type FehlerkorbAuftrag,
  type StapelAuftrag,
} from '../queue'
import { eingangAbholen } from '../eingang'
import { fehlerMelden } from '../fehlerkorb'
import { texterkennung } from '../ocr'
import { aufbereiten } from './aufbereitung'
import { stapelAufbereiten } from './stapelaufbereitung'
import { postSenden, versandAusUmgebung, versandEingerichtet } from '../postausgang'

const ABLAGE_WURZEL = process.env.DMS_ABLAGE ?? '.ablage'

/** Wie oft im Ausgangsbuch nachgesehen wird. */
const POSTTAKT_MS = 30_000

/**
 * Wie oft nach unversiegelten Archiveintraegen gesehen wird.
 *
 * Selten, und das mit Absicht: Ein Beleg, der eine Viertelstunde spaeter
 * gesperrt wird, ist kein Schaden -- er ist archiviert und festgeschrieben,
 * die Datenbank laesst ihn schon nicht mehr aendern. Die Sperre schuetzt
 * gegen den Zugriff *am Speicher vorbei*, und dafuer ist eine Viertelstunde
 * kein Fenster, das jemand planvoll nutzt.
 */
const SPERRTAKT_MS = 900_000

/**
 * Wie oft nach faelligen Eingangsquellen gesehen wird.
 *
 * Nicht, wie oft eine Quelle abgefragt wird -- das steht an der Quelle
 * selbst (`takt_sekunden`). Hier wird nur nachgesehen, ob eine faellig ist.
 */
const EINGANGSTAKT_MS = 60_000

/**
 * Zieht aus dem pg-boss-`output` eine lesbare Zeile.
 *
 * Was dort steht, haengt vom Fehler ab: mal `{ message }`, mal ein
 * serialisierter Error, mal etwas anderes. Gekuerzt wird spaeter in der
 * Datenbank -- hier geht es nur darum, nicht `[object Object]` in den Korb
 * zu schreiben.
 */
function grundLesen(ausgabe: unknown): string {
  if (ausgabe == null) return 'Ohne Angabe abgebrochen'
  if (typeof ausgabe === 'string') return ausgabe

  const o = ausgabe as Record<string, unknown>
  for (const feld of ['message', 'value', 'error']) {
    const wert = o[feld]
    if (typeof wert === 'string' && wert !== '') return wert
  }
  return JSON.stringify(ausgabe).slice(0, 500)
}

async function start(): Promise<void> {
  /*
   * S3, sobald `DMS_S3_EIMER` gesetzt ist, sonst ein Verzeichnis.
   *
   * Der Unterschied ist nicht nur der Ort: Nur S3 kann Object Lock, und nur
   * damit ist das Archiv mehr als eine Behauptung. Deshalb sagt der Worker
   * beim Start, was er hat -- wer ohne Sperre laeuft, soll es wissen und
   * nicht erst bei der ersten Pruefung erfahren.
   */
  const ablage = s3AusUmgebung() ?? new DateisystemAblage(ABLAGE_WURZEL)
  const boss = await queueStarten()

  boss.on('error', (fehler: Error) => {
    // Keine Auftragsdaten mitloggen -- sie enthalten Kennungen, die mit
    // Dokumentinhalten verknuepfbar sind.
    console.error('[worker] Queue-Fehler:', fehler.message)
  })

  /*
   * Einmal beim Start sagen, ob Texterkennung da ist.
   *
   * Ohne sie landet jeder Scan ohne Textlayer im Fehlerkorb -- richtig so,
   * aber wer den Worker startet, soll es vorher wissen und nicht erst an
   * dreissig Eintraegen merken. Geprueft wird nicht nur die Einstellung,
   * sondern der Aufruf: `DMS_OCR=ocrmypdf` auf einem Rechner ohne Tesseract
   * ist dasselbe wie gar nichts.
   */
  const erkennung = texterkennung()
  if (erkennung === null) {
    console.log('[worker] keine Texterkennung eingerichtet, Scans gehen in den Fehlerkorb')
  } else if (!(await erkennung.verfuegbar())) {
    console.warn(`[worker] ${erkennung.name} ist eingestellt, aber nicht aufrufbar`)
  } else {
    console.log(`[worker] Texterkennung: ${erkennung.name}`)
  }

  if (kannSperren(ablage)) {
    console.log('[worker] Objektspeicher mit Object Lock, Archiv wird versiegelt')
  } else {
    console.log('[worker] Ablage im Dateisystem, keine Objektsperre -- nur die Hash-Kette')
  }

  await boss.work<AufbereitungsAuftrag>(
    AUFBEREITUNG,
    async (auftraege: Job<AufbereitungsAuftrag>[]) => {
      for (const auftrag of auftraege) {
        const { dokumentId, benutzerId } = auftrag.data
        await alsSystem(benutzerId, (c) => aufbereiten(c, ablage, dokumentId))
      }
    },
  )

  // Eigene Warteschlange: Ein Stapel mit dreissig Seiten darf nicht den
  // Beleg aufhalten, der gerade eingegangen ist.
  await boss.work<StapelAuftrag>(
    STAPELAUFBEREITUNG,
    async (auftraege: Job<StapelAuftrag>[]) => {
      for (const auftrag of auftraege) {
        const { stapelId, benutzerId } = auftrag.data
        await alsSystem(benutzerId, (c) => stapelAufbereiten(c, ablage, stapelId))
      }
    },
  )

  /*
   * Der Fehlerkorb.
   *
   * pg-boss legt einen aufgegebenen Auftrag nach drei Versuchen hier ab. Der
   * Auftrag verschwaende dort still -- deshalb wird er hier abgeholt und als
   * fachlicher Vorgang festgehalten: mit Grund, mit Mandant, mit Sichtbarkeit
   * und mit einem Ausgang, den ein Mensch waehlt.
   *
   * `includeMetadata`, weil erst die Metadaten sagen, **warum** und **woher**:
   * `output` traegt den Fehler, `sourceName` die urspruengliche
   * Warteschlange. Ohne sie stuende im Korb nur, dass etwas schiefging.
   */
  await boss.work(
    FEHLERKORB,
    { includeMetadata: true },
    async (auftraege: JobWithMetadata<FehlerkorbAuftrag>[]) => {
      for (const auftrag of auftraege) {
        const { dokumentId, stapelId, benutzerId } = auftrag.data
        await fehlerMelden(benutzerId, {
          dokumentId: dokumentId ?? null,
          stapelId: stapelId ?? null,
          warteschlange: auftrag.sourceName ?? auftrag.name,
          grund: grundLesen(auftrag.output),
          versuche: auftrag.sourceRetryCount ?? auftrag.retryCount,
          auftragId: auftrag.sourceId ?? auftrag.id,
        })
      }
    },
  )

  /*
   * Eingangsquellen -- ebenfalls eine Schleife, aus demselben Grund wie der
   * Postausgang: Der Takt steht an der Quelle, nicht in einem Auftrag.
   *
   * Ein Durchgang holt nur, was faellig ist (`eingangsquellen_faellig`).
   * Alles Weitere -- Hash, Dublettenpruefung, Aufbereitung -- macht der
   * gewoehnliche Eingang; hier wird nichts abgekuerzt.
   */
  setInterval(() => {
    void eingangAbholen(ablage).then(({ quellen, aufgenommen, gescheitert }) => {
      // Keine Quellennamen und keine Pfade im Log -- ein Postfachname ist
      // eine Adresse (Projektregel). Was schiefging, steht in der Quelle.
      if (aufgenommen + gescheitert > 0) {
        console.log(
          `[worker] Eingang: ${quellen} Quellen, ${aufgenommen} aufgenommen,`,
          `${gescheitert} gescheitert`,
        )
      }
    })
  }, EINGANGSTAKT_MS).unref()

  /*
   * Der Postausgang laeuft als Schleife, nicht als Warteschlange.
   *
   * Ein Ausgangseintrag entsteht in derselben Transaktion wie sein Anlass --
   * einen Auftrag zusaetzlich einzureihen waere ein zweites Fehlerfenster
   * fuer dieselbe Sache. Das Ausgangsbuch **ist** die Warteschlange; hier
   * wird nur regelmaessig nachgesehen.
   */
  if (!versandEingerichtet()) {
    console.log('[worker] kein Mailversand eingerichtet, Ausgangsbuch bleibt liegen')
  }
  const versand = versandAusUmgebung()
  setInterval(() => {
    void postSenden(ablage, versand).then(({ gesendet, gescheitert }) => {
      // Keine Empfaenger im Log -- sie stehen im Ausgangsbuch (Projektregel).
      if (gesendet + gescheitert > 0) {
        console.log('[worker] Postausgang:', gesendet, 'gesendet,', gescheitert, 'gescheitert')
      }
    })
  }, POSTTAKT_MS).unref()

  /*
   * Die Objektsperre laeuft als Durchgang, nicht als Warteschlange -- aus
   * demselben Grund wie der Postausgang, nur mit schaerferer Folge: Ein
   * Auftrag aus einer zurueckgerollten Archivierung wuerde eine Datei
   * sperren, die gar nicht archiviert ist, und im Compliance-Modus nimmt das
   * niemand mehr zurueck. Der Archiveintrag ist die Warteschlange; eine
   * leere Spalte heisst offen.
   *
   * Ohne sperrfaehige Ablage tut der Durchgang nichts und sagt auch nichts --
   * beim Start steht es schon.
   */
  if (kannSperren(ablage)) {
    setInterval(() => {
      void objektsperrenSetzen(ablage).then(({ gesperrt, gescheitert }) => {
        // Keine Kennungen und keine Ablageschluessel im Log -- der Schluessel
        // traegt Mandant und Objekt (Projektregel).
        if (gesperrt + gescheitert > 0) {
          console.log('[worker] Objektsperre:', gesperrt, 'gesetzt,', gescheitert, 'gescheitert')
        }
      })
    }, SPERRTAKT_MS).unref()
  }

  console.log('[worker] bereit, Warteschlangen:', AUFBEREITUNG, STAPELAUFBEREITUNG, FEHLERKORB)
}

async function beenden(signal: string): Promise<void> {
  console.log(`[worker] ${signal} empfangen, fahre herunter`)
  await queueBeenden()
  process.exit(0)
}

process.on('SIGINT', () => void beenden('SIGINT'))
process.on('SIGTERM', () => void beenden('SIGTERM'))

start().catch((fehler: unknown) => {
  console.error('[worker] Start fehlgeschlagen:', fehler)
  process.exit(1)
})
