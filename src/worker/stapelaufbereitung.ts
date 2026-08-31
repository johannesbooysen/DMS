/**
 * Einen Stapel aufbereiten: Seiten lesen, rendern, Trennung vorschlagen.
 *
 * **Im Worker und nicht im Request** — aus zwei Gründen, und der zweite ist
 * der, den ich beim Bedienen gefunden habe:
 *
 *   1. Ein Stapel hat dreißig Seiten. Sie zu lesen und zu rendern dauert zu
 *      lange für einen Request. Das Konzept sagt es allgemein: „Alles ab
 *      Rohablage läuft asynchron in einer Queue."
 *   2. `pdfjs` lädt seine Schriftmetriken über eine `file://`-URL aus
 *      `node_modules`. Sobald das Modul in eine Server Component gerät,
 *      versucht der Bundler, diesen Pfad aufzulösen, und die Seite bricht
 *      beim Bauen ab. Der Fehler war ein Hinweis auf den ersten Grund.
 *
 * Deshalb hat `stapel` den Status `aufbereitung`: Zwischen Hochladen und
 * Korrekturoberfläche liegt Arbeit, und sie ist sichtbar.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'
import { seitenLesen, seiteRendern } from '../ingest/pdf'
import { trennungVorschlagen } from '../stapel/trennung'
import { BREITE_MINIATUR } from './aufbereitung'

export interface Stapelergebnis {
  seiten: number
  belege: number
}

export async function stapelAufbereiten(
  c: PoolClient,
  ablage: Ablage,
  stapelId: string,
): Promise<Stapelergebnis> {
  const { rows } = await c.query<{ storage_key: string; status: string }>(
    'select storage_key, status from stapel where id = $1',
    [stapelId],
  )
  const stapel = rows[0]
  if (stapel === undefined || stapel.status !== 'aufbereitung') {
    // Kein Fehler: Der Stapel kann verworfen worden sein, oder ein zweiter
    // Auftrag hat ihn schon aufbereitet. Beides ist kein Grund für einen
    // Wiederholungslauf.
    return { seiten: 0, belege: 0 }
  }

  const inhalt = await ablage.lesen(stapel.storage_key)
  const seiten = await seitenLesen(inhalt)

  if (seiten.length === 0) {
    await c.query(
      `update stapel set status = 'verworfen',
                         fehler = 'Die Datei enthaelt keine lesbaren Seiten.'
        where id = $1`,
      [stapelId],
    )
    return { seiten: 0, belege: 0 }
  }

  const befunde = trennungVorschlagen(seiten.map((s) => ({ seite: s.seite, text: s.text })))

  for (const s of seiten) {
    const befund = befunde.find((b) => b.seite === s.seite)
    await c.query(
      `insert into stapel_seite (stapel_id, seite, text, breite, hoehe, trenner)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (stapel_id, seite) do update
          set text = excluded.text, trenner = excluded.trenner`,
      [stapelId, s.seite, s.text, s.breite, s.hoehe, befund?.trenner ?? false],
    )
  }

  const { rows: gruppen } = await c.query<{ stapel_gruppieren: number }>(
    'select app.stapel_gruppieren($1)',
    [stapelId],
  )

  // Miniaturen für die Korrekturoberfläche. Sie zeigt zwanzig Seiten
  // nebeneinander -- in Lesegröße wäre das ein Vielfaches an Daten für eine
  // Ansicht, in der niemand liest, sondern nur erkennt.
  for (const s of seiten) {
    const bild = await seiteRendern(inhalt, s.seite, BREITE_MINIATUR)
    await ablage.schreiben(`stapel/${stapelId}/seite-${s.seite}.webp`, bild)
  }

  await c.query(
    `update stapel set status = 'pruefung', seitenzahl = $2 where id = $1`,
    [stapelId, seiten.length],
  )

  return { seiten: seiten.length, belege: gruppen[0]?.stapel_gruppieren ?? 0 }
}
