/**
 * Das Original als PDF — nur bei ausdrücklichem Download-Recht.
 *
 * Eigene Route und nicht ein Zweig in der Seitenroute: Ein Download gibt das
 * unveränderte Original heraus, ohne Wasserzeichen und ohne Möglichkeit, es
 * nachträglich zu widerrufen. Das ist eine andere Entscheidung als „ansehen",
 * und sie soll auch im Code an einer anderen Stelle stehen.
 */

import { ABLAGE } from '@/app/lib/belege'
import {
  einsichtAufloesen,
  einsichtDarfBeleg,
  einsichtDatei,
  pdfDarfHinaus,
  einsichtProtokollieren,
} from '@/einsicht'

function absender(anfrage: Request): string | null {
  const kopf = anfrage.headers.get('x-forwarded-for')
  return kopf === null ? null : (kopf.split(',')[0]?.trim() ?? null)
}

export async function GET(
  anfrage: Request,
  ctx: { params: Promise<{ token: string; dokument: string }> },
): Promise<Response> {
  const { token, dokument } = await ctx.params

  const gewaehrung = await einsichtAufloesen(token)
  if (gewaehrung === null) return new Response('Nicht gefunden', { status: 404 })

  // Kein 403: Dass es den Beleg gibt, ist selbst eine Auskunft.
  if (!gewaehrung.rechte.includes('download')) {
    await einsichtProtokollieren(
      gewaehrung.gewaehrungId,
      dokument,
      'abgelehnt',
      absender(anfrage),
    )
    return new Response('Nicht gefunden', { status: 404 })
  }

  if (!(await einsichtDarfBeleg(gewaehrung.gewaehrungId, dokument))) {
    await einsichtProtokollieren(
      gewaehrung.gewaehrungId,
      null,
      'abgelehnt',
      absender(anfrage),
    )
    return new Response('Nicht gefunden', { status: 404 })
  }

  /*
   * Geschwaerzte Belege gehen nicht als PDF hinaus.
   *
   * Ein schwarzes Rechteck in einem PDF liegt nur *darauf* -- der Text
   * darunter bleibt im Dokument und laesst sich markieren, kopieren oder mit
   * jedem Werkzeug auslesen. Genau so sind schon Behoerden und Kanzleien
   * aufgefallen.
   *
   * Richtig schwaerzen hiesse, den Seiteninhalt neu zu schreiben. Das kann
   * pdf-lib nicht, und eine halbe Loesung waere hier schlimmer als keine:
   * Sie saehe aus wie eine Schwaerzung. Die Seitenbilder sind dagegen echt
   * geschwaerzt -- ein WebP hat keinen Textlayer.
   *
   * 403 und nicht 404: Hier wird nichts verborgen. Der Beleg ist da, er geht
   * nur nicht in dieser Form hinaus, und das gehoert gesagt.
   */
  if (!(await pdfDarfHinaus(dokument))) {
    return new Response(
      'Dieser Beleg enthält geschwärzte Stellen und steht deshalb nur als ' +
        'Seitenansicht zur Verfügung, nicht als PDF.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }

  const datei = await einsichtDatei(gewaehrung.gewaehrungId, dokument, 'original')
  if (datei === null) return new Response('Nicht gefunden', { status: 404 })

  await einsichtProtokollieren(
    gewaehrung.gewaehrungId,
    dokument,
    'download',
    absender(anfrage),
  )

  const inhalt = await ABLAGE.lesen(datei.storageKey)
  return new Response(new Uint8Array(inhalt), {
    headers: {
      'content-type': datei.mime,
      'content-length': String(inhalt.byteLength),
      'content-disposition': `attachment; filename="beleg-${dokument}.pdf"`,
      'cache-control': 'no-store',
    },
  })
}
