/**
 * Wer ist angemeldet?
 *
 * Bis Migration 20260831180000 stand hier eine Umgebungsvariable. Was schon
 * damals richtig war und unverändert bleibt: Die Kennung wird an die
 * Datenbank durchgereicht, die Abfragen laufen unter `dms_app`, und die RLS
 * entscheidet. Geändert hat sich nur, **woher** die Kennung kommt — aus einer
 * serverseitigen Sitzung statt aus der Umgebung.
 *
 * `angemeldeterBenutzer()` ist deshalb jetzt `async`. Das ist keine
 * Unbequemlichkeit, sondern die ehrliche Form: Wer angemeldet ist, steht erst
 * nach einer Abfrage fest, und die Sitzung kann seit dem letzten Aufruf
 * abgelaufen oder widerrufen worden sein.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { sitzungAufloesen, SITZUNG_COOKIE, type Angemeldet } from '@/anmeldung/sitzung'

export class KeineSitzung extends Error {
  constructor() {
    super('Nicht angemeldet.')
    this.name = 'KeineSitzung'
  }
}

/**
 * Die laufende Sitzung, oder `null`.
 *
 * Für Stellen, die auch ohne Anmeldung etwas anzuzeigen haben — etwa die
 * Anmeldeseite selbst, die einen bereits Angemeldeten weiterleiten soll.
 */
export async function sitzung(): Promise<Angemeldet | null> {
  const token = (await cookies()).get(SITZUNG_COOKIE)?.value
  if (token === undefined || token === '') return null
  return sitzungAufloesen(token)
}

/**
 * Die Kennung des angemeldeten Benutzers.
 *
 * Ohne gültige Sitzung wird zur Anmeldung umgeleitet — nicht mit einem Fehler
 * abgebrochen. Ein abgelaufenes Cookie ist der Normalfall, kein Störfall.
 */
export async function angemeldeterBenutzer(): Promise<string> {
  const laufend = await sitzung()
  if (laufend === null) redirect('/anmeldung')
  return laufend.benutzerId
}

/**
 * Wie `angemeldeterBenutzer`, aber ohne Umleitung.
 *
 * Für Route Handler, die eine Datei ausliefern: Ein 302 auf die Anmeldeseite
 * käme dort als kaputtes Bild an, nicht als Aufforderung, sich anzumelden.
 */
export async function angemeldeterBenutzerOderNichts(): Promise<string | null> {
  return (await sitzung())?.benutzerId ?? null
}
