/**
 * Datenbankzugriff.
 *
 * Alle Abfragen der Anwendung laufen unter der Rolle `dms_app` und mit
 * gesetztem `app.benutzer_id`. Der Tabelleneigentuemer umgeht die RLS --
 * eine Verbindung, die als Eigentuemer arbeitet, hebt die Sicherheitsgrenze
 * auf, ohne dass es auffaellt. Deshalb gibt es hier genau einen Weg in die
 * Datenbank, und der setzt beides.
 */

import { Pool, type PoolClient } from 'pg'

export const VERBINDUNG =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

let pool: Pool | undefined

export function verbindungspool(): Pool {
  pool ??= new Pool({ connectionString: VERBINDUNG })
  return pool
}

export async function poolSchliessen(): Promise<void> {
  await pool?.end()
  pool = undefined
}

/**
 * Fuehrt `aktion` im Namen eines Benutzers in einer Transaktion aus.
 * Bei einem Fehler wird zurueckgerollt.
 */
export async function alsBenutzer<T>(
  benutzerId: string,
  aktion: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await verbindungspool().connect()
  try {
    await client.query('begin')
    await client.query('set local role dms_app')
    await client.query('select set_config($1, $2, true)', ['app.benutzer_id', benutzerId])
    const ergebnis = await aktion(client)
    await client.query('commit')
    return ergebnis
  } catch (fehler) {
    await client.query('rollback')
    throw fehler
  } finally {
    client.release()
  }
}

/**
 * Fuer den Worker: Hintergrundaufgaben haben keinen anmeldenden Benutzer,
 * brauchen aber trotzdem einen Kontext. Uebergeben wird der technische
 * Benutzer des Mandanten -- nicht der Eigentuemer.
 */
export async function alsSystem<T>(
  benutzerId: string,
  aktion: (c: PoolClient) => Promise<T>,
): Promise<T> {
  return alsBenutzer(benutzerId, aktion)
}
