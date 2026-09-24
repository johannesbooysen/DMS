/**
 * Die Benutzerkennung der Skripte: E-Mail-Adresse oder Kennung.
 *
 * Die Skripte (Uebernahme, Objektakte, Freigabe der Verfahrensdokumentation)
 * laufen unter einem Benutzer und damit unter dessen Rechten. Bis hierher
 * verlangten sie die Datenbankkennung -- eine UUID, die in keiner Maske
 * steht. Wer das Skript aufruft, kennt die E-Mail-Adresse. Beides geht.
 *
 * Nachgeschlagen wird als Eigentuemer, nicht unter der RLS: Vor dem
 * Nachschlagen gibt es noch keinen Benutzer, unter dem eine Policy laufen
 * koennte. Ein gesperrter Benutzer wird abgewiesen -- unter ihm liefe sonst
 * ein Skript, waehrend die Oberflaeche ihn nicht mehr hereinlaesst.
 */

import { verbindungspool } from './db'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class BenutzerUnbekannt extends Error {}

export async function benutzerIdAufloesen(kennung: string): Promise<string> {
  const k = kennung.trim()
  if (k === '') throw new BenutzerUnbekannt('Keine Benutzerkennung angegeben.')
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query<{ id: string; aktiv: boolean }>(
      UUID.test(k)
        ? 'select id, aktiv from benutzer where id = $1'
        : 'select id, aktiv from benutzer where lower(email) = lower($1)',
      [k],
    )
    const b = rows[0]
    // Keine Adresse in der Meldung: Sie kaeme ins Protokoll des Aufrufers.
    if (b === undefined) throw new BenutzerUnbekannt('Diesen Benutzer gibt es nicht.')
    if (!b.aktiv) throw new BenutzerUnbekannt('Dieser Benutzer ist gesperrt.')
    return b.id
  } finally {
    c.release()
  }
}
