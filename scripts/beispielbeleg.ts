/**
 * Liefert einen erfundenen Beleg ein und bereitet ihn auf.
 *
 * Für die Entwicklung: Ohne einen Beleg mit Derivaten in der Ablage lässt
 * sich der Viewer weder ansehen noch messen. Die Datei ist erzeugt, kein
 * echtes Kundendokument (Projektregel).
 *
 *   npx tsx scripts/beispielbeleg.ts [Seitenzahl]
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { DateisystemAblage } from '../src/ablage'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { dokumentAufnehmen } from '../src/ingest/aufnehmen'
import { queueBeenden } from '../src/queue'
import { aufbereiten } from '../src/worker/aufbereitung'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'
const OBJEKT_42 = '50000000-0000-0000-0000-000000000042'

const seitenzahl = Number(process.argv[2] ?? 3)

async function pdfBauen(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const schrift = await doc.embedFont(StandardFonts.Helvetica)

  for (let nr = 1; nr <= seitenzahl; nr++) {
    const seite = doc.addPage([595, 842])
    const zeilen =
      nr === 1
        ? [
            'Musterreinigung GmbH, Beispielweg 1, 00000 Musterstadt',
            'Rechnung RE-2026-0815 vom 30.08.2026',
            'Objekt 42, Lindenweg 3 -- Hausreinigung',
            'Leistungszeitraum Juli bis September 2026',
            '',
            'Reinigung Treppenhaus         420,00 EUR',
            'Gartenpflege                  260,00 EUR',
            'Winterdienst (Bereitschaft)   180,00 EUR',
            '',
            'Netto 860,00 EUR zzgl. 19 % USt 163,40 EUR',
            'Gesamt 1.023,40 EUR',
          ]
        : [`Seite ${nr} von ${seitenzahl}`, 'Anlage zur Rechnung RE-2026-0815']

    let y = 780
    for (const zeile of zeilen) {
      if (zeile !== '') seite.drawText(zeile, { x: 60, y, size: 11, font: schrift })
      y -= 18
    }
  }

  return Buffer.from(await doc.save())
}

const ablage = new DateisystemAblage(process.env['DMS_ABLAGE'] ?? '.ablage')
const inhalt = await pdfBauen()

const dokumentId = await alsBenutzer(ANNA, async (c) => {
  const auf = await dokumentAufnehmen(
    c,
    ablage,
    {
      mandantId: MANDANT,
      objektId: OBJEKT_42,
      belegart: 'rechnung',
      eingangskanal: 'upload',
      dateiname: 'beispiel.pdf',
      mime: 'application/pdf',
      inhalt,
    },
    ANNA,
  )
  if (auf.dublette.istDublette) {
    console.log('Bereits vorhanden, verwende das Original:', auf.dublette.originalId)
    return auf.dublette.originalId ?? auf.dokumentId
  }
  await aufbereiten(c, ablage, auf.dokumentId)
  return auf.dokumentId
})

console.log('Beleg:', dokumentId)
console.log('Ansicht: http://localhost:3000/beleg/' + dokumentId)

await queueBeenden()
await poolSchliessen()
