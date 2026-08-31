/**
 * Welcher Identitätsanbieter gilt?
 *
 * Die ganze Sicherheit dieser Entscheidung hängt daran, dass sie **nicht**
 * still ausfällt. Deshalb: kein Rückfall auf die Entwicklungsanmeldung, wenn
 * Entra nicht eingerichtet ist. Fehlt die Einrichtung, bricht der Start ab
 * und sagt, was fehlt.
 */

import type { Identitaetsanbieter } from './anbieter'
import { ANBIETER_ENTRA, EntraAnbieter, entraEinstellungenAusUmgebung } from './entra'
import { ANBIETER_ENTWICKLUNG, EntwicklungsAnbieter } from './entwicklung'

export * from './anbieter'
export { ANBIETER_ENTRA } from './entra'
export { ANBIETER_ENTWICKLUNG } from './entwicklung'

let gewaehlt: Identitaetsanbieter | undefined

/**
 * Die Entwicklungsanmeldung braucht **beide** Bedingungen.
 *
 * `DMS_ANMELDUNG=entwicklung` allein genügt nicht: Eine Umgebungsvariable
 * wandert beim Kopieren einer Konfiguration mit, und dann steht sie
 * irgendwann auf dem Server. `NODE_ENV=production` allein genügt auch nicht,
 * weil ein Produktivbetrieb vergessen kann, es zu setzen. Zusammen decken
 * sie beide Versehen ab.
 */
function entwicklungErlaubt(): boolean {
  return (
    process.env['DMS_ANMELDUNG'] === 'entwicklung' &&
    process.env.NODE_ENV !== 'production'
  )
}

export function anbieter(): Identitaetsanbieter {
  if (gewaehlt !== undefined) return gewaehlt

  const entra = entraEinstellungenAusUmgebung()
  if (entra !== null) {
    gewaehlt = new EntraAnbieter(entra)
    return gewaehlt
  }

  if (entwicklungErlaubt()) {
    gewaehlt = new EntwicklungsAnbieter()
    return gewaehlt
  }

  throw new Error(
    'Keine Anmeldung eingerichtet. Für den Betrieb ENTRA_TENANT_ID, ' +
      'ENTRA_CLIENT_ID und ENTRA_CLIENT_SECRET setzen (siehe ' +
      'docs/handbuch.md, Abschnitt Anmeldung). Für die Entwicklung ' +
      'DMS_ANMELDUNG=entwicklung — das wirkt nur, solange NODE_ENV nicht ' +
      'auf production steht.',
  )
}

/** Für Tests: die getroffene Wahl vergessen. */
export function anbieterZuruecksetzen(): void {
  gewaehlt = undefined
}

export function anbietername(): string {
  const entra = entraEinstellungenAusUmgebung()
  return entra !== null ? ANBIETER_ENTRA : ANBIETER_ENTWICKLUNG
}
