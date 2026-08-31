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
import type { PoolClient } from 'pg'
import { VERBINDUNG } from './db'

export const AUFBEREITUNG = 'dokument-aufbereiten'

/**
 * Ein eingegangener Stapel wird gelesen, gerendert und getrennt.
 *
 * Eigene Warteschlange und nicht dieselbe wie die Dokumentaufbereitung: Ein
 * Stapel mit dreissig Seiten haelt sonst den Beleg auf, der gerade
 * eingegangen ist.
 */
export const STAPELAUFBEREITUNG = 'stapel-aufbereiten'

/**
 * Fehlerkorb: Was passiert mit einem Dokument, dessen Aufbereitung dreimal
 * scheitert (Konzept 24, Punkt 8). Der Auftrag wandert hierher statt zu
 * verschwinden -- sichtbar, wiederholbar, nicht still verloren.
 */
export const FEHLERKORB = 'dokument-aufbereiten-fehlerkorb'

export interface StapelAuftrag {
  stapelId: string
  mandantId: string
  benutzerId: string
}

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
  await neu.createQueue(STAPELAUFBEREITUNG, {
    retryLimit: 3,
    retryBackoff: true,
    deadLetter: FEHLERKORB,
  })
  await neu.createQueue(AUFBEREITUNG, {
    retryLimit: 3,
    retryBackoff: true,
    deadLetter: FEHLERKORB,
  })

  await rechteFuerAnwendungsrolle(neu)

  boss = neu
  return boss
}

/**
 * Die Anwendung reicht Aufträge über ihre eigene Verbindung ein, damit
 * Dokument und Auftrag gemeinsam festgeschrieben werden. Dafür braucht die
 * Rolle `dms_app` Schreibrecht im Schema `pgboss`.
 *
 * Das steht hier und nicht in einer Migration: pg-boss legt sein Schema zur
 * Laufzeit an und erzeugt beim Anlegen einer Warteschlange weitere Tabellen.
 * Eine Migration liefe entweder zu früh oder würde die späteren Partitionen
 * verfehlen. Die Anweisungen sind wiederholbar und laufen bei jedem Start.
 */
async function rechteFuerAnwendungsrolle(b: PgBoss): Promise<void> {
  const vorhanden = await b.getQueues()
  if (vorhanden === undefined) return

  for (const anweisung of [
    'grant usage on schema pgboss to dms_app',
    'grant select, insert, update, delete on all tables in schema pgboss to dms_app',
    'grant usage, select on all sequences in schema pgboss to dms_app',
    'alter default privileges in schema pgboss ' +
      'grant select, insert, update, delete on tables to dms_app',
  ]) {
    await b.getDb().executeSql(anweisung)
  }
}

export async function queueBeenden(): Promise<void> {
  await boss?.stop({ graceful: true })
  boss = undefined
}

/**
 * Reicht die laufende Transaktion an pg-boss weiter, damit der Auftrag
 * gemeinsam mit dem Dokument sichtbar wird.
 *
 * Ohne das gäbe es zwei Fehlerfenster: Wird zuerst eingereiht und die
 * Transaktion bricht ab, arbeitet der Worker an einem Dokument, das es nie
 * gab. Wird zuerst festgeschrieben und der Prozess stirbt, bleibt ein
 * Dokument für immer in `in_aufbereitung` liegen. Gemeinsam festgeschrieben
 * gibt es beides nicht.
 */
export function alsDatenbank(c: PoolClient) {
  return {
    executeSql: async (text: string, values?: unknown[]) => {
      const ergebnis = await c.query(text, values as unknown[])
      return { rows: ergebnis.rows }
    },
  }
}

export async function aufbereitungEinreihen(
  auftrag: AufbereitungsAuftrag,
  c?: PoolClient,
): Promise<string | null> {
  const b = await queueStarten()
  return b.send(AUFBEREITUNG, auftrag, c === undefined ? {} : { db: alsDatenbank(c) })
}

export async function stapelEinreihen(
  auftrag: StapelAuftrag,
  c?: PoolClient,
): Promise<string | null> {
  const b = await queueStarten()
  return b.send(STAPELAUFBEREITUNG, auftrag, c === undefined ? {} : { db: alsDatenbank(c) })
}

/** Auftraege im Fehlerkorb -- Grundlage der Betriebsansicht. */
export async function fehlerkorbGroesse(): Promise<number> {
  const b = await queueStarten()
  // getQueueStats liefert eine Zeitreihe; der letzte Punkt ist der aktuelle.
  const reihe = await b.getQueueStats(FEHLERKORB)
  return reihe.at(-1)?.queuedCount ?? 0
}
