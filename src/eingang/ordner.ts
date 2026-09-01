/**
 * Überwachter Ordner.
 *
 * In der Praxis der häufigste selbsttätige Weg herein: Der Scanner legt dort
 * ab, oder ein FTP-Server, oder jemand kopiert einen Stapel Dateien hinein.
 *
 * Drei Dinge, die beim Bauen nicht offensichtlich sind und dreimal
 * schiefgehen würden:
 *
 *   1. **Eine Datei, die noch geschrieben wird, ist keine Datei.** Ein
 *      Scanner öffnet sie und füllt sie über Sekunden. Wer sofort liest,
 *      bekommt ein halbes PDF — das die Aufbereitung dann korrekt als kaputt
 *      meldet, für einen Beleg, der in Ordnung war. Deshalb die Ruhefrist.
 *   2. **Verschoben wird nach dem Aufnehmen, nie davor.** Andersherum ist die
 *      Datei weg, wenn die Aufnahme scheitert.
 *   3. **Die Herkunft muss stabil sein.** Pfad allein genügt nicht: Kommt am
 *      nächsten Tag wieder eine `scan.pdf`, ist das ein neuer Beleg. Pfad
 *      *und* Änderungszeit *und* Größe zusammen unterscheiden die beiden.
 */

import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  pflichtfeld,
  zahlenfeld,
  type Eingangsquelle,
  type Fundstueck,
  type Quelleneinstellungen,
} from './quelle'

/**
 * Wie lange eine Datei unverändert liegen muss, bevor sie als fertig gilt.
 *
 * Zehn Sekunden sind großzügig für einen lokalen Scanner und knapp für eine
 * langsame Netzfreigabe. Einstellbar je Quelle.
 */
const RUHEFRIST_S = 10

/** Was überhaupt in Frage kommt. Alles andere bleibt liegen. */
const ENDUNGEN: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.eml': 'message/rfc822',
}

export const ordnerQuelle: Eingangsquelle = {
  art: 'ordner',

  async holen(einstellungen, bereitsGeholt): Promise<Fundstueck[]> {
    const pfad = pflichtfeld(einstellungen, 'pfad')
    const ruhefrist = zahlenfeld(einstellungen, 'ruhefrist_sekunden', RUHEFRIST_S)
    const hoechstzahl = zahlenfeld(einstellungen, 'hoechstzahl', 50)

    const eintraege = await readdir(pfad, { withFileTypes: true }).catch(
      (fehler: NodeJS.ErrnoException) => {
        // Ein fehlendes Verzeichnis ist eine Einstellungsfrage, kein
        // Betriebsfehler -- die Meldung soll das sagen.
        if (fehler.code === 'ENOENT') {
          throw new Error(`Der Ordner „${pfad}" gibt es nicht.`)
        }
        throw fehler
      },
    )

    const gefunden: Fundstueck[] = []
    const jetzt = Date.now()

    for (const eintrag of eintraege) {
      if (gefunden.length >= hoechstzahl) break
      if (!eintrag.isFile()) continue

      const mime = ENDUNGEN[extname(eintrag.name).toLowerCase()]
      if (mime === undefined) continue

      const voll = join(pfad, eintrag.name)
      const angaben = await stat(voll).catch(() => null)
      // Zwischen readdir und stat kann die Datei verschwunden sein. Das ist
      // kein Fehler -- jemand hat sie weggeraeumt.
      if (angaben === null) continue

      // Ruhefrist: Wer jetzt liest, liest womoeglich ein halbes PDF.
      if (jetzt - angaben.mtimeMs < ruhefrist * 1000) continue

      const herkunft = `${eintrag.name}:${Math.round(angaben.mtimeMs)}:${angaben.size}`
      if (await bereitsGeholt(herkunft)) continue

      gefunden.push({
        herkunft,
        dateiname: eintrag.name,
        mime,
        inhalt: await readFile(voll),
      })
    }

    return gefunden
  },

  /**
   * Erledigte Dateien beiseiteräumen.
   *
   * Ohne `erledigt_pfad` bleibt die Datei liegen — dann trägt allein die
   * Merkliste, dass sie nicht noch einmal geholt wird. Das ist die
   * vorsichtige Vorgabe: Ein Programm, das ungefragt in fremden Ordnern
   * verschiebt, macht mehr kaputt als es hilft.
   */
  async erledigen(einstellungen: Quelleneinstellungen, stueck: Fundstueck): Promise<void> {
    const ziel = einstellungen['erledigt_pfad']
    if (typeof ziel !== 'string' || ziel.trim() === '') return

    const pfad = pflichtfeld(einstellungen, 'pfad')
    await mkdir(ziel, { recursive: true })

    // Zeitstempel im Namen, damit zwei gleichnamige Dateien nebeneinander
    // liegen koennen. Ein Ueberschreiben waere hier ein Datenverlust.
    const endung = extname(stueck.dateiname)
    const stamm = basename(stueck.dateiname, endung)
    const marke = String(Date.now())
    await rename(join(pfad, stueck.dateiname), join(ziel, `${stamm}-${marke}${endung}`))
  },
}
