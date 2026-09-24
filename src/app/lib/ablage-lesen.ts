/**
 * Aus der Ablage lesen -- und "gibt es nicht" als Antwort, nicht als Absturz.
 *
 * Ein Beleg kann Seiten behaupten, deren Bilder fehlen: eine Ablage, die
 * umgezogen wurde, ein Derivat, das die Aufbereitung nicht geschrieben hat,
 * eine Datei, die ein Durchgang abgeraeumt hat. Bis hierher wurde daraus
 * ein 500 mit dem Dateipfad im Serverlog -- und der Pfad traegt Mandant und
 * Objekt. Jetzt ist es ein 404: Das Bild bleibt leer, der Rest der Seite
 * steht, und im Log steht nichts, was nicht hineingehoert.
 */

import { ABLAGE } from '@/app/lib/belege'

function fehlt(fehler: unknown): boolean {
  if (typeof fehler !== 'object' || fehler === null) return false
  const f = fehler as { code?: unknown; name?: unknown }
  return (
    f.code === 'ENOENT' ||
    f.name === 'NoSuchKey' ||
    f.name === 'NotFound' ||
    f.code === 'NoSuchKey'
  )
}

/** Der Inhalt -- oder `null`, wenn es die Datei in der Ablage nicht gibt. */
export async function lesenOderNichts(
  schluessel: string,
  fassung?: string | null,
): Promise<Buffer | null> {
  try {
    return await ABLAGE.lesen(schluessel, fassung)
  } catch (fehler) {
    if (fehlt(fehler)) return null
    throw fehler
  }
}
