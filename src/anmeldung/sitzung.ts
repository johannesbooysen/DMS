/**
 * Sitzungen: anlegen, auflösen, beenden.
 *
 * Serverseitig, nicht als selbsttragendes Token im Cookie. Der Grund steht im
 * Kommentar an der Tabelle: Eine Sitzung muss **sofort** widerrufbar sein —
 * bei Abmeldung, bei Sperrung, beim Entzug einer Rolle. Ein JWT gilt bis zum
 * Ablauf weiter, egal was inzwischen geschehen ist.
 *
 * Im Cookie steht ein Zufallswert, in der Datenbank nur dessen SHA256. Wer
 * die Tabelle liest, kann sich damit nicht anmelden.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { alsAnmeldung } from '@/db'

export const SITZUNG_COOKIE = 'dms_sitzung'
export const ZUSTAND_COOKIE = 'dms_anmeldung'

/** Wie lange eine Sitzung überhaupt gilt. */
export const SITZUNG_DAUER_MIN = 720
/** Nach wie viel Untätigkeit sie verfällt. */
export const SITZUNG_UNTAETIG_MIN = 480

export interface Angemeldet {
  benutzerId: string
  mandantId: string
}

function hash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/**
 * 32 Byte aus dem Zufallsgenerator des Betriebssystems.
 *
 * Nicht `Math.random`, nicht `gen_random_uuid` — eine UUID hat 122 zufällige
 * Bit und ist als Sitzungstoken zwar nicht zu erraten, aber sie sieht nach
 * einer Kennung aus und wird dann irgendwann wie eine behandelt: geloggt,
 * weitergereicht, in eine URL geschrieben.
 */
export function tokenErzeugen(): string {
  return randomBytes(32).toString('base64url')
}

export async function sitzungAnlegen(
  benutzerId: string,
  anbietername: string,
): Promise<string | null> {
  const token = tokenErzeugen()
  const angelegt = await alsAnmeldung(async (c) => {
    const { rows } = await c.query<{ sitzung_anlegen: string | null }>(
      'select app.sitzung_anlegen($1, $2, $3, $4)',
      [benutzerId, hash(token), anbietername, SITZUNG_DAUER_MIN],
    )
    return rows[0]?.sitzung_anlegen ?? null
  })
  return angelegt === null ? null : token
}

export async function sitzungAufloesen(token: string): Promise<Angemeldet | null> {
  if (token === '') return null

  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<{ benutzer_id: string; mandant_id: string }>(
      'select * from app.sitzung_aufloesen($1, $2)',
      [hash(token), SITZUNG_UNTAETIG_MIN],
    )
    const treffer = rows[0]
    if (treffer === undefined) return null
    return { benutzerId: treffer.benutzer_id, mandantId: treffer.mandant_id }
  })
}

export async function sitzungBeenden(token: string): Promise<void> {
  if (token === '') return
  await alsAnmeldung((c) => c.query('select app.sitzung_beenden($1)', [hash(token)]))
}

/**
 * Ordnet eine bestätigte Identität einem angelegten Benutzer zu.
 *
 * `null` heißt: Die Anmeldung war gültig, aber im DMS gibt es niemanden
 * dazu. Das ist der Normalfall bei einem neuen Kollegen — und der Grund,
 * warum hier kein Benutzer angelegt wird.
 */
export async function identitaetAufloesen(
  anbieter: string,
  externeKennung: string,
  email: string,
): Promise<string | null> {
  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<{ identitaet_aufloesen: string | null }>(
      'select app.identitaet_aufloesen($1, $2, $3)',
      [anbieter, externeKennung, email],
    )
    return rows[0]?.identitaet_aufloesen ?? null
  })
}

export async function anmeldungProtokollieren(
  ergebnis: 'unbekannt' | 'gesperrt' | 'abgelehnt',
  anbieter: string,
  hinweis: string | null = null,
): Promise<void> {
  await alsAnmeldung((c) =>
    c.query('select app.anmeldung_protokollieren($1, $2, $3)', [ergebnis, anbieter, hinweis]),
  )
}

/* ---------------------------------------------------------------------------
 * Der Zustand zwischen Hinweg und Rückweg
 * ------------------------------------------------------------------------ */

function geheimnis(): Buffer {
  const wert = process.env['DMS_SITZUNGS_GEHEIMNIS']
  if (wert === undefined || wert.length < 32) {
    // Kein Rückfall auf einen eingebauten Wert. Ein Vorgabegeheimnis, das in
    // der Entwicklung stillschweigend greift, greift irgendwann auch im
    // Betrieb -- und niemand merkt es, weil alles funktioniert.
    throw new Error(
      'DMS_SITZUNGS_GEHEIMNIS fehlt oder ist zu kurz (mindestens 32 Zeichen). ' +
        'Erzeugen mit: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    )
  }
  return Buffer.from(wert, 'utf8')
}

/**
 * Signiert den Anmeldezustand für das Zwischencookie.
 *
 * Das Cookie ist httpOnly und kurzlebig; die Signatur schließt zusätzlich den
 * Fall, dass jemand es von einer Nachbardomäne aus überschreibt und damit
 * seinen eigenen `state` unterschiebt.
 */
export function zustandVerpacken(zustand: unknown): string {
  const inhalt = Buffer.from(JSON.stringify(zustand), 'utf8').toString('base64url')
  const signatur = createHash('sha256')
    .update(geheimnis())
    .update('.')
    .update(inhalt, 'utf8')
    .digest('base64url')
  return `${inhalt}.${signatur}`
}

export function zustandAuspacken<T>(verpackt: string | undefined): T | null {
  if (verpackt === undefined) return null
  const trenner = verpackt.lastIndexOf('.')
  if (trenner <= 0) return null

  const inhalt = verpackt.slice(0, trenner)
  const signatur = verpackt.slice(trenner + 1)
  const erwartet = createHash('sha256')
    .update(geheimnis())
    .update('.')
    .update(inhalt, 'utf8')
    .digest('base64url')

  // Zeitkonstanter Vergleich: Ein früh abbrechender Vergleich verrät über die
  // Laufzeit, wie viele Zeichen stimmen.
  const a = Buffer.from(signatur, 'utf8')
  const b = Buffer.from(erwartet, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    return JSON.parse(Buffer.from(inhalt, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}
