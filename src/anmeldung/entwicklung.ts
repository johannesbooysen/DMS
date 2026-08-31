/**
 * Anmeldung ohne Anbieter — ausschließlich für die Entwicklung.
 *
 * Ohne sie wäre die Anwendung erst benutzbar, wenn jemand mit Adminrechten
 * eine App-Registrierung in Entra angelegt hat. Und Tests bräuchten einen
 * echten Microsoft-Mandanten.
 *
 * **Der gefährliche Teil ist nicht diese Datei, sondern die Frage, wann sie
 * greift.** Die Antwort steht in `waehlen()`: zwei Bedingungen, die beide
 * erfüllt sein müssen, und ein harter Abbruch statt eines stillen Rückfalls.
 * Ein Entwicklungsanbieter, der im Betrieb versehentlich anspringt, ist kein
 * Fehler mit Fehlermeldung — er ist eine offene Tür.
 *
 * Der Weg selbst ist derselbe wie bei Entra: state, Rückkehr-URL, Sitzung,
 * Cookie. Nur der Umweg über Microsoft entfällt. Was in der Entwicklung
 * funktioniert, funktioniert deshalb aus denselben Gründen wie im Betrieb.
 */

import {
  AnmeldungAbgelehnt,
  type Anmeldebeginn,
  type Anmeldezustand,
  type Identitaet,
  type Identitaetsanbieter,
} from './anbieter'

export const ANBIETER_ENTWICKLUNG = 'entwicklung'

export class EntwicklungsAnbieter implements Identitaetsanbieter {
  readonly name = ANBIETER_ENTWICKLUNG

  async beginnen(_rueckkehrUrl: string, zurueckNach: string): Promise<Anmeldebeginn> {
    const state = crypto.randomUUID()
    return {
      ziel: `/anmeldung/auswahl?state=${encodeURIComponent(state)}`,
      // nonce und pkceVerifier bleiben leer: Es gibt kein Gegenüber, das sie
      // prüfen könnte. Das Feld bleibt trotzdem im Zustand, damit der Ablauf
      // in beiden Fällen derselbe ist.
      zustand: { state, nonce: '', pkceVerifier: '', zurueckNach },
    }
  }

  async abschliessen(
    antwortUrl: URL,
    zustand: Anmeldezustand,
    _rueckkehrUrl: string,
  ): Promise<Identitaet> {
    if (antwortUrl.searchParams.get('state') !== zustand.state) {
      throw new AnmeldungAbgelehnt('Die Anmeldung ist abgelaufen.', 'state_stimmt_nicht')
    }

    const email = antwortUrl.searchParams.get('benutzer')
    if (email === null || email === '') {
      throw new AnmeldungAbgelehnt('Kein Benutzer gewählt.', 'kein_benutzer_gewaehlt')
    }

    return {
      anbieter: this.name,
      externeKennung: `entwicklung:${email.toLowerCase()}`,
      email,
      name: email,
    }
  }
}
