/**
 * Stammdaten für eine Fixture anlegen.
 *
 * **Warum eine eigene Kennung.** Seit `20260903100000` ist das Schreiben an
 * Stammdaten ein eigenes Recht (`stammdaten_pflegen`). Vorher durfte jeder
 * Benutzer alles — Fixtures konnten deshalb als beliebige Rolle Objekte,
 * Konten und Zahlungswege anlegen, und mehrere taten das als Anna, einer
 * Objektbearbeiterin.
 *
 * Genau das war die Lücke. Die Tests laufen hier deshalb nicht mehr an ihr
 * vorbei, sondern unter jemandem, der das Recht wirklich hat: Eva trägt die
 * Geschäftsleitung. So bleibt die Fixture unter der RLS statt am
 * Tabelleneigentümer vorbei — sonst prüfte die Suite eine Datenbank, in der
 * die Regel gar nicht gilt.
 */
export const VERWALTER = '20000000-0000-0000-0000-000000000005'
