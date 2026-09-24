/**
 * Angaben von Hand nachtragen -- die manuelle Zuordnung (Konzept 13: "rot:
 * Bearbeitung gestoppt, manuelle Zuordnung erzwungen").
 *
 * Ein Beleg, dem die Extraktion nichts abgewinnen konnte -- ein Scan ohne
 * Textebene, ein Foto, ein Beleg ohne eingerichtete Erkennung --, kommt
 * ohne Objekt und ohne Kreditor an. Ohne Objekt gibt es keine
 * Objektverantwortliche, die Aufgabe hat niemanden, und der Beleg stand bis
 * hierher in keinem Postfach: nur in der Suche, als "Ohne Bezeichnung".
 * Genau so ist der erste echte Scan beim Bedienen verschwunden.
 *
 * Jetzt: Wer den Beleg sehen darf, traegt Objekt, Gruppe, Kreditor,
 * Rechnungsnummer, Datum und Betrag nach. Danach laeuft die Pruefung noch
 * einmal, und die offenen Aufgaben ohne Traeger bekommen ihren Traeger --
 * ueber dieselbe Aufloesung, die die Engine beim Anlegen nimmt.
 *
 * Nur fuer Belege, die noch nicht archiviert sind; danach ist der Beleg fest
 * (Konzept 19), und die Trigger sagen das deutlicher als jede Meldung hier.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '../db'
import { plausibilitaetPruefen } from '../pruefung/plausibilitaet'
import { aufgabenNeuZuweisen } from '../workflow/engine'

export class NachtragAbgelehnt extends Error {}

export interface Nachtrag {
  objektId?: string | null
  ordnungsgruppeId?: string | null
  kreditorId?: string | null
  rechnungsnummer?: string | null
  /** YYYY-MM-DD */
  rechnungsdatum?: string | null
  brutto?: number | null
}

export interface Nachtragsauswahl {
  objekte: Array<{ id: string; objektnummer: string; bezeichnung: string }>
  gruppen: Array<{ id: string; name: string }>
  kreditoren: Array<{ id: string; name: string }>
}

/** Die Listen fuer das Formular -- alles unter der RLS, also nur das eigene Haus. */
export async function nachtragsauswahl(benutzerId: string): Promise<Nachtragsauswahl> {
  return alsBenutzer(benutzerId, async (c) => ({
    objekte: (
      await c.query<{ id: string; objektnummer: string; bezeichnung: string }>(
        'select id, objektnummer, bezeichnung from objekt order by objektnummer',
      )
    ).rows,
    gruppen: (
      await c.query<{ id: string; name: string }>(
        'select id, name from ordnungsgruppe where aktiv order by sortierung, name',
      )
    ).rows,
    kreditoren: (
      await c.query<{ id: string; name: string }>(
        "select id, name from kreditor where status = 'aktiv' order by name",
      )
    ).rows,
  }))
}

/** Ob am Beleg das fehlt, was ein Mensch nachtragen muesste. */
export function nachtragNoetig(zeile: {
  objektnummer: string | null
  kreditor: string | null
  belegart?: string | null
}): boolean {
  if (zeile.belegart === 'schriftverkehr') return zeile.objektnummer === null
  return zeile.objektnummer === null || zeile.kreditor === null
}

async function vorhanden(c: PoolClient, tabelle: 'objekt' | 'ordnungsgruppe' | 'kreditor', id: string): Promise<boolean> {
  // Tabellenname aus einer festen Liste, nicht aus der Eingabe. Unter der
  // RLS: Eine Kennung aus einem fremden Haus gibt es hier nicht.
  const { rows } = await c.query<{ id: string }>(`select id from ${tabelle} where id = $1`, [id])
  return rows[0] !== undefined
}

const leer = (w: string | null | undefined): string | null => {
  const t = (w ?? '').trim()
  return t === '' ? null : t
}

export async function angabenNachtragen(
  benutzerId: string,
  dokumentId: string,
  n: Nachtrag,
): Promise<{ neuZugewiesen: number }> {
  const objektId = leer(n.objektId)
  const ordnungsgruppeId = leer(n.ordnungsgruppeId)
  const kreditorId = leer(n.kreditorId)
  const rechnungsnummer = leer(n.rechnungsnummer)
  const rechnungsdatum = leer(n.rechnungsdatum)
  const brutto = n.brutto ?? null

  if (rechnungsdatum !== null && !/^\d{4}-\d{2}-\d{2}$/.test(rechnungsdatum)) {
    throw new NachtragAbgelehnt('Das Rechnungsdatum hat nicht die Form JJJJ-MM-TT.')
  }
  if (brutto !== null && (!Number.isFinite(brutto) || brutto < 0)) {
    throw new NachtragAbgelehnt('Der Betrag muss eine Zahl ab 0 sein.')
  }
  if (rechnungsnummer !== null && rechnungsnummer.length > 80) {
    throw new NachtragAbgelehnt('Die Rechnungsnummer ist zu lang.')
  }

  return alsBenutzer(benutzerId, async (c) => {
    const { rows: belege } = await c.query<{ status: string; belegart: string }>(
      'select status, belegart from dokument where id = $1',
      [dokumentId],
    )
    const beleg = belege[0]
    if (beleg === undefined) throw new NachtragAbgelehnt('Diesen Beleg gibt es nicht.')
    if (beleg.status === 'archiviert' || beleg.status === 'storniert') {
      throw new NachtragAbgelehnt('Der Beleg ist archiviert -- Änderungen nur über Storno und Neuerfassung.')
    }
    if (objektId !== null && !(await vorhanden(c, 'objekt', objektId))) {
      throw new NachtragAbgelehnt('Das gewählte Objekt gibt es nicht.')
    }
    if (ordnungsgruppeId !== null && !(await vorhanden(c, 'ordnungsgruppe', ordnungsgruppeId))) {
      throw new NachtragAbgelehnt('Die gewählte Ordnungsgruppe gibt es nicht.')
    }
    if (kreditorId !== null && !(await vorhanden(c, 'kreditor', kreditorId))) {
      throw new NachtragAbgelehnt('Den gewählten Kreditor gibt es nicht.')
    }

    const { rowCount } = await c.query(
      `update dokument
          set objekt_id = coalesce($2, objekt_id),
              ordnungsgruppe_id = coalesce($3, ordnungsgruppe_id)
        where id = $1`,
      [dokumentId, objektId, ordnungsgruppeId],
    )
    if (rowCount === 0) throw new NachtragAbgelehnt('Der Beleg lässt sich nicht ändern.')

    if (beleg.belegart !== 'schriftverkehr' && beleg.belegart !== 'sonstiges') {
      // Was ein Mensch eintraegt, gilt -- anders als bei der Extraktion, die
      // Vorhandenes nie ueberschreibt. Leere Felder lassen den Stand stehen.
      const jahr = rechnungsdatum === null ? null : Number(rechnungsdatum.slice(0, 4))
      await c.query(
        `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer, rechnungsdatum, brutto, wirtschaftsjahr)
         values ($1, $2, $3, $4::date, $5, $6)
         on conflict (dokument_id) do update set
           kreditor_id     = coalesce(excluded.kreditor_id, rechnung_fakten.kreditor_id),
           rechnungsnummer = coalesce(excluded.rechnungsnummer, rechnung_fakten.rechnungsnummer),
           rechnungsdatum  = coalesce(excluded.rechnungsdatum, rechnung_fakten.rechnungsdatum),
           brutto          = coalesce(excluded.brutto, rechnung_fakten.brutto),
           wirtschaftsjahr = coalesce(excluded.wirtschaftsjahr, rechnung_fakten.wirtschaftsjahr)`,
        [dokumentId, kreditorId, rechnungsnummer, rechnungsdatum, brutto, jahr],
      )
    }

    // Die Pruefung gegen den neuen Stand, dann die Aufgaben an ihre Traeger.
    await plausibilitaetPruefen(c, dokumentId)
    const neuZugewiesen = await aufgabenNeuZuweisen(c, dokumentId)
    return { neuZugewiesen }
  })
}
