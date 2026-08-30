/**
 * Schriften für das Rendern.
 *
 * Warum das nötig ist: pdfjs zeichnet Text über die Zeichenfläche. Bettet ein
 * PDF seine Schrift ein — was Lieferantenrechnungen fast immer tun —, benutzt
 * pdfjs diese Schrift und alles stimmt. Verlässt sich das PDF dagegen auf eine
 * der 14 Standardschriften (Helvetica, Times, Courier), sucht die
 * Zeichenfläche eine Schrift dieses Namens. Findet sie keine, nimmt sie eine
 * Ersatzschrift mit anderen Vorschubbreiten — sichtbar an auseinandergezogenen
 * Wörtern: „M u s t e r r e i n i g u n g".
 *
 * Gegenmittel: metrisch gleichwertige Schriften unter den erwarteten Namen
 * anmelden. Arial ist metrisch gleich Helvetica, Liberation Sans ebenso.
 *
 * Fehlt eine Schrift, wird sie übersprungen. Das Rendern soll an einer
 * fehlenden Schriftdatei nicht scheitern — es wird nur weniger genau, und die
 * Textextraktion ist davon ohnehin nicht betroffen.
 */

import { existsSync } from 'node:fs'
import { GlobalFonts } from '@napi-rs/canvas'

interface Zuordnung {
  /** Name, unter dem das PDF die Schrift anfordert. */
  name: string
  /** Metrisch gleichwertige Dateien, in der Reihenfolge der Bevorzugung. */
  dateien: string[]
}

const ZUORDNUNGEN: Zuordnung[] = [
  {
    name: 'Helvetica',
    dateien: [
      'C:/Windows/Fonts/arial.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf',
    ],
  },
  {
    name: 'Times',
    dateien: [
      'C:/Windows/Fonts/times.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
    ],
  },
  {
    name: 'Courier',
    dateien: [
      'C:/Windows/Fonts/cour.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    ],
  },
]

let angemeldet = false

/** Einmal je Prozess. Mehrfaches Aufrufen ist unschädlich. */
export function schriftenAnmelden(): string[] {
  if (angemeldet) return []
  angemeldet = true

  const erfolge: string[] = []
  for (const zuordnung of ZUORDNUNGEN) {
    const datei = zuordnung.dateien.find((d) => existsSync(d))
    if (datei === undefined) continue
    if (GlobalFonts.registerFromPath(datei, zuordnung.name)) {
      erfolge.push(`${zuordnung.name} <- ${datei}`)
    }
  }
  return erfolge
}
