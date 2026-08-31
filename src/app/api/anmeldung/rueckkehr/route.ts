/**
 * Der Rückweg vom Identitätsanbieter.
 *
 * Hier fällt die Entscheidung, ob jemand hereinkommt. Vier Schritte, und
 * keiner davon darf übersprungen werden:
 *
 *   1. Zustand aus dem Cookie holen und die Signatur prüfen.
 *   2. Antwort des Anbieters prüfen (Signatur, state, nonce, PKCE).
 *   3. Die bestätigte Identität einem **angelegten** Benutzer zuordnen.
 *   4. Sitzung anlegen und das Cookie setzen.
 *
 * Schritt 3 ist der, den man weglassen möchte, weil er zusätzliche Arbeit in
 * der Verwaltung bedeutet. Ohne ihn hätte jeder im Microsoft-Mandanten mit
 * dem ersten Anmeldeversuch einen Zugang zum DMS.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { anbieter, AnmeldungAbgelehnt, type Anmeldezustand } from '@/anmeldung'
import {
  anmeldungProtokollieren,
  identitaetAufloesen,
  sitzungAnlegen,
  SITZUNG_DAUER_MIN,
  SITZUNG_COOKIE,
  zustandAuspacken,
  ZUSTAND_COOKIE,
} from '@/anmeldung/sitzung'
import { zielPruefen } from '@/anmeldung/ziel'
import { rueckkehrUrl } from '@/app/lib/anmelde-aktionen'

function zurAnmeldung(anfrage: NextRequest, grund: string): NextResponse {
  const antwort = NextResponse.redirect(new URL(`/anmeldung?grund=${grund}`, anfrage.url))
  antwort.cookies.delete(ZUSTAND_COOKIE)
  return antwort
}

export async function GET(anfrage: NextRequest): Promise<NextResponse> {
  const dienst = anbieter()

  const zustand = zustandAuspacken<Anmeldezustand>(
    anfrage.cookies.get(ZUSTAND_COOKIE)?.value,
  )
  if (zustand === null) {
    // Kein Zustand heißt: Das Cookie fehlt, ist abgelaufen oder wurde
    // verfälscht. In allen drei Fällen ist der einzig richtige Schritt, von
    // vorn zu beginnen -- nicht, die Antwort trotzdem zu prüfen.
    await anmeldungProtokollieren('abgelehnt', dienst.name, 'zustand_fehlt')
    return zurAnmeldung(anfrage, 'abgelaufen')
  }

  let identitaet
  try {
    identitaet = await dienst.abschliessen(
      new URL(anfrage.url),
      zustand,
      await rueckkehrUrl(),
    )
  } catch (fehler) {
    const hinweis = fehler instanceof AnmeldungAbgelehnt ? fehler.hinweis : 'unbekannter_fehler'
    await anmeldungProtokollieren('abgelehnt', dienst.name, hinweis)
    return zurAnmeldung(anfrage, 'abgelehnt')
  }

  const benutzerId = await identitaetAufloesen(
    identitaet.anbieter,
    identitaet.externeKennung,
    identitaet.email,
  )
  if (benutzerId === null) {
    // Bewusst ohne die E-Mail-Adresse im Protokoll: Der Eintrag wird länger
    // aufbewahrt als eine Sitzung, und wer sich vergeblich anmeldet, soll
    // damit keine Adressliste erzeugen.
    await anmeldungProtokollieren('unbekannt', dienst.name, 'kein_benutzer_zur_identitaet')
    return zurAnmeldung(anfrage, 'unbekannt')
  }

  const token = await sitzungAnlegen(benutzerId, dienst.name)
  if (token === null) {
    // sitzung_anlegen liefert nichts, wenn der Benutzer nicht aktiv ist.
    await anmeldungProtokollieren('gesperrt', dienst.name, 'benutzer_nicht_aktiv')
    return zurAnmeldung(anfrage, 'gesperrt')
  }

  const ziel = zielPruefen(zustand.zurueckNach)
  const antwort = NextResponse.redirect(new URL(ziel, anfrage.url))
  antwort.cookies.set(SITZUNG_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SITZUNG_DAUER_MIN * 60,
  })
  antwort.cookies.delete(ZUSTAND_COOKIE)
  return antwort
}
