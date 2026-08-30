/**
 * Eingang: eine Datei wird zum Dokument.
 *
 * Ablauf nach Konzept 13, erster Abschnitt:
 *   Rohablage + inhalt_hash -> Dublettenpruefung -> Dokument anlegen
 *   -> Aufbereitung einreihen
 *
 * Was hier NICHT passiert: OCR, Extraktion, Rendern. Alles ab Rohablage
 * laeuft asynchron in der Queue, damit der Eingang nicht am Provider haengt.
 */

import type { PoolClient } from 'pg'
import { inhaltHash, type Ablage } from '../ablage.js'
import { laufStarten } from '../workflow/engine.js'
import { dubletteSuchen, type Dublettenbefund } from './dublette.js'

export type Eingangskanal = 'mail' | 'scan' | 'upload' | 'ftp'

export interface Eingang {
  mandantId: string
  objektId?: string | null
  belegart: string
  eingangskanal: Eingangskanal
  dateiname: string
  mime: string
  inhalt: Buffer
}

export interface Aufnahmeergebnis {
  dokumentId: string
  hash: string
  dublette: Dublettenbefund
  laufGestartet: boolean
}

export async function dokumentAufnehmen(
  c: PoolClient,
  ablage: Ablage,
  eingang: Eingang,
  erfasstVon: string,
): Promise<Aufnahmeergebnis> {
  const hash = inhaltHash(eingang.inhalt)

  // Zum Zeitpunkt des Eingangs sind Kreditor und Rechnungsnummer noch nicht
  // bekannt -- die Extraktion laeuft erst in der Queue. Die zweite Stufe der
  // Dublettenpruefung greift deshalb spaeter noch einmal.
  const dublette = await dubletteSuchen(c, { mandantId: eingang.mandantId, inhaltHash: hash })

  const jahr = new Date().getUTCFullYear()
  const praefix = `${eingang.mandantId}/${eingang.objektId ?? 'ohne-objekt'}/${jahr}/${hash.slice(0, 16)}`

  const { rows } = await c.query<{ id: string }>(
    `insert into dokument (mandant_id, objekt_id, belegart, eingangskanal,
                           inhalt_hash, storage_praefix, erfasst_von,
                           dublette_von, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      eingang.mandantId,
      eingang.objektId ?? null,
      eingang.belegart,
      eingang.eingangskanal,
      hash,
      praefix,
      erfasstVon,
      dublette.originalId ?? null,
      dublette.istDublette ? 'abgelehnt' : 'in_aufbereitung',
    ],
  )
  const dokumentId = rows[0].id

  const schluessel = `${praefix}/original`
  await ablage.schreiben(schluessel, eingang.inhalt)

  await c.query(
    `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse, hash)
     values ($1, 'original', $2, $3, $4, $5)`,
    [dokumentId, schluessel, eingang.mime, eingang.inhalt.byteLength, hash],
  )

  if (dublette.istDublette) {
    // Harter Rot-Fall: verketten, aber keinen Lauf starten.
    await c.query(
      `insert into dokument_beziehung (von_dokument, zu_dokument, art)
       values ($1, $2, 'dublette_von')`,
      [dokumentId, dublette.originalId],
    )
    await c.query(
      `update dokument set ampel_plausibilitaet = 'rot', ampel_gesamt = 'rot'
        where id = $1`,
      [dokumentId],
    )
    return { dokumentId, hash, dublette, laufGestartet: false }
  }

  // Den Lauf startet die Engine, nicht der Ingest: sie kennt den Blockbaum,
  // legt die Aufgaben an und loest die Zustaendigkeit auf. Ein zweiter Weg
  // hier wuerde frueher oder spaeter vom ersten abweichen.
  const lauf = await laufStarten(c, dokumentId)

  return { dokumentId, hash, dublette, laufGestartet: lauf !== null }
}
