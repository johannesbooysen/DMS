/**
 * Das Original-PDF -- nur per Range-Request.
 *
 * Konzept 23: Der Viewer zeigt WebP, das PDF wird ausschliesslich beim
 * Zoomen, Drucken oder Herunterladen geholt, und dann stueckweise. Ein
 * vollstaendiger Download bei jedem Blaettern ist genau das Verhalten, das
 * die bestehende Loesung langsam macht.
 */

import { ABLAGE, originalSchluessel } from '@/app/lib/belege'
import { angemeldeterBenutzerOderNichts } from '@/app/lib/sitzung'

/** Wertet einen Range-Kopf der Form "bytes=0-1023" aus. */
function bereichLesen(kopf: string | null, groesse: number): { von: number; bis: number } | null {
  if (kopf === null) return null
  const treffer = /^bytes=(\d*)-(\d*)$/.exec(kopf.trim())
  if (treffer === null) return null

  const [, vonRoh, bisRoh] = treffer
  if (vonRoh === '' && bisRoh === '') return null

  if (vonRoh === '') {
    // Suffix-Form: die letzten n Bytes
    const laenge = Number(bisRoh)
    return { von: Math.max(0, groesse - laenge), bis: groesse - 1 }
  }

  const von = Number(vonRoh)
  const bis = bisRoh === '' ? groesse - 1 : Math.min(Number(bisRoh), groesse - 1)
  if (von > bis || von >= groesse) return null
  return { von, bis }
}

export async function GET(
  anfrage: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params

  // Ohne Sitzung 401 statt einer Umleitung -- der Viewer holt hier Bytes,
  // keine Seite.
  const benutzer = await angemeldeterBenutzerOderNichts()
  if (benutzer === null) return new Response('Nicht angemeldet', { status: 401 })

  const datei = await originalSchluessel(benutzer, id)
  if (datei === null) return new Response('Nicht gefunden', { status: 404 })

  const inhalt = await ABLAGE.lesen(datei.schluessel)
  const bereich = bereichLesen(anfrage.headers.get('range'), inhalt.byteLength)

  if (bereich === null) {
    return new Response(new Uint8Array(inhalt), {
      headers: {
        'content-type': datei.mime,
        'content-length': String(inhalt.byteLength),
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  }

  const teil = inhalt.subarray(bereich.von, bereich.bis + 1)
  return new Response(new Uint8Array(teil), {
    status: 206,
    headers: {
      'content-type': datei.mime,
      'content-length': String(teil.byteLength),
      'content-range': `bytes ${bereich.von}-${bereich.bis}/${inhalt.byteLength}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}
