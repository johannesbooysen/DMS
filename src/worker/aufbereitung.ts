/**
 * Aufbereitung eines eingegangenen Dokuments.
 *
 * Reihenfolge nach Konzept 13:
 *   Formaterkennung (ZUGFeRD/XRechnung -> XML-Pfad, kein OCR)
 *   -> Textlayer vorhanden? pdfium : ocrmypdf
 *   -> dokument_seite (Text und Koordinaten)
 *   -> WebP-Derivate
 *   -> Extraktion, Lernspeicher, Ampel
 *
 * Stand: der Rahmen steht, die Seitenverarbeitung noch nicht. Was fehlt,
 * ist unten einzeln als offener Schritt vermerkt, statt still zu tun, als
 * waere es erledigt.
 */

import type { PoolClient } from 'pg'

export interface Aufbereitungsergebnis {
  seiten: number
  weg: 'zugferd' | 'textlayer' | 'ocr' | 'unbekannt'
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
  dokumentId: string,
): Promise<Aufbereitungsergebnis> {
  const { rows } = await c.query<{ status: string }>(
    'select status from dokument where id = $1',
    [dokumentId],
  )

  if (rows.length === 0) {
    // Kein Fehler: das Dokument kann inzwischen storniert worden sein, oder
    // der Auftrag gehoert zu einem anderen Mandanten und die RLS blendet es
    // aus. Beides ist kein Grund, den Auftrag zu wiederholen.
    return { seiten: 0, weg: 'unbekannt' }
  }

  // OFFEN -- naechster Schritt der Pipeline:
  //   1. Original aus der Ablage lesen
  //   2. istStrukturierteRechnung -> XML-Pfad
  //   3. sonst Textlayer pruefen (pdfium), sonst ocrmypdf
  //   4. dokument_seite je Seite schreiben (Text und Koordinaten)
  //   5. WebP-Derivate: Thumbnail und Lesegroesse
  // Dafuer fehlt die Entscheidung ueber die PDF-Bibliothek; siehe
  // docs/adr/ -- ohne sie waere jede Zeile hier eine Vorfestlegung.

  await c.query(
    `update dokument set status = 'laufend'
      where id = $1 and status = 'in_aufbereitung'`,
    [dokumentId],
  )

  return { seiten: 0, weg: 'unbekannt' }
}
