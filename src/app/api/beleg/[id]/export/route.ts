/**
 * Beleg als PDF, in einer der vier Varianten aus Konzept 16.
 *
 * Getrennt von `/pdf`, und mit Absicht: Dort geht das **Original** hinaus,
 * stückweise per Range-Request, für den Viewer. Hier entsteht bei jedem
 * Aufruf ein neues Dokument mit eingezeichneten Layern — das lässt sich
 * weder stückweise ausliefern noch zwischenspeichern.
 *
 * Kein `cache-control` mit Ablaufzeit: Ein Export trägt den Stand von jetzt.
 * Wird morgen gestempelt oder geschwärzt, muss der nächste Abruf das zeigen.
 */

import { ABLAGE } from '@/app/lib/belege'
import { angemeldeterBenutzerOderNichts } from '@/app/lib/sitzung'
import { belegExportieren, ExportAbgelehnt, istVariante } from '@/export'

export async function GET(
  anfrage: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params

  const benutzer = await angemeldeterBenutzerOderNichts()
  if (benutzer === null) return new Response('Nicht angemeldet', { status: 401 })

  const gewaehlt = new URL(anfrage.url).searchParams.get('variante') ?? 'stempel'
  // Der Wert kommt aus der Adresszeile. Ohne diese Pruefung waere die
  // Variante ein Feld, in das jemand schreiben kann, was er moechte.
  if (!istVariante(gewaehlt)) {
    return new Response('Unbekannte Variante', { status: 400 })
  }

  const empfaenger = new URL(anfrage.url).searchParams.get('empfaenger')

  try {
    const { pdf, dateiname } = await belegExportieren(benutzer, ABLAGE, {
      dokumentId: id,
      variante: gewaehlt,
      empfaenger,
    })

    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.byteLength),
        // `filename*` mit UTF-8: Kreditorennamen tragen Umlaute, und ohne
        // die zweite Form landet im Browser ein zerlegter Dateiname.
        'content-disposition':
          `attachment; filename="${dateiname.replace(/[^\x20-\x7E]/g, '_')}"; ` +
          `filename*=UTF-8''${encodeURIComponent(dateiname)}`,
        'cache-control': 'no-store',
      },
    })
  } catch (fehler) {
    /*
     * Der Grund geht mit hinaus, nicht nur ein Statuscode.
     *
     * „Der Beleg ist geschwärzt, aber es liegen keine Seitenbilder vor" ist
     * eine Auskunft, mit der jemand etwas anfangen kann. Ein nacktes 404
     * schickt ihn ins Raten.
     */
    if (fehler instanceof ExportAbgelehnt) {
      return new Response(fehler.message, {
        status: 409,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    throw fehler
  }
}
