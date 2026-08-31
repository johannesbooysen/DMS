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
