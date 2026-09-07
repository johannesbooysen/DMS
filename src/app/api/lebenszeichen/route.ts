/**
 * Lebenszeichen der Betriebsumgebung (ADR 0007).
 *
 * **Ohne Anmeldung**, weil die Container-Prüfung keine Sitzung hat — und weil
 * hier nichts steht, was eine verlangen würde: ein Dienstname, ein Alter in
 * Sekunden, eine Programmfassung. Keine Mandanten, keine Belege, keine
 * Personen. Nach draußen gehört der Pfad trotzdem nicht; der Reverse Proxy
 * blockt ihn (siehe `Caddyfile`), geprüft wird im internen Netz.
 *
 * **Der Umfang ist wählbar, und das ist der Kern.**
 *
 *   * `/api/lebenszeichen` — Anwendung, Datenbank **und** Worker. Das ist die
 *     Frage „läuft das System", und sie gehört an eine Überwachung und an
 *     einen Menschen.
 *   * `/api/lebenszeichen?dienste=` — nur Anwendung und Datenbank. Das ist
 *     die Frage „soll dieser Container neu gestartet werden".
 *
 * Ohne diese Trennung hinge die Gesundheit des Webcontainers am Worker: Ein
 * toter Worker ließe Docker die Anwendung neu starten — den einen Prozess,
 * der nichts dafür kann und dessen Neustart nichts daran ändert. Der Worker
 * prüft sich über `npm run betrieb:pruefen` selbst.
 *
 * **503 statt 200 mit Befund im Text.** Docker, Caddy und jede Überwachung
 * lesen den Status, nicht die Antwort.
 */

import { WORKER, gesundheit } from '@/betrieb'

export const dynamic = 'force-dynamic'

export async function GET(anfrage: Request): Promise<Response> {
  const angefragt = new URL(anfrage.url).searchParams.get('dienste')

  /*
   * Fehlt der Parameter ganz, gilt die vollständige Frage. Steht er leer da
   * (`?dienste=`), ist das die ausdrückliche Aussage „nur die Anwendung" --
   * nicht dasselbe wie „nicht angegeben", und der Unterschied ist hier der
   * ganze Zweck.
   */
  const erwartet =
    angefragt === null
      ? [WORKER]
      : angefragt.split(',').map((n) => n.trim()).filter((n) => n !== '')

  const befund = await gesundheit(erwartet)
  return Response.json(befund, {
    status: befund.gesund ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
