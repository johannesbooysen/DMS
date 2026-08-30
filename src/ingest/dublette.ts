/**
 * Dublettenpruefung.
 *
 * Zwei Stufen (Konzept 13):
 *   1. Inhaltshash -- dieselbe Datei ein zweites Mal
 *   2. Kreditor + Rechnungsnummer + Betrag -- dasselbe Papier, neu gescannt
 *      oder als Mailanhang nachgereicht
 *
 * Beides ist ein harter Rot-Fall: Verkettung ueber dublette_von ja,
 * Workflow-Start nein (Konzept 14).
 */

import type { PoolClient } from 'pg'

export interface Dublettenbefund {
  istDublette: boolean
  stufe?: 'inhalt' | 'rechnungsmerkmale'
  originalId?: string
}

export async function dubletteSuchen(
  c: PoolClient,
  merkmale: {
    mandantId: string
    inhaltHash: string
    kreditorId?: string | null
    rechnungsnummer?: string | null
    brutto?: number | null
  },
): Promise<Dublettenbefund> {
  const perHash = await c.query<{ id: string }>(
    `select id from dokument
      where mandant_id = $1 and inhalt_hash = $2 and dublette_von is null
      order by eingang_am
      limit 1`,
    [merkmale.mandantId, merkmale.inhaltHash],
  )

  if (perHash.rows.length > 0) {
    return { istDublette: true, stufe: 'inhalt', originalId: perHash.rows[0].id }
  }

  // Zweite Stufe nur, wenn alle drei Merkmale vorliegen. Zwei von dreien
  // reichen nicht -- derselbe Kreditor mit demselben Betrag ist bei
  // wiederkehrenden Rechnungen der Normalfall, keine Dublette.
  if (
    merkmale.kreditorId == null ||
    merkmale.rechnungsnummer == null ||
    merkmale.brutto == null
  ) {
    return { istDublette: false }
  }

  const perMerkmale = await c.query<{ id: string }>(
    `select d.id
       from dokument d
       join rechnung_fakten f on f.dokument_id = d.id
      where d.mandant_id = $1
        and d.dublette_von is null
        and f.kreditor_id = $2
        and f.rechnungsnummer = $3
        and f.brutto = $4
      order by d.eingang_am
      limit 1`,
    [merkmale.mandantId, merkmale.kreditorId, merkmale.rechnungsnummer, merkmale.brutto],
  )

  if (perMerkmale.rows.length > 0) {
    return {
      istDublette: true,
      stufe: 'rechnungsmerkmale',
      originalId: perMerkmale.rows[0].id,
    }
  }

  return { istDublette: false }
}
