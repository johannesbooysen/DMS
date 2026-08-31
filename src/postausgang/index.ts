/**
 * Postausgang: Vorlage füllen, in das Ausgangsbuch legen, senden.
 *
 * Der Ablauf ist bewusst zweigeteilt:
 *
 *   1. **Anlegen** geschieht in derselben Transaktion wie der Anlass. Einen
 *      Zahlungsauftrag ohne Ausgangseintrag oder einen Eintrag ohne Zahlung
 *      gibt es damit nicht.
 *   2. **Senden** geschieht später, im Worker. Ein hängender Mailserver darf
 *      keinen Stempel blockieren.
 *
 * Das kehrt eine frühere Entscheidung um. Bei der Zahlungsübergabe stand:
 * lieber gar nicht übergeben, als eine Zahlung als übergeben zu vermerken,
 * die nie jemanden erreicht — sonst verschwindet der Beleg aus allen Listen.
 * Mit dem Ausgangsbuch verschwindet er nicht: Der fehlgeschlagene Eintrag
 * steht sichtbar da, mit Grund und Anzahl der Versuche.
 */

import type { PoolClient } from 'pg'
import { alsAnmeldung, alsBenutzer } from '@/db'
import { alsDatum, alsZeitpunkt } from '@/datum'
import { vorlageFuellen, type Werte } from './vorlagen'
import { versandAusUmgebung, VersandNichtEingerichtet, type Versand } from './versand'

export * from './vorlagen'
export * from './versand'

export class PostAbgelehnt extends Error {}

export interface Ausgangszeile {
  ausgangId: string
  dokumentId: string | null
  anlass: string
  empfaenger: string
  betreff: string
  status: string
  versuche: number
  angelegtAm: string
  gesendetAm: string | null
  fehler: string | null
}

/**
 * Legt einen Ausgang an — aus einer laufenden Transaktion heraus.
 *
 * `c` ist Pflicht und kein Komfort: Der Eintrag soll gemeinsam mit seinem
 * Anlass festgeschrieben werden. Wer ihn ohne Transaktion anlegen will, hat
 * keinen Anlass.
 */
export async function postAnlegen(
  c: PoolClient,
  eingabe: {
    schluessel: string
    anlass: string
    empfaenger: string
    dokumentId?: string | null
    werte: Werte
    anhang?: { schluessel: string; name: string } | null
    /**
     * Der Text enthält ein Geheimnis und wird nach dem Senden entfernt.
     * Heute nur der Einsichts-Token; siehe die Migration
     * `20260831260000_ausgang_fluechtig.sql`.
     */
    fluechtig?: boolean
  },
): Promise<string> {
  const { rows: vorlagen } = await c.query<{ betreff: string; text: string }>(
    'select betreff, text from vorlage where schluessel = $1 and aktiv',
    [eingabe.schluessel],
  )
  const vorlage = vorlagen[0]
  if (vorlage === undefined) {
    throw new PostAbgelehnt(
      `Für „${eingabe.schluessel}" ist keine aktive Vorlage hinterlegt.`,
    )
  }

  const werte: Werte = { heute: new Date().toISOString().slice(0, 10), ...eingabe.werte }
  const betreff = vorlageFuellen(vorlage.betreff, werte)
  const text = vorlageFuellen(vorlage.text, werte)

  const { rows } = await c.query<{ ausgang_anlegen: string }>(
    'select app.ausgang_anlegen($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      eingabe.dokumentId ?? null,
      eingabe.anlass,
      eingabe.empfaenger,
      betreff.text,
      text.text,
      eingabe.anhang?.schluessel ?? null,
      eingabe.anhang?.name ?? null,
      eingabe.fluechtig ?? false,
    ],
  )
  return rows[0].ausgang_anlegen
}

/**
 * Sendet, was offen ist.
 *
 * Läuft im Worker. Ohne eingerichteten Versand passiert **nichts** — die
 * Einträge bleiben offen und sichtbar, statt als gesendet vermerkt zu werden.
 */
export async function postSenden(
  ablage: { lesen(schluessel: string): Promise<Buffer> },
  versand: Versand | null = versandAusUmgebung(),
  grenze = 50,
): Promise<{ gesendet: number; gescheitert: number }> {
  if (versand === null) return { gesendet: 0, gescheitert: 0 }

  const offen = await alsAnmeldung(async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select * from app.ausgang_offen($1)',
      [grenze],
    )
    return rows
  })

  let gesendet = 0
  let gescheitert = 0

  for (const eintrag of offen) {
    const id = String(eintrag['ausgang_id'])
    try {
      const anhangKey = eintrag['anhang_key']
      const anhang =
        anhangKey == null
          ? undefined
          : {
              name: String(eintrag['anhang_name'] ?? 'anhang'),
              inhalt: await ablage.lesen(String(anhangKey)),
              mime: 'application/octet-stream',
            }

      await versand.senden({
        an: String(eintrag['empfaenger']),
        betreff: String(eintrag['betreff']),
        text: String(eintrag['text']),
        anhang,
      })
      await vermerken(id, true, null)
      gesendet += 1
    } catch (fehler) {
      // Der Grund kommt ins Ausgangsbuch, nicht ins Log: Er kann die
      // Empfängeradresse enthalten, und Logs sind kein Ort für
      // personenbezogene Daten (Projektregel). Im Ausgangsbuch steht sie
      // ohnehin.
      const grund = fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'
      await vermerken(id, false, grund.slice(0, 500))
      gescheitert += 1
    }
  }

  return { gesendet, gescheitert }
}

async function vermerken(
  ausgangId: string,
  erfolg: boolean,
  fehler: string | null,
): Promise<void> {
  await alsAnmeldung((c) =>
    c.query('select app.ausgang_vermerken($1, $2, $3)', [ausgangId, erfolg, fehler]),
  )
}

/** Einen fehlgeschlagenen Eintrag wieder auf offen setzen. */
export async function postWiederholen(
  benutzerId: string,
  ausgangId: string,
): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    // Über die Anwendungsrolle und damit unter der RLS: Wer den Mandanten
    // nicht sieht, wiederholt auch nichts.
    const { rowCount } = await c.query(
      `update ausgang set status = 'offen', fehler = null
        where id = $1 and status = 'fehlgeschlagen'
          and mandant_id = (select app.mein_mandant())`,
      [ausgangId],
    )
    return (rowCount ?? 0) > 0
  })
}

export async function ausgangsbuchLaden(
  benutzerId: string,
  optionen: { nurOffen?: boolean } = {},
): Promise<Ausgangszeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select id, dokument_id, anlass, empfaenger, betreff, status, versuche,
              angelegt_am, gesendet_am, fehler
         from ausgang
        where ($1::boolean is not true or status <> 'gesendet')
        order by angelegt_am desc
        limit 200`,
      [optionen.nurOffen ?? false],
    )
    return rows.map((z) => ({
      ausgangId: String(z['id']),
      dokumentId: z['dokument_id'] == null ? null : String(z['dokument_id']),
      anlass: String(z['anlass']),
      empfaenger: String(z['empfaenger']),
      betreff: String(z['betreff']),
      status: String(z['status']),
      versuche: Number(z['versuche']),
      angelegtAm: alsZeitpunkt(z['angelegt_am']) ?? '',
      gesendetAm: alsZeitpunkt(z['gesendet_am']),
      fehler: z['fehler'] == null ? null : String(z['fehler']),
    }))
  })
}

/* ---------------------------------------------------------------------------
 * Vorlagen verwalten
 * ------------------------------------------------------------------------ */

export interface Vorlagenzeile {
  id: string
  schluessel: string
  name: string
  betreff: string
  text: string
  aktiv: boolean
  geaendertAm: string
}

export async function vorlagenLaden(benutzerId: string): Promise<Vorlagenzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select id, schluessel, name, betreff, text, aktiv, geaendert_am from vorlage order by name',
    )
    return rows.map((z) => ({
      id: String(z['id']),
      schluessel: String(z['schluessel']),
      name: String(z['name']),
      betreff: String(z['betreff']),
      text: String(z['text']),
      aktiv: Boolean(z['aktiv']),
      geaendertAm: alsDatum(z['geaendert_am']) ?? '',
    }))
  })
}

export { VersandNichtEingerichtet }
