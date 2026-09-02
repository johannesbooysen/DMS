/**
 * Belege ausgeben — mit den Layern, die zur Variante gehören.
 *
 * Konzept 16 nennt vier Varianten. Bis hierher gab es genau eine: das
 * Original. Wer einen Beleg aus dem Haus gab — an den Beirat, den
 * Steuerberater, den Nachfolgeverwalter —, gab ein Blatt ohne einen einzigen
 * Stempel heraus. Die Freigaben standen im Protokoll, nicht auf dem Beleg.
 *
 * Die Regeln stehen in `varianten.ts`, das Zeichnen in `pdf.ts`. Hier wird
 * nur zusammengetragen: welche Layer, welches Original, welche Seitenbilder.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '@/ablage'
import { alsBenutzer } from '@/db'
import { aufOriginal, ausSeitenbildern, type Exportlayer, type Seitenbild } from './pdf'
import {
  brauchtSeitenbilder,
  gehoertHinein,
  VARIANTEN,
  type Exportvariante,
} from './varianten'

export * from './varianten'
export type { Exportlayer, Seitenbild } from './pdf'

export class ExportAbgelehnt extends Error {}

export interface Exportwunsch {
  dokumentId: string
  variante: Exportvariante
  /** Nur für `extern`: Wer bekommt ihn? Steht im Wasserzeichen. */
  empfaenger?: string | null
}

/**
 * Baut das PDF — unter den Rechten des Aufrufers.
 *
 * Kein `security definer` und keine Abkürzung: Wer den Beleg nicht sehen
 * darf, bekommt auch keinen Export. Die RLS ist die Grenze, hier wie überall.
 */
export async function belegExportieren(
  benutzerId: string,
  ablage: Ablage,
  wunsch: Exportwunsch,
): Promise<{ pdf: Buffer; dateiname: string }> {
  return alsBenutzer(benutzerId, (c) => belegExportierenMit(c, ablage, wunsch))
}

/**
 * Wie oben, aber auf einer laufenden Verbindung.
 *
 * Die Objektakte baut Hunderte Belege in **einer** Transaktion; jeder Export
 * mit eigener Verbindung waere ein Verbindungsaufbau je Beleg -- und der
 * Bestand koennte sich zwischendurch aendern, sodass Akte und Manifest
 * verschiedene Staende beschrieben.
 */
export async function belegExportierenMit(
  c: PoolClient,
  ablage: Ablage,
  wunsch: Exportwunsch,
): Promise<{ pdf: Buffer; dateiname: string }> {
  {
    /*
     * Zwei verschiedene Lagen, zwei verschiedene Meldungen.
     *
     * „Nicht erreichbar" heißt: Die RLS zeigt den Beleg nicht — daran ändert
     * kein Handgriff etwas. „Keine Datei" heißt: Der Beleg ist da, aber ohne
     * Inhalt, etwa aus einer Altübernahme. Beides in einen Satz zu packen
     * schickt jemanden auf die falsche Suche.
     */
    const kopf = await kopfLesen(c, wunsch.dokumentId)
    if (kopf === null) throw new ExportAbgelehnt('Der Beleg ist nicht erreichbar.')
    if (kopf.storageKey === null) {
      throw new ExportAbgelehnt(
        'Zu diesem Beleg liegt keine Datei vor — es gibt nichts auszugeben.',
      )
    }

    const original = await ablage.lesen(kopf.storageKey).catch(() => null)
    if (original === null) {
      throw new ExportAbgelehnt(
        'Die Datei zu diesem Beleg fehlt in der Ablage. Der Eintrag verweist ' +
          'auf etwas, das nicht da ist.',
      )
    }

    // Das Archivoriginal geht unveraendert hinaus. Kein Neuschreiben, kein
    // Wasserzeichen -- sonst stimmt der Hash im Archiv nicht mehr.
    if (wunsch.variante === 'archiv') {
      return { pdf: original, dateiname: dateiname(kopf, wunsch.variante) }
    }

    const layer = (await layerLesen(c, wunsch.dokumentId)).filter((l) =>
      gehoertHinein(wunsch.variante, l),
    )

    const wasserzeichen = VARIANTEN[wunsch.variante].wasserzeichen
      ? {
          empfaenger: wunsch.empfaenger ?? 'ohne Empfängerangabe',
          datum: new Date().toISOString().slice(0, 10),
        }
      : null

    if (!brauchtSeitenbilder(wunsch.variante, kopf.hatSchwaerzung)) {
      return {
        pdf: await aufOriginal(original, layer, wasserzeichen),
        dateiname: dateiname(kopf, wunsch.variante),
      }
    }

    /*
     * Der Beleg ist geschwaerzt: aus Seitenbildern bauen.
     *
     * Ohne Seitenbilder geht das nicht -- und dann lieber gar kein Export
     * als einer, in dem das Geschwaerzte im Klartext steht. Das trifft
     * Belege, die nie aufbereitet wurden (Altuebernahme, abgebrochener Lauf).
     */
    const seiten = await seitenbilderLesen(c, ablage, wunsch.dokumentId)
    if (seiten.length === 0) {
      throw new ExportAbgelehnt(
        'Der Beleg ist geschwärzt, aber es liegen keine Seitenbilder vor. ' +
          'Ohne sie ließe sich die Schwärzung nicht sicher einbrennen.',
      )
    }

    return {
      pdf: await ausSeitenbildern(seiten, layer, wasserzeichen),
      dateiname: dateiname(kopf, wunsch.variante),
    }
  }
}

interface Belegkopf {
  storageKey: string | null
  hatSchwaerzung: boolean
  kreditor: string | null
  rechnungsnummer: string | null
}

async function kopfLesen(c: PoolClient, dokumentId: string): Promise<Belegkopf | null> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select (select f.storage_key from dokument_datei f
              where f.dokument_id = d.id and f.variante = 'original' limit 1) as storage_key,
            app.hat_schwaerzung(d.id) as hat_schwaerzung,
            k.name as kreditor,
            rf.rechnungsnummer
       from dokument d
       left join rechnung_fakten rf on rf.dokument_id = d.id
       left join kreditor k on k.id = rf.kreditor_id
      where d.id = $1`,
    [dokumentId],
  )
  const z = rows[0]
  if (z === undefined) return null

  return {
    storageKey: z['storage_key'] == null ? null : String(z['storage_key']),
    hatSchwaerzung: z['hat_schwaerzung'] === true,
    kreditor: z['kreditor'] == null ? null : String(z['kreditor']),
    rechnungsnummer: z['rechnungsnummer'] == null ? null : String(z['rechnungsnummer']),
  }
}

async function layerLesen(c: PoolClient, dokumentId: string): Promise<
  Array<Exportlayer & { sichtbarkeit: string }>
> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select typ, seite, x, y, breite, hoehe, inhalt_text, sichtbarkeit
       from dokument_layer
      where dokument_id = $1 and geloescht_am is null
      order by
        -- Schwaerzungen zuletzt: Sie liegen ueber allem anderen.
        case when typ = 'schwaerzung' then 1 else 0 end,
        erstellt_am`,
    [dokumentId],
  )
  return rows.map((z) => ({
    typ: String(z['typ']),
    seite: Number(z['seite']),
    x: Number(z['x']),
    y: Number(z['y']),
    breite: Number(z['breite']),
    hoehe: Number(z['hoehe']),
    text: z['inhalt_text'] == null ? null : String(z['inhalt_text']),
    sichtbarkeit: String(z['sichtbarkeit']),
  }))
}

async function seitenbilderLesen(
  c: PoolClient,
  ablage: Ablage,
  dokumentId: string,
): Promise<Seitenbild[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select f.seite, f.storage_key, s.breite, s.hoehe
       from dokument_datei f
       join dokument_seite s on s.dokument_id = f.dokument_id and s.seite = f.seite
      where f.dokument_id = $1 and f.variante = 'ansicht_webp'
        and f.storage_key like '%-lesen.webp'
      order by f.seite`,
    [dokumentId],
  )

  const seiten: Seitenbild[] = []
  for (const z of rows) {
    const bild = await ablage.lesen(String(z['storage_key'])).catch(() => null)
    if (bild === null) continue
    seiten.push({
      seite: Number(z['seite']),
      bild,
      breite: Number(z['breite']),
      hoehe: Number(z['hoehe']),
    })
  }
  return seiten
}

/**
 * Ein Dateiname, den man in einem Ordner wiedererkennt.
 *
 * Kreditor und Rechnungsnummer, wenn es sie gibt — sonst die Variante allein.
 * Ohne Extraktion gibt es beide nicht, und dann ist „Beleg" ehrlicher als
 * eine erfundene Kennung.
 */
function dateiname(kopf: Belegkopf, variante: Exportvariante): string {
  const teile = [kopf.kreditor, kopf.rechnungsnummer, VARIANTEN[variante].bezeichnung]
    .filter((t): t is string => t !== null && t.trim() !== '')
    .map((t) => t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim())

  return `${teile.length > 1 ? teile.join(' - ') : `Beleg - ${teile[0]}`}.pdf`
}
