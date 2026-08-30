/**
 * Vorgerenderte Seite als WebP.
 *
 * Hier passiert bewusst fast nichts: Schluessel nachschlagen, Datei
 * ausliefern. Gerendert wurde beim Eingang. Das ist der Kern des
 * Geschwindigkeitsversprechens -- nicht das Format ist der Engpass, sondern
 * der Zeitpunkt der Verarbeitung (Konzept 1).
 */

import { ABLAGE, seitenbildSchluessel } from '@/app/lib/belege'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

export async function GET(
  anfrage: Request,
  ctx: { params: Promise<{ id: string; nr: string }> },
): Promise<Response> {
  const { id, nr } = await ctx.params
  const seite = Number(nr)
  if (!Number.isInteger(seite) || seite < 1) {
    return new Response('Ungueltige Seitennummer', { status: 400 })
  }

  const groesse = new URL(anfrage.url).searchParams.get('groesse') === 'miniatur'
    ? 'miniatur'
    : 'lesen'

  const schluessel = await seitenbildSchluessel(angemeldeterBenutzer(), id, seite, groesse)
  // Kein Unterschied zwischen "gibt es nicht" und "darfst du nicht sehen":
  // Die zweite Auskunft verriete bereits, dass es den Beleg gibt.
  if (schluessel === null) return new Response('Nicht gefunden', { status: 404 })

  const bild = await ABLAGE.lesen(schluessel)
  return new Response(new Uint8Array(bild), {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(bild.byteLength),
      // Das Derivat ist unveraenderlich: Eine neue Fassung bekommt einen
      // neuen Schluessel. Deshalb privat, aber lange zwischenspeicherbar.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}
