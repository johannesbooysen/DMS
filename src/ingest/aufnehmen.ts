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

/**
 * Sucht die gueltige Prozessdefinition fuer Belegart und Ordnungsgruppe.
 * Eine gruppenspezifische Fassung schlaegt die allgemeine; ohne aktive
 * Definition wird kein Lauf gestartet, das Dokument bleibt liegen.
 */
async function prozessdefinitionFinden(
  c: PoolClient,
  mandantId: string,
  belegart: string,
  ordnungsgruppeId: string | null,
): Promise<{ id: string; version: number; ersteStufe: string | null } | null> {
  const { rows } = await c.query<{ id: string; version: number; erste_stufe: string | null }>(
    `select p.id, p.version,
            (select s.id from prozessstufe s
              where s.definition_id = p.id
              order by s.reihenfolge
              limit 1) as erste_stufe
       from prozessdefinition p
      where p.mandant_id = $1
        and p.belegart = $2
        and p.status = 'aktiv'
        and (p.ordnungsgruppe_id = $3 or p.ordnungsgruppe_id is null)
      order by p.ordnungsgruppe_id nulls last, p.version desc
      limit 1`,
    [mandantId, belegart, ordnungsgruppeId],
  )

  if (rows.length === 0) return null
  return { id: rows[0].id, version: rows[0].version, ersteStufe: rows[0].erste_stufe }
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

  const definition = await prozessdefinitionFinden(
    c,
    eingang.mandantId,
    eingang.belegart,
    null,
  )

  if (definition === null) {
    return { dokumentId, hash, dublette, laufGestartet: false }
  }

  await c.query(
    `insert into dokument_lauf (dokument_id, definition_id, definition_version,
                                aktuelle_stufe_id)
     values ($1, $2, $3, $4)`,
    [dokumentId, definition.id, definition.version, definition.ersteStufe],
  )

  return { dokumentId, hash, dublette, laufGestartet: true }
}
