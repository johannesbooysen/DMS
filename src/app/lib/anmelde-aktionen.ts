'use server'

/**
 * Die Anmeldung beginnen und beenden.
 *
 * Der Rückweg vom Anbieter liegt nicht hier, sondern als Route Handler unter
 * `/api/anmeldung/rueckkehr` — er wird vom Browser als GET angesteuert und
 * ist keine Formularaktion.
 */

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { anbieter } from '@/anmeldung'
import { zielPruefen } from '@/anmeldung/ziel'
import {
  sitzungBeenden,
  SITZUNG_COOKIE,
  zustandVerpacken,
  ZUSTAND_COOKIE,
} from '@/anmeldung/sitzung'

/** Wie lange der halbfertige Anmeldeversuch gültig bleibt. */
const ZUSTAND_DAUER_S = 600

/**
 * Die eigene Adresse, wie der Browser sie sieht.
 *
 * Muss auf das Zeichen mit der in Entra hinterlegten Rückkehr-URL
 * übereinstimmen, sonst weist Microsoft die Anmeldung ab. `DMS_BASIS_URL`
 * hat deshalb Vorrang: Hinter einem Reverse Proxy ist der Host im Kopf der
 * Anfrage nicht unbedingt der, unter dem die Anwendung erreichbar ist.
 */
async function basisUrl(): Promise<string> {
  const eingestellt = process.env['DMS_BASIS_URL']
  if (eingestellt !== undefined && eingestellt !== '') return eingestellt.replace(/\/$/, '')

  const kopf = await headers()
  const host = kopf.get('host') ?? 'localhost:3000'
  const schema = kopf.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${schema}://${host}`
}

export async function rueckkehrUrl(): Promise<string> {
  return `${await basisUrl()}/api/anmeldung/rueckkehr`
}

export async function anmeldungBeginnenAktion(formular: FormData): Promise<void> {
  // Die Prüfung steht in `@/anmeldung/ziel` -- sie ist die einzige Stelle,
  // an der eine fremde Adresse hereinkommen könnte, und dort ohne Next.js
  // prüfbar.
  const weiter = zielPruefen(String(formular.get('weiter') ?? ''))
  const beginn = await anbieter().beginnen(await rueckkehrUrl(), weiter)

  const kekse = await cookies()
  kekse.set(ZUSTAND_COOKIE, zustandVerpacken(beginn.zustand), {
    httpOnly: true,
    // `lax` und nicht `strict`: Der Browser kommt vom Anbieter zurück, also
    // von einer fremden Seite. Bei `strict` käme das Cookie nicht mit und
    // jede Anmeldung schlüge fehl.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ZUSTAND_DAUER_S,
  })

  redirect(beginn.ziel)
}

export async function abmeldenAktion(): Promise<void> {
  const kekse = await cookies()
  const token = kekse.get(SITZUNG_COOKIE)?.value
  if (token !== undefined) await sitzungBeenden(token)

  // Erst in der Datenbank beenden, dann das Cookie löschen. Andersherum
  // bliebe bei einem Fehler eine gültige Sitzung zurück, zu der niemand mehr
  // ein Cookie hat -- unsichtbar und trotzdem benutzbar, wenn der Token
  // irgendwo mitgeschnitten wurde.
  kekse.delete(SITZUNG_COOKIE)
  redirect('/anmeldung?grund=abgemeldet')
}
