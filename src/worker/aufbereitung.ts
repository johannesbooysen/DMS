/**
 * Aufbereitung eines eingegangenen Dokuments.
 *
 * Reihenfolge nach Konzept 13:
 *   Formaterkennung (ZUGFeRD/XRechnung -> XML-Pfad, kein OCR)
 *   -> Textlayer vorhanden? pdfjs : ocrmypdf
 *   -> dokument_seite (Text)
 *   -> WebP-Derivate (Trefferliste und Lesegroesse)
 *   -> Extraktion, Lernspeicher, Ampel
 *
 * Die letzten drei Schritte folgen spaeter. Was noch nicht da ist, steht
 * unten als benannter offener Punkt.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'
import { hatTextlayer, seitenLesen, seiteRendern } from '../ingest/pdf'

/** Breite der Vorschau in der Trefferliste. */
export const BREITE_MINIATUR = 240
/** Breite der Leseansicht. Das PDF selbst wird erst beim Zoomen geholt. */
export const BREITE_LESEN = 1240

export type Verarbeitungsweg = 'zugferd' | 'textlayer' | 'ocr_noetig' | 'kein_pdf'

export interface Aufbereitungsergebnis {
  seiten: number
  weg: Verarbeitungsweg
}

/**
 * Erkennt ZUGFeRD/XRechnung an der eingebetteten XML-Datei. Fuer diese
 * Belege ist das XML der fuehrende Datensatz und das Extraktionsvertrauen
 * per Definition 1,0 -- sie laufen ohne Extraktionslauf durch (Konzept 14).
 */
export function istStrukturierteRechnung(inhalt: Buffer): boolean {
  const kopf = inhalt.subarray(0, 4).toString('latin1')
  if (kopf !== '%PDF') {
    // Reine XRechnung kommt als XML ohne PDF-Huelle.
    const anfang = inhalt.subarray(0, 512).toString('utf8')
    return anfang.includes('CrossIndustryInvoice') || anfang.includes('ubl:Invoice')
  }
  const text = inhalt.toString('latin1')
  return text.includes('factur-x.xml') || text.includes('zugferd-invoice.xml')
}

export async function aufbereiten(
  c: PoolClient,
  ablage: Ablage,
  dokumentId: string,
): Promise<Aufbereitungsergebnis> {
  const { rows } = await c.query<{ storage_praefix: string; storage_key: string | null }>(
    `select d.storage_praefix,
            (select f.storage_key from dokument_datei f
              where f.dokument_id = d.id and f.variante = 'original'
              limit 1) as storage_key
       from dokument d
      where d.id = $1`,
    [dokumentId],
  )

  if (rows.length === 0 || rows[0].storage_key === null) {
    // Kein Fehler: das Dokument kann storniert worden sein, oder die RLS
    // blendet es aus. Beides ist kein Grund, den Auftrag zu wiederholen.
    return { seiten: 0, weg: 'kein_pdf' }
  }

  const praefix = rows[0].storage_praefix
  const inhalt = await ablage.lesen(rows[0].storage_key)

  if (inhalt.subarray(0, 4).toString('latin1') !== '%PDF') {
    // XRechnung ohne PDF-Huelle: nichts zu rendern, das XML fuehrt.
    const weg: Verarbeitungsweg = istStrukturierteRechnung(inhalt) ? 'zugferd' : 'kein_pdf'
    await c.query(`update dokument set seitenzahl = 0, status = 'laufend' where id = $1`, [
      dokumentId,
    ])
    return { seiten: 0, weg }
  }

  const seiten = await seitenLesen(inhalt)

  // Die Fundstellen der einzelnen Textstuecke bleiben vorerst im Speicher.
  // Persistiert werden sie erst, wenn die Stempelplatzierung sie braucht --
  // sie sucht den groessten freien Block auf der Seite (Konzept 16). Bis
  // dahin waere eine Spalte dafuer eine Vorfestlegung ohne Nutzer.
  for (const seite of seiten) {
    await c.query(
      `insert into dokument_seite (dokument_id, seite, text, breite, hoehe)
       values ($1, $2, $3, $4, $5)
       on conflict (dokument_id, seite) do update
          set text = excluded.text, breite = excluded.breite, hoehe = excluded.hoehe`,
      [dokumentId, seite.seite, seite.text, seite.breite, seite.hoehe],
    )
  }

  // Vorrendern beim Eingang, nicht bei der Anzeige -- das ist der Grund,
  // warum der Viewer schnell ist (Konzept 1).
  for (const seite of seiten) {
    const bild = await seiteRendern(inhalt, seite.seite, BREITE_LESEN)
    const schluessel = `${praefix}/ansicht/${seite.seite}-lesen.webp`
    await ablage.schreiben(schluessel, bild)
    await c.query(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse, seite)
       values ($1, 'ansicht_webp', $2, 'image/webp', $3, $4)`,
      [dokumentId, schluessel, bild.byteLength, seite.seite],
    )
  }

  if (seiten.length > 0) {
    const miniatur = await seiteRendern(inhalt, 1, BREITE_MINIATUR)
    const schluessel = `${praefix}/ansicht/1-miniatur.webp`
    await ablage.schreiben(schluessel, miniatur)
    await c.query(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse, seite)
       values ($1, 'ansicht_webp', $2, 'image/webp', $3, 1)`,
      [dokumentId, schluessel, miniatur.byteLength],
    )
  }

  const weg: Verarbeitungsweg = istStrukturierteRechnung(inhalt)
    ? 'zugferd'
    : hatTextlayer(seiten)
      ? 'textlayer'
      : 'ocr_noetig'

  await c.query(`update dokument set seitenzahl = $2, status = 'laufend' where id = $1`, [
    dokumentId,
    seiten.length,
  ])

  // OFFEN, in dieser Reihenfolge:
  //   * weg = 'ocr_noetig' -> ocrmypdf aufrufen und den Seitentext ersetzen.
  //     Braucht Python, Tesseract mit deutschem Sprachpaket und Ghostscript.
  //   * KI-Extraktion hinter dem Provider-Interface -> extraktion_feld
  //   * Lernspeicher abfragen, Plausibilitaetspruefungen, Ampel setzen

  return { seiten: seiten.length, weg }
}
