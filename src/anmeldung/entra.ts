/**
 * Anmeldung über Microsoft Entra ID (OpenID Connect).
 *
 * Entscheidung: [ADR 0004](../../docs/adr/0004-anmeldung.md). Kein Passwort im
 * DMS — Zurücksetzen, Sperren und Zwei-Faktor bleiben dort, wo sie ohnehin
 * schon verwaltet werden.
 *
 * Der Ablauf ist der Authorization Code Flow mit PKCE. Die drei Prüfungen,
 * die ihn tragen, macht `openid-client`, nicht dieser Code:
 *
 *   * **Signatur und Aussteller** des ID-Tokens gegen die JWKS des Mandanten,
 *   * **state** gegen Cross-Site Request Forgery,
 *   * **nonce** gegen das Wiedereinspielen eines fremden ID-Tokens.
 *
 * Handgeschrieben wäre das ein paar Dutzend Zeilen — und jede einzelne davon
 * eine Stelle, an der eine vergessene Prüfung niemandem auffällt, weil die
 * Anmeldung trotzdem funktioniert.
 */

import * as oidc from 'openid-client'
import {
  AnmeldungAbgelehnt,
  type Anmeldebeginn,
  type Anmeldezustand,
  type Identitaet,
  type Identitaetsanbieter,
} from './anbieter'

export const ANBIETER_ENTRA = 'entra'

export interface EntraEinstellungen {
  mandantId: string
  clientId: string
  clientSecret: string
}

export function entraEinstellungenAusUmgebung(): EntraEinstellungen | null {
  const mandantId = process.env['ENTRA_TENANT_ID']
  const clientId = process.env['ENTRA_CLIENT_ID']
  const clientSecret = process.env['ENTRA_CLIENT_SECRET']
  if (!mandantId || !clientId || !clientSecret) return null
  return { mandantId, clientId, clientSecret }
}

export class EntraAnbieter implements Identitaetsanbieter {
  readonly name = ANBIETER_ENTRA

  readonly #einstellungen: EntraEinstellungen
  #konfiguration: Promise<oidc.Configuration> | null = null

  constructor(einstellungen: EntraEinstellungen) {
    this.#einstellungen = einstellungen
  }

  /*
   * Das Discovery-Dokument wird einmal je Prozess geholt und behalten. Es
   * enthält auch den Verweis auf die JWKS; die Bibliothek erneuert die
   * Schlüssel selbst, wenn Microsoft sie wechselt. Ein Neuladen bei jeder
   * Anmeldung wäre ein zusätzlicher Netzaufruf im Anmeldeweg -- und ein
   * zusätzlicher Grund, warum die Anmeldung ausfällt.
   */
  #laden(): Promise<oidc.Configuration> {
    if (this.#konfiguration === null) {
      const { mandantId, clientId, clientSecret } = this.#einstellungen
      this.#konfiguration = oidc.discovery(
        new URL(`https://login.microsoftonline.com/${mandantId}/v2.0`),
        clientId,
        clientSecret,
      )
    }
    return this.#konfiguration
  }

  async beginnen(rueckkehrUrl: string, zurueckNach: string): Promise<Anmeldebeginn> {
    const konfiguration = await this.#laden()

    const pkceVerifier = oidc.randomPKCECodeVerifier()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()

    const ziel = oidc.buildAuthorizationUrl(konfiguration, {
      redirect_uri: rueckkehrUrl,
      // `openid` für den Ablauf selbst, `profile` für den Namen, `email` für
      // die Zuordnung zum angelegten Benutzer. Mehr wird nicht gebraucht --
      // und was nicht angefragt wird, kann auch nicht abfließen.
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(pkceVerifier),
      code_challenge_method: 'S256',
    })

    return { ziel: ziel.href, zustand: { state, nonce, pkceVerifier, zurueckNach } }
  }

  async abschliessen(
    antwortUrl: URL,
    zustand: Anmeldezustand,
    _rueckkehrUrl: string,
  ): Promise<Identitaet> {
    const konfiguration = await this.#laden()

    // Der Anbieter kann auch absagen -- abgebrochene Anmeldung, verweigerte
    // Zustimmung, gesperrtes Konto. Das ist kein Fehler des DMS.
    const fehler = antwortUrl.searchParams.get('error')
    if (fehler !== null) {
      throw new AnmeldungAbgelehnt(
        'Die Anmeldung wurde abgebrochen oder von Microsoft abgelehnt.',
        `anbieter_fehler:${fehler}`,
      )
    }

    let anspruch: oidc.IDToken | undefined
    try {
      const antwort = await oidc.authorizationCodeGrant(konfiguration, antwortUrl, {
        pkceCodeVerifier: zustand.pkceVerifier,
        expectedState: zustand.state,
        expectedNonce: zustand.nonce,
        idTokenExpected: true,
      })
      anspruch = antwort.claims()
    } catch {
      // Der ursprüngliche Fehler enthält unter Umständen Tokenteile. Er wird
      // deshalb nicht durchgereicht und nicht protokolliert.
      throw new AnmeldungAbgelehnt(
        'Die Antwort von Microsoft war nicht gültig. Bitte erneut anmelden.',
        'tokenpruefung_fehlgeschlagen',
      )
    }

    if (anspruch === undefined) {
      throw new AnmeldungAbgelehnt(
        'Microsoft hat keine Identität zurückgegeben.',
        'kein_id_token',
      )
    }

    // `oid` statt `sub`: `sub` ist bei Entra anwendungsbezogen und wechselt
    // mit der App-Registrierung -- dann wären alle Benutzer unbekannt.
    const kennung = typeof anspruch['oid'] === 'string' ? anspruch['oid'] : null
    if (kennung === null) {
      throw new AnmeldungAbgelehnt(
        'Microsoft hat keine stabile Benutzerkennung mitgeschickt.',
        'oid_fehlt',
      )
    }

    // Bei Gastkonten fehlt `email` gelegentlich; dann trägt `preferred_username`
    // die Adresse. Ohne beides lässt sich der Benutzer nicht zuordnen.
    const email =
      (typeof anspruch['email'] === 'string' ? anspruch['email'] : null) ??
      (typeof anspruch['preferred_username'] === 'string'
        ? anspruch['preferred_username']
        : null)
    if (email === null) {
      throw new AnmeldungAbgelehnt(
        'Microsoft hat keine E-Mail-Adresse mitgeschickt. Ohne sie lässt sich ' +
          'der Zugang nicht zuordnen.',
        'email_fehlt',
      )
    }

    const name = typeof anspruch['name'] === 'string' ? anspruch['name'] : email

    return { anbieter: this.name, externeKennung: kennung, email, name }
  }
}
