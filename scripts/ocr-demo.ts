/**
 * Ein Scan ohne Textlayer geht durch die echte Warteschlange.
 *
 *   npx tsx scripts/ocr-demo.ts
 *
 * Ohne `DMS_OCR` landet er im Fehlerkorb -- sichtbar, mit Grund. Genau das
 * war vorher der stille Fall: Status `laufend`, Seiten ohne Text, keine
 * Meldung.
 */

import { DateisystemAblage } from '../src/ablage'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { fehlerkorbLaden } from '../src/fehlerkorb'
import { dokumentAufnehmen } from '../src/ingest/aufnehmen'
import { ocrEingerichtet } from '../src/ocr'
// Pflicht: `dokumentAufnehmen` reiht einen Auftrag ein und startet dabei
// pg-boss. Ohne `queueBeenden` haelt dessen Zeitgeber den Prozess offen --
// das Skript liefe bis zum Abbruch. Genau daran haing schon die
// Postausgang-Demo.
import { queueBeenden } from '../src/queue'
import { aufbereiten } from '../src/worker/aufbereitung'
import { pdfBauen, scanvorlage } from '../tests/hilfe/pdf-bauen'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'

const ablage = new DateisystemAblage(process.env.DMS_ABLAGE ?? '.ablage')
const scan = await pdfBauen(scanvorlage())

console.log(`Texterkennung eingerichtet: ${ocrEingerichtet() ? 'ja' : 'nein'}`)

const bericht = await alsBenutzer(ANNA, async (c) => {
  const auf = await dokumentAufnehmen(
    c,
    ablage,
    {
      mandantId: MANDANT,
      belegart: 'rechnung',
      eingangskanal: 'scan',
      dateiname: 'scan-ohne-textlayer.pdf',
      mime: 'application/pdf',
      inhalt: scan,
    },
    ANNA,
  )
  return aufbereiten(c, ablage, auf.dokumentId)
})

console.log(`Verarbeitungsweg: ${bericht.weg}, Seiten: ${bericht.seiten}`)

for (const z of await fehlerkorbLaden(ANNA)) {
  console.log(`  ${z.warteschlange}  ${z.grund}`)
}

await queueBeenden()
await poolSchliessen()
