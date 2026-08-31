/**
 * Der Identitätsanbieter hinter einem Interface.
 *
 * Dieselbe Bauart wie beim KI-Anbieter (Konzept 22): Die Anwendung kennt nur
 * dieses Interface. Ob dahinter Entra ID steht, ein anderer OIDC-Anbieter
 * oder — in der Entwicklung — eine Attrappe, ändert nichts an der Fachlogik.
 *
 * Das ist keine Vorsorge um ihrer selbst willen. Das System soll eigenständig
 * **und** als Modul einer Verwaltungssoftware laufen (Konzept, Ziel). Im
 * zweiten Fall bringt die Wirtsanwendung die Anmeldung mit.
 */

/** Was der Anbieter über einen Menschen bestätigt hat. */
export interface Identitaet {
  /** Name des Anbieters, wie er in `benutzer.anbieter` steht. */
  anbieter: string
  /** Beim Anbieter stabile Kennung. Nicht die E-Mail. */
  externeKennung: string
  email: string
  name: string
}

/**
 * Was zwischen Hinweg und Rückweg aufbewahrt werden muss.
 *
 * Liegt in einem kurzlebigen, signierten Cookie — nicht in der Datenbank:
 * Es ist noch niemand angemeldet, dem man etwas zuordnen könnte, und ein
 * abgebrochener Anmeldeversuch soll keine Zeile hinterlassen.
 */
export interface Anmeldezustand {
  state: string
  nonce: string
  pkceVerifier: string
  /** Wohin nach erfolgreicher Anmeldung. Immer ein Pfad, nie eine URL. */
  zurueckNach: string
}

export interface Anmeldebeginn {
  /** Wohin der Browser geschickt wird. */
  ziel: string
  zustand: Anmeldezustand
}

export interface Identitaetsanbieter {
  readonly name: string

  /** Beginnt die Anmeldung und liefert das Ziel samt Zustand. */
  beginnen(rueckkehrUrl: string, zurueckNach: string): Promise<Anmeldebeginn>

  /**
   * Prüft die Antwort des Anbieters und liefert die bestätigte Identität.
   * Wirft `AnmeldungAbgelehnt`, wenn irgendetwas nicht stimmt.
   */
  abschliessen(
    antwortUrl: URL,
    zustand: Anmeldezustand,
    rueckkehrUrl: string,
  ): Promise<Identitaet>
}

/**
 * Die Anmeldung ist gescheitert.
 *
 * `hinweis` ist technisch und darf ins Protokoll — `nachricht` ist für den
 * Bildschirm. Beide enthalten **keine** personenbezogenen Daten: keine
 * E-Mail-Adressen, keine Namen, keine Tokenteile. Wer die Anmeldung nicht
 * schafft, soll nicht durch eine Fehlermeldung erfahren, wer sonst noch im
 * System steht.
 */
export class AnmeldungAbgelehnt extends Error {
  readonly hinweis: string

  constructor(nachricht: string, hinweis: string) {
    super(nachricht)
    this.name = 'AnmeldungAbgelehnt'
    this.hinweis = hinweis
  }
}
