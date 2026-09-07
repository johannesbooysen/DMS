/**
 * Prueft, ob die Hintergrunddienste noch eintragen (ADR 0007).
 *
 * Gedacht als Container-Pruefung des Workers und als Handgriff auf der
 * Kommandozeile:
 *
 *   npm run betrieb:pruefen            # erwartet den Worker
 *   npm run betrieb:pruefen -- worker  # dasselbe, ausdruecklich
 *
 * **Rueckgabewert 1, wenn etwas verstummt ist.** Ein Skript, das den Befund
 * nur auf die Ausgabe schreibt und trotzdem 0 zurueckgibt, wird von Docker,
 * cron und jeder Ueberwachung als "in Ordnung" gelesen -- die Ausgabe liest
 * dort niemand.
 */

import { poolSchliessen } from '../src/db'
import { FRIST_S, WORKER, gesundheit } from '../src/betrieb'

async function main(): Promise<void> {
  const erwartet = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const befund = await gesundheit(erwartet.length > 0 ? erwartet : [WORKER])

  if (!befund.datenbank) {
    console.error('Die Datenbank ist nicht erreichbar.')
    process.exitCode = 1
    return
  }

  for (const d of befund.dienste) {
    const fassung = d.fassung === null ? '' : ` (${d.fassung})`
    console.log(
      `${d.frisch ? 'laeuft   ' : 'verstummt'} ${d.dienst}${fassung}`,
      `-- letztes Lebenszeichen vor ${d.alterS} s`,
    )
  }

  /*
   * **Nichts vorgefunden ist nicht nichts.** Ein Dienst, der noch nie
   * eingetragen hat, fehlt in der Liste oben -- ohne diese Zeilen waere die
   * Ausgabe dann leer und der Rueckgabewert 0, also Entwarnung fuer einen
   * Dienst, der nie gelaufen ist. Dieselbe Regel wie bei `sicherung:pruefen`.
   */
  for (const name of befund.verstummt) {
    console.error(`KEIN frisches Lebenszeichen von "${name}" (Frist ${FRIST_S} s).`)
  }

  if (!befund.gesund) process.exitCode = 1
}

main()
  .catch((fehler: unknown) => {
    // Keine Verbindungszeichenfolge in die Ausgabe -- sie traegt Kennung und
    // Rechnername (Projektregel).
    console.error('Pruefung fehlgeschlagen:', fehler instanceof Error ? fehler.message : fehler)
    process.exitCode = 1
  })
  .finally(poolSchliessen)
