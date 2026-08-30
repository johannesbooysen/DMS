/**
 * Erzeugt PDFs fuer Tests.
 *
 * Testfixtures sind ausschliesslich synthetisch -- keine echten
 * Kundendokumente, auch nicht anonymisiert (Projektregel). Die Belege
 * entstehen deshalb im Test selbst.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'

export interface Seitenvorlage {
  zeilen: string[]
}

export async function pdfBauen(seiten: Seitenvorlage[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const schrift = await doc.embedFont(StandardFonts.Helvetica)

  for (const vorlage of seiten) {
    const seite = doc.addPage([595, 842])
    let y = 780
    for (const zeile of vorlage.zeilen) {
      seite.drawText(zeile, { x: 60, y, size: 12, font: schrift })
      y -= 20
    }
  }

  return Buffer.from(await doc.save())
}

/** Ein Beleg mit brauchbarem Textlayer. */
export function rechnungsvorlage(): Seitenvorlage[] {
  return [
    {
      zeilen: [
        'Musterreinigung GmbH, Beispielweg 1, 00000 Musterstadt',
        'Rechnung RE-2026-0001 vom 14.03.2026',
        'Hausreinigung Objekt 42, Leistungszeitraum Januar bis Maerz',
        'Netto 1.042,02 EUR zuzueglich 19 Prozent Umsatzsteuer',
      ],
    },
    { zeilen: ['Zahlbar innerhalb von 14 Tagen ohne Abzug.'] },
  ]
}

/**
 * Ein Beleg fast ohne Text -- so sieht ein Scan aus, bei dem nur eine
 * Kopfzeile maschinenlesbar ist. Muss in die OCR-Strecke fallen.
 */
export function scanvorlage(): Seitenvorlage[] {
  return [{ zeilen: ['Seite 1'] }]
}
