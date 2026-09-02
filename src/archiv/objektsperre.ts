/**
 * Objektsperre — was der Speicher selbst schützt.
 *
 * Die zweite Säule der Revisionssicherheit (Konzept 19). Die Hash-Kette
 * *erkennt* eine Änderung; S3 Object Lock im Compliance-Modus sorgt dafür,
 * dass das Original dabei nicht verlorengeht.
 *
 * **Ein Durchgang, keine Warteschlange.** Derselbe Grund wie beim
 * Ausgangsbuch: Der Archiveintrag entsteht in der Transaktion des
 * Archivierens. Ein zusätzlicher Auftrag wäre ein zweites Fehlerfenster für
 * dieselbe Sache — und schlimmer, ein Auftrag aus einer zurückgerollten
 * Transaktion würde eine Datei sperren, die gar nicht archiviert ist. Im
 * Compliance-Modus wäre das ein Fehler, den niemand mehr behebt.
 *
 * Der Archiveintrag **ist** die Warteschlange: leere Spalte heißt offen.
 * Damit ist der Wiederholversuch beiläufig richtig, und was vor der
 * Einrichtung des Speichers archiviert wurde, holt derselbe Durchgang nach.
 *
 * **Die Reihenfolge ist die eigentliche Regel:** sperren, dann vermerken.
 * Andersherum entstünde bei einem Abbruch dazwischen ein Eintrag über einen
 * Schutz, den es nicht gibt — und das ist schlimmer als gar keiner.
 */

import type { Ablage } from '../ablage'
import { kannSperren } from '../ablage-s3'
import { alsAnmeldung } from '../db'

export interface Sperrbilanz {
  gesperrt: number
  gescheitert: number
}

/**
 * Ab wann eine Datei nicht mehr angerührt werden darf.
 *
 * Die Frist rechnet ab Jahresende (§147 AO) und steht als `date` in der
 * Datenbank — hier wird daraus ein Zeitpunkt. Bewusst **Ende** des Tages in
 * UTC und nicht dessen Beginn: Eine Sperre bis zum 31.12. um 00:00 Uhr gäbe
 * die Datei am letzten Tag der Frist frei, und den letzten Tag schuldet man
 * genauso wie den ersten. Verlängern geht später, verkürzen nie.
 */
function sperrzeitpunkt(bis: string): Date {
  return new Date(`${bis}T23:59:59.999Z`)
}

/**
 * Setzt die offenen Sperren.
 *
 * Ohne sperrfähige Ablage geschieht nichts, und zwar geräuschlos: In der
 * Entwicklung läuft ein Verzeichnis, und ein Fehler je Durchgang wäre nur
 * Lärm. Dass der Schutz fehlt, steht an einer ehrlicheren Stelle — die
 * Spalte bleibt leer, und der Beleg sagt beim Archivstand nichts anderes.
 */
export async function objektsperrenSetzen(
  ablage: Ablage,
  grenze = 200,
): Promise<Sperrbilanz> {
  if (!kannSperren(ablage)) return { gesperrt: 0, gescheitert: 0 }

  const offen = await alsAnmeldung(async (c) => {
    const { rows } = await c.query<{
      dokument_id: string
      storage_key: string
      bis: string
    }>(
      // to_char und nicht als `date`: pg macht daraus ein Date-Objekt in der
      // Zeitzone des Servers, und aus dem 31.12. wird der 30.12. Bei einer
      // Sperre, die sich nicht verkuerzen laesst, waere das ein Tag zu
      // frueh -- und niemand koennte es richtigstellen (Projektregel).
      `select dokument_id, storage_key,
              to_char(aufbewahrung_bis, 'YYYY-MM-DD') as bis
         from app.objektsperre_offen($1)`,
      [grenze],
    )
    return rows
  })

  let gesperrt = 0
  let gescheitert = 0

  for (const eintrag of offen) {
    try {
      /*
       * Erst der Speicher, dann die Datenbank.
       *
       * Bricht es dazwischen ab, steht die Datei gesperrt, aber unvermerkt --
       * der naechste Durchgang holt sie sich wieder und setzt dieselbe Sperre
       * erneut. Das ist unschaedlich: Dasselbe Datum noch einmal zu setzen
       * ist keine Verkuerzung, und S3 nimmt es an.
       *
       * Andersherum waere es nicht zu heilen: ein Vermerk ueber einen Schutz,
       * der nie gesetzt wurde, und niemand faende ihn je wieder -- die Spalte
       * ist ja gefuellt.
       */
      const fassung = await ablage.sperren(
        eintrag.storage_key,
        sperrzeitpunkt(eintrag.bis),
      )

      await alsAnmeldung((c) =>
        c.query('select app.objektsperre_vermerken($1, $2::date, $3)', [
          eintrag.dokument_id,
          eintrag.bis,
          fassung,
        ]),
      )
      gesperrt += 1
    } catch {
      /*
       * Keine Kennung und kein Schluessel ins Log -- der Ablageschluessel
       * traegt Mandant und Objekt (Projektregel). Der Eintrag bleibt offen
       * und wird beim naechsten Durchgang wieder aufgegriffen; ein
       * dauerhaftes Scheitern faellt an der Zahl auf, nicht am Einzelfall.
       */
      gescheitert += 1
    }
  }

  return { gesperrt, gescheitert }
}

/**
 * Die Fassung, in der ein Beleg archiviert wurde — oder `null`.
 *
 * Beim Lesen des Originals mitzugeben. Ohne sie liefert der Speicher die
 * *aktuelle* Fassung, und die muss nicht die archivierte sein: Object Lock
 * verhindert das Überschreiben nicht, es bewahrt nur die alte Fassung
 * daneben auf. Wer hier `null` durchreicht, bekommt im Normalfall dasselbe —
 * und im einzigen Fall, auf den es ankommt, das Falsche.
 */
export async function archivfassung(
  c: { query: (t: string, w: unknown[]) => Promise<{ rows: Array<{ f: string | null }> }> },
  dokumentId: string,
): Promise<string | null> {
  const { rows } = await c.query(
    'select storage_fassung as f from archiv_eintrag where dokument_id = $1',
    [dokumentId],
  )
  return rows[0]?.f ?? null
}
