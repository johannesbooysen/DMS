/**
 * Systemaktionen -- die Stufe, die niemand stempelt.
 *
 * Erreicht der Lauf eine Stufe vom Typ `systemaktion`, fuehrt die Engine
 * sie selbst aus: eine Vorlage aus dem Postausgang, gefuellt mit den Werten
 * des Belegs, als Eintrag im Ausgangsbuch (`postAnlegen`, in derselben
 * Transaktion wie der Schritt). Danach gilt die Stufe als erledigt, und der
 * Lauf rueckt weiter -- ohne dass jemand klickt.
 *
 * **Was hier bewusst nicht passiert:** Ein Lauf haelt nie an einer Mail.
 * Fehlt die Vorlage oder der Empfaenger, wird das im Fehlerkorb gemeldet
 * (sichtbar, mit Grund), und der Beleg laeuft weiter. Eine Rechnung, die
 * wegen einer fehlenden E-Mail-Adresse nie zur sachlichen Pruefung kommt,
 * waere der schlechtere Fehler.
 *
 * Empfaenger: eine feste Adresse (Technik-Datenbank, Versicherung), die
 * Objektverantwortliche (ueber ihre Benutzerkennung) oder der Kreditor des
 * Belegs (`kreditor.email`, Migration 20260926120000) -- die ausfuehrende
 * Firma, an die die Abtretungserklaerung geht (Konzept 10).
 */

import type { PoolClient } from 'pg'
import { PostAbgelehnt, postAnlegen, type Werte } from '../postausgang'
import type { Stufe } from './baum'

export const EMPFAENGERARTEN = ['adresse', 'objektverantwortlich', 'kreditor'] as const
export type Empfaengerart = (typeof EMPFAENGERARTEN)[number]

export const EMPFAENGERART_NAMEN: Record<Empfaengerart, string> = {
  adresse: 'feste Adresse',
  objektverantwortlich: 'Objektverantwortliche',
  kreditor: 'Kreditor des Belegs',
}

export interface Systemaktion {
  /** Schluessel der Vorlage (`vorlage.schluessel`), nicht ihre Kennung. */
  vorlage: string
  empfaenger: Empfaengerart
  /** Nur bei `adresse`. */
  adresse: string | null
}

export class SystemaktionUngueltig extends Error {}

/**
 * Liest die Aktion aus dem jsonb der Stufe -- streng, ueber eine Weissliste.
 * Was nicht passt, ist `null`, nie ein halbes Objekt.
 */
export function systemaktionLesen(roh: unknown): Systemaktion | null {
  if (roh === null || typeof roh !== 'object') return null
  const o = roh as Record<string, unknown>
  const vorlage = typeof o['vorlage'] === 'string' ? o['vorlage'].trim() : ''
  const empfaenger = o['empfaenger']
  if (vorlage === '' || !(EMPFAENGERARTEN as readonly unknown[]).includes(empfaenger)) return null
  const adresse =
    typeof o['adresse'] === 'string' && o['adresse'].trim() !== '' ? o['adresse'].trim() : null
  return { vorlage, empfaenger: empfaenger as Empfaengerart, adresse }
}

/** Fachliche Pruefung der Eingabe aus dem Formular -- ohne Datenbank. */
export function systemaktionPruefen(eingabe: {
  vorlage: string
  empfaenger: string
  adresse: string | null
}): Systemaktion {
  const vorlage = eingabe.vorlage.trim()
  if (vorlage === '') throw new SystemaktionUngueltig('Eine Systemaktion braucht eine Vorlage.')
  if (!(EMPFAENGERARTEN as readonly string[]).includes(eingabe.empfaenger)) {
    throw new SystemaktionUngueltig(`Unbekannte Empfängerart: ${eingabe.empfaenger}`)
  }
  const empfaenger = eingabe.empfaenger as Empfaengerart
  const adresse = eingabe.adresse?.trim() ?? ''
  if (empfaenger === 'adresse') {
    if (adresse === '' || adresse.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse)) {
      throw new SystemaktionUngueltig('Die feste Adresse muss eine E-Mail-Adresse sein.')
    }
    return { vorlage, empfaenger, adresse }
  }
  return { vorlage, empfaenger, adresse: null }
}

/** Was in der Vorlage stehen kann -- die Werte des Belegs, sonst nichts. */
async function werteLaden(
  c: PoolClient,
  dokumentId: string,
): Promise<{
  werte: Werte
  verantwortlich: { email: string; name: string } | null
  kreditor: { email: string; name: string } | null
}> {
  const { rows } = await c.query<Record<string, string | null>>(
    `select k.name as kreditor, k.email as kreditor_email, f.rechnungsnummer,
            to_char(f.brutto, 'FM999G999G990D00') as betrag,
            o.objektnummer || ' — ' || o.bezeichnung as objekt,
            to_char(f.zahlungsziel, 'DD.MM.YYYY') as faellig,
            b.email as verantwortlich_email, b.name as verantwortlich_name
       from dokument d
       left join rechnung_fakten f on f.dokument_id = d.id
       left join kreditor k on k.id = f.kreditor_id
       left join objekt o on o.id = d.objekt_id
       left join lateral (
         select z.benutzer_id from objekt_zustaendigkeit z
          where z.objekt_id = d.objekt_id and z.art = 'hauptverantwortlich'
            and z.gueltig_von <= current_date
            and (z.gueltig_bis is null or z.gueltig_bis >= current_date)
          order by z.gueltig_von desc limit 1
       ) z on true
       left join benutzer b on b.id = z.benutzer_id
      where d.id = $1`,
    [dokumentId],
  )
  const z = rows[0]
  if (z === undefined) return { werte: {}, verantwortlich: null, kreditor: null }
  const werte: Werte = {}
  if (z['kreditor']) werte.kreditor = z['kreditor']
  if (z['rechnungsnummer']) werte.rechnungsnummer = z['rechnungsnummer']
  if (z['betrag']) werte.betrag = `${z['betrag']} EUR`
  if (z['objekt']) werte.objekt = z['objekt']
  if (z['faellig']) werte.faellig = z['faellig']
  const verantwortlich =
    z['verantwortlich_email'] && z['verantwortlich_name']
      ? { email: z['verantwortlich_email'], name: z['verantwortlich_name'] }
      : null
  const kreditor =
    z['kreditor_email'] && z['kreditor'] ? { email: z['kreditor_email'], name: z['kreditor'] } : null
  return { werte, verantwortlich, kreditor }
}

/**
 * Fuehrt die Aktion einer Stufe aus. Gibt zurueck, ob ein Ausgang entstand;
 * wenn nicht, steht der Grund im Fehlerkorb -- **nicht** als Ausnahme, weil
 * der Lauf weitergehen soll.
 */
export async function systemaktionAusfuehren(
  c: PoolClient,
  dokumentId: string,
  stufe: Stufe,
): Promise<boolean> {
  const melden = async (grund: string): Promise<false> => {
    // Grund ohne Belegdaten: Bezeichnung der Stufe und Art des Fehlers.
    await c.query('select app.verarbeitungsfehler_melden($1, null, $2, $3)', [
      dokumentId,
      'systemaktion',
      `Systemaktion „${stufe.bezeichnung}“: ${grund}`,
    ])
    return false
  }

  const aktion = stufe.systemaktion
  if (aktion === null) return melden('keine Vorlage und kein Empfänger hinterlegt.')

  const { werte, verantwortlich, kreditor } = await werteLaden(c, dokumentId)
  let empfaenger: string
  if (aktion.empfaenger === 'adresse') {
    if (aktion.adresse === null) return melden('keine feste Adresse hinterlegt.')
    empfaenger = aktion.adresse
  } else if (aktion.empfaenger === 'kreditor') {
    if (kreditor === null) return melden('der Kreditor des Belegs hat keine E-Mail-Adresse.')
    empfaenger = kreditor.email
    werte.empfaenger = kreditor.name
  } else {
    if (verantwortlich === null) return melden('kein Objektverantwortlicher mit E-Mail-Adresse.')
    empfaenger = verantwortlich.email
    werte.empfaenger = verantwortlich.name
  }

  try {
    await postAnlegen(c, {
      schluessel: aktion.vorlage,
      anlass: `Systemaktion „${stufe.bezeichnung}“`,
      empfaenger,
      dokumentId,
      werte,
    })
  } catch (fehler) {
    // Fehlende oder inaktive Vorlage. Alles andere ist ein echter Fehler
    // und bleibt einer.
    if (fehler instanceof PostAbgelehnt) return melden(fehler.message)
    throw fehler
  }
  return true
}
