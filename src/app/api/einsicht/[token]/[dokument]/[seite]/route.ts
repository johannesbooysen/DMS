/**
 * Eine Belegseite für die externe Ansicht.
 *
 * Dieselbe Datei wie intern, aber ein anderer Weg dorthin — und drei
 * Unterschiede, die alle drei nötig sind:
 *
 *   1. Der Zugang kommt aus dem Token, nicht aus der Sitzung.
 *   2. Der Umfang wird je Aufruf geprüft, nicht je Liste.
 *   3. Das Wasserzeichen wird hier aufgetragen — das gespeicherte Derivat
 *      bleibt unberührt, und dieselbe Datei kann intern ohne Zeichen
 *      ausgeliefert werden.
 *
 * `seite/pdf` liegt in einer eigenen Route: Ein Download ist ein eigenes
 * Recht, und ein gemeinsamer Handler hätte irgendwann einen Zweig, der beides
 * verwechselt.
 */

import { ABLAGE } from '@/app/lib/belege'
import {
  einsichtAufloesen,
  einsichtDarfBeleg,
  einsichtDatei,
  einsichtProtokollieren,
} from '@/einsicht'
import { wasserzeichenAuftragen } from '@/einsicht/wasserzeichen'

/** Die Adresse des Anfragenden, so wie der Reverse Proxy sie meldet. */
function absender(anfrage: Request): string | null {
  const kopf = anfrage.headers.get('x-forwarded-for')
  // Der erste Eintrag ist der ursprüngliche Absender; alles dahinter sind
  // Proxys.
  return kopf === null ? null : (kopf.split(',')[0]?.trim() ?? null)
}

export async function GET(
  anfrage: Request,
  ctx: { params: Promise<{ token: string; dokument: string; seite: string }> },
): Promise<Response> {
  const { token, dokument, seite } = await ctx.params
  const nr = Number(seite)
  if (!Number.isInteger(nr) || nr < 1) {
    return new Response('Ungueltige Seitennummer', { status: 400 })
  }

  const gewaehrung = await einsichtAufloesen(token)
  if (gewaehrung === null) return new Response('Nicht gefunden', { status: 404 })

  if (!(await einsichtDarfBeleg(gewaehrung.gewaehrungId, dokument))) {
    await einsichtProtokollieren(
      gewaehrung.gewaehrungId,
      null,
      'abgelehnt',
      absender(anfrage),
    )
    return new Response('Nicht gefunden', { status: 404 })
  }

  const datei = await einsichtDatei(gewaehrung.gewaehrungId, dokument, 'ansicht_webp', nr)
  if (datei === null) return new Response('Nicht gefunden', { status: 404 })

  await einsichtProtokollieren(
    gewaehrung.gewaehrungId,
    dokument,
    'seite',
    absender(anfrage),
  )

  const bild = await ABLAGE.lesen(datei.storageKey)
  const ausgabe = gewaehrung.wasserzeichen
    ? await wasserzeichenAuftragen(bild, {
        empfaenger: gewaehrung.personName,
        datum: new Date().toISOString().slice(0, 10),
      })
    : bild

  return new Response(new Uint8Array(ausgabe), {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(ausgabe.byteLength),
      // Nicht zwischenspeichern: Das Wasserzeichen trägt das Datum, und die
      // Gewährung kann jederzeit widerrufen werden. Ein zwischengespeichertes
      // Bild überlebte den Widerruf.
      'cache-control': 'no-store',
    },
  })
}
