/**
 * Warteschlange.
 *
 * pg-boss legt sein Schema (`pgboss`) in derselben Datenbank an -- keine
 * zweite Infrastruktur. Fuer 25.000 Belege im Jahr ist das um
 * Groessenordnungen ausreichend.
 *
 * Jeder Auftrag traegt nur Kennungen, niemals Dokumentinhalt: die
 * Auftragstabelle ist ein Log, und in Logs gehoeren keine
 * personenbezogenen Daten (Projektregel).
 */

import { PgBoss } from 'pg-boss'
import { VERBINDUNG } from './db.js'

export const AUFBEREITUNG = 'dokument-aufbereiten'

/**
 * Fehlerkorb: Was passiert mit einem Dokument, dessen Aufbereitung dreimal
 * scheitert (Konzept 24, Punkt 8). Der Auftrag wandert hierher statt zu
 * verschwinden -- sichtbar, wiederholbar, nicht still verloren.
 */
export const FEHLERKORB = 'dokument-aufbereiten-fehlerkorb'

export interface AufbereitungsAuftrag {
  dokumentId: string
  mandantId: string
  /** Technischer Benutzer, unter dem der Worker arbeitet. */
  benutzerId: string
}

let boss: PgBoss | undefined

export async function queueStarten(): Promise<PgBoss> {
  if (boss) return boss

  const neu = new PgBoss({ connectionString: VERBINDUNG, schema: 'pgboss' })
  await neu.start()

  await neu.createQueue(FEHLERKORB)
  await neu.createQueue(AUFBEREITUNG, {
    retryLimit: 3,
    retryBackoff: true,
    deadLetter: FEHLERKORB,
  })

  boss = neu
  return boss
}

export async function queueBeenden(): Promise<void> {
  await boss?.stop({ graceful: true })
  boss = undefined
}

export async function aufbereitungEinreihen(
  auftrag: AufbereitungsAuftrag,
): Promise<string | null> {
  const b = await queueStarten()
  return b.send(AUFBEREITUNG, auftrag)
}

/** Auftraege im Fehlerkorb -- Grundlage der Betriebsansicht. */
export async function fehlerkorbGroesse(): Promise<number> {
  const b = await queueStarten()
  // getQueueStats liefert eine Zeitreihe; der letzte Punkt ist der aktuelle.
  const reihe = await b.getQueueStats(FEHLERKORB)
  return reihe.at(-1)?.queuedCount ?? 0
}
