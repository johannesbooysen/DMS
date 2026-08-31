/**
 * Die harte Sperre vor der Zahlung.
 *
 * Konzept 8.2: „Vor der Bankübergabe prüft die Engine, dass jede Pflichtstufe
 * einen **gültigen** Stempel hat." Das Wort *gültig* trägt die ganze Prüfung.
 *
 * Ein gesetzter Stempel ist nicht dasselbe wie ein gültiger. Wird nach der
 * Freigabe der Betrag korrigiert oder der Beleg umgruppiert, gilt die
 * Freigabe einer anderen Rechnung. Deshalb hängt an jedem Freigabestempel der
 * Datenstand, unter dem er gegeben wurde (`freigabe_hash`), und deshalb läuft
 * `freigabenNachpruefen` **vor** der Sperre und nicht erst, wenn jemand sich
 * wundert.
 *
 * Die Prüfung selbst steht in SQL (`app.zahlung_moeglich`), nicht hier. Sie
 * ist die Sicherheitsgrenze und muss auch dann greifen, wenn jemand an dieser
 * Datei vorbeigeht.
 */

import type { PoolClient } from 'pg'

export interface Sperrergebnis {
  moeglich: boolean
  /** Das **erste** Hindernis, nicht alle. Siehe Kommentar an der Funktion. */
  hindernis: string | null
  /** Wie viele Stempel dabei verfallen sind. */
  verfallen: number
}

/**
 * Lässt verfallene Freigaben verfallen.
 *
 * Sichtbar: je betroffener Stufe ein Ereignis `verfallen`, die Aufgabe wird
 * wieder geöffnet, der Lauf springt zurück. Ein stiller Rücksprung wäre
 * schlimmer als gar keiner — niemand könnte erklären, warum der Beleg wieder
 * da ist.
 */
export async function freigabenNachpruefen(
  c: PoolClient,
  laufId: string,
): Promise<number> {
  const { rows } = await c.query<{ freigaben_nachpruefen: number }>(
    'select app.freigaben_nachpruefen($1)',
    [laufId],
  )
  return rows[0]?.freigaben_nachpruefen ?? 0
}

export async function zahlungMoeglich(
  c: PoolClient,
  dokumentId: string,
): Promise<Sperrergebnis> {
  const { rows: laeufe } = await c.query<{ id: string }>(
    'select id from dokument_lauf where dokument_id = $1',
    [dokumentId],
  )

  const verfallen =
    laeufe[0] === undefined ? 0 : await freigabenNachpruefen(c, laeufe[0].id)

  const { rows } = await c.query<{ moeglich: boolean; hindernis: string | null }>(
    'select * from app.zahlung_moeglich($1)',
    [dokumentId],
  )
  const ergebnis = rows[0]

  // Kein `?? Rückfalltext` auf `hindernis`: Bei einem zahlbaren Beleg ist es
  // null, und der Rückfall machte daraus eine Fehlermeldung — die Sperre
  // hätte dann immer einen Grund, auch wenn sie nicht greift.
  if (ergebnis === undefined) {
    return {
      moeglich: false,
      hindernis: 'Die Prüfung konnte nicht durchgeführt werden.',
      verfallen,
    }
  }

  return { moeglich: ergebnis.moeglich, hindernis: ergebnis.hindernis, verfallen }
}
