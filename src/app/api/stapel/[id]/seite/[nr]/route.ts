/**
 * Eine Stapelseite als Miniatur.
 *
 * Eigene Route und nicht die Belegroute: Ein Stapel ist kein Dokument, und
 * seine Seiten liegen unter einem eigenen Ablageschlüssel. Sie über die
 * Belegroute zu holen, hieße, dort eine zweite Bedeutung einzubauen.
 */

import { ABLAGE } from '@/app/lib/belege'
import { angemeldeterBenutzerOderNichts } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'
import { stapelseiteSchluessel } from '@/stapel'

export async function GET(
  _anfrage: Request,
  ctx: { params: Promise<{ id: string; nr: string }> },
): Promise<Response> {
  const { id, nr } = await ctx.params
  const seite = Number(nr)
  if (!Number.isInteger(seite) || seite < 1) {
    return new Response('Ungueltige Seitennummer', { status: 400 })
  }

  const benutzer = await angemeldeterBenutzerOderNichts()
  if (benutzer === null) return new Response('Nicht angemeldet', { status: 401 })

  // Die Sichtbarkeit entscheidet die RLS auf `stapel` -- nicht der
  // Dateiname. Wer den Stapel nicht sehen darf, bekommt hier nichts.
  const erlaubt = await alsBenutzer(benutzer, async (c) => {
    const { rows } = await c.query(
      'select 1 from stapel_seite where stapel_id = $1 and seite = $2',
      [id, seite],
    )
    return rows.length > 0
  })
  if (!erlaubt) return new Response('Nicht gefunden', { status: 404 })

  try {
    const bild = await ABLAGE.lesen(stapelseiteSchluessel(id, seite))
    return new Response(new Uint8Array(bild), {
      headers: {
        'content-type': 'image/webp',
        'content-length': String(bild.byteLength),
        // Die Miniatur aendert sich nicht, aber der Stapel wird uebernommen
        // oder verworfen -- kurz zwischenspeichern genuegt.
        'cache-control': 'private, max-age=300',
      },
    })
  } catch {
    return new Response('Nicht gefunden', { status: 404 })
  }
}
