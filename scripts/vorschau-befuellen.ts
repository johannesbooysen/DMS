/**
 * Gibt der Vorschau echte Belege.
 *
 *   npm run vorschau:befuellen
 *
 * WARUM ES DAS BRAUCHT
 *
 * Der Seed ist reine Datenbank: Belege, Laeufe, Aufgaben -- aber keine
 * einzige Datei. Fuer die Regeltests unter `tests/` ist das richtig, dort
 * geht es um Zeilen. Im Browser faellt es sofort auf: Der Viewer zeigt ein
 * kaputtes Bild, der PDF-Download antwortet mit 404. Wer die Oberflaeche
 * ansehen will, sieht dann nicht die Anwendung, sondern eine Luecke in den
 * Testdaten -- und haelt das eine fuer das andere.
 *
 * Dieses Skript fuehrt dieselbe Vorbereitung aus, die vor jedem E2E-Lauf
 * laeuft, nur in die Ablage der Vorschau (`.ablage`). Es baut echte PDFs und
 * schickt sie durch die **gewoehnliche** Aufbereitung -- dieselbe, die der
 * Worker fährt. Seitentext, Vorschaubilder und die freien Stempelplaetze
 * entstehen so, wie sie im Betrieb entstehen; nichts wird abgekuerzt.
 *
 * **Ein Beleg bleibt bewusst ohne Datei.** Auch das gibt es im Betrieb -- ein
 * Beleg aus einer Altuebernahme --, und die Oberflaeche soll das aushalten.
 */

import { belegeAnlegen } from '../e2e/belege-anlegen'
import { poolSchliessen } from '../src/db'

const WURZEL = process.env['DMS_ABLAGE'] ?? '.ablage'

async function main(): Promise<void> {
  console.log(`Belege aufbereiten nach ${WURZEL} …`)
  await belegeAnlegen(WURZEL)
  console.log('Fertig. Die Vorschau zeigt jetzt echte Seiten.')
  console.log('Ein Beleg bleibt absichtlich ohne Datei -- das ist kein Fehler.')
}

main()
  .catch((fehler: unknown) => {
    console.error('Befuellen fehlgeschlagen:', fehler instanceof Error ? fehler.message : fehler)
    process.exitCode = 1
  })
  .finally(poolSchliessen)
