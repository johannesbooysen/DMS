/**
 * Wer ist angemeldet?
 *
 * ACHTUNG: Es gibt noch keine Anmeldung. Bis Supabase Auth angebunden ist,
 * liefert diese Datei einen fest eingestellten Benutzer aus der Umgebung.
 *
 * Das ist ausdrücklich KEINE Authentifizierung und darf so nicht in Betrieb
 * gehen. Was es aber schon jetzt richtig macht: Der Benutzer wird an die
 * Datenbank durchgereicht und die Abfragen laufen unter `dms_app`. Die
 * RLS-Policies greifen also von Anfang an — wenn die Anmeldung kommt, ändert
 * sich nur, woher die Kennung stammt, nicht wie sie wirkt.
 */

export class KeineSitzung extends Error {
  constructor() {
    super(
      'Kein Benutzer eingestellt. Für die Entwicklung DMS_BENUTZER auf eine ' +
        'Benutzerkennung aus dem Seed setzen.',
    )
    this.name = 'KeineSitzung'
  }
}

export function angemeldeterBenutzer(): string {
  const benutzer = process.env['DMS_BENUTZER']
  if (benutzer === undefined || benutzer === '') throw new KeineSitzung()
  return benutzer
}
