/**
 * Kreditorvorschlaege -- vom Rechnungssteller im Beleg zum Stammdatum.
 *
 * Die Aufbereitung meldet einen Vorschlag, wenn ein Rechnungssteller erkannt
 * wurde, den es als Kreditor nicht gibt (Migration 20260930100000). Hier
 * entscheidet ein Mensch mit Stammdatenrecht:
 *
 *   - **uebernehmen**: Kreditor anlegen (Name, USt-IdNr., E-Mail), die IBAN
 *     als Bankverbindung im Stand `neu` -- bestaetigt wird sie gesondert,
 *     das ist der Betrugsschutz --, und alle offenen Vorschlaege desselben
 *     Rechnungsstellers im Haus samt ihren Belegen zuordnen.
 *   - **zuordnen**: einem vorhandenen Kreditor -- der Name im Beleg wich nur
 *     ab (GmbH gegen GmbH & Co. KG).
 *   - **verwerfen**: kein Kreditor, etwa weil der Beleg gar keine Rechnung
 *     ist.
 *
 * Alles unter der RLS. Ohne das Recht bewirkt das Update null Zeilen, und
 * das wird gemeldet, nicht geschluckt (`mussGewirktHaben`).
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '../db'
import { plausibilitaetPruefen } from '../pruefung/plausibilitaet'
import { aufgabenNeuZuweisen } from '../workflow/engine'
import { NichtErlaubt, NichtMoeglich } from './index'

export interface Kreditorvorschlag {
  id: string
  dokumentId: string
  name: string
  ustId: string | null
  iban: string | null
  email: string | null
  status: string
  angelegtAm: string
  /** Zum Anzeigen: Rechnungsnummer und Betrag des Belegs, aus dem er stammt. */
  rechnungsnummer: string | null
  brutto: number | null
  /** Wie viele offene Vorschlaege denselben Rechnungssteller nennen -- sie werden mit uebernommen. */
  gleiche: number
}

const ABFRAGE = `
  select v.id, v.dokument_id, v.name, v.ust_id, v.iban, v.email, v.status, v.angelegt_am,
         f.rechnungsnummer, f.brutto,
         (select count(*) from kreditor_vorschlag w
           where w.mandant_id = v.mandant_id and w.status = 'offen' and w.id <> v.id
             and (lower(w.name) = lower(v.name) or (w.ust_id is not null and w.ust_id = v.ust_id))) as gleiche
    from kreditor_vorschlag v
    left join rechnung_fakten f on f.dokument_id = v.dokument_id`

function zeile(z: Record<string, unknown>): Kreditorvorschlag {
  const text = (w: unknown): string | null => (w == null ? null : String(w))
  return {
    id: String(z['id']),
    dokumentId: String(z['dokument_id']),
    name: String(z['name']),
    ustId: text(z['ust_id']),
    iban: text(z['iban']),
    email: text(z['email']),
    status: String(z['status']),
    angelegtAm: String(z['angelegt_am']),
    rechnungsnummer: text(z['rechnungsnummer']),
    brutto: z['brutto'] == null ? null : Number(z['brutto']),
    gleiche: Number(z['gleiche'] ?? 0),
  }
}

/** Alle offenen Vorschlaege des Hauses, aelteste zuerst. */
export async function vorschlaegeLaden(benutzerId: string): Promise<Kreditorvorschlag[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `${ABFRAGE} where v.status = 'offen' order by v.angelegt_am`,
    )
    return rows.map(zeile)
  })
}

/** Der offene Vorschlag zu einem Beleg -- fuer das Formular am Arbeitsplatz. */
export async function vorschlagZumBeleg(benutzerId: string, dokumentId: string): Promise<Kreditorvorschlag | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `${ABFRAGE} where v.dokument_id = $1 and v.status = 'offen'`,
      [dokumentId],
    )
    return rows[0] === undefined ? null : zeile(rows[0])
  })
}

export interface Uebernahme {
  name: string
  ustId?: string | null
  iban?: string | null
  email?: string | null
}

const leer = (w: string | null | undefined): string | null => {
  const t = (w ?? '').trim()
  return t === '' ? null : t
}

/**
 * Vorschlag uebernehmen: Kreditor anlegen und alle Belege dieses
 * Rechnungsstellers zuordnen. Gibt die Kennung des neuen Kreditors und die
 * Zahl der zugeordneten Belege zurueck.
 */
export async function vorschlagUebernehmen(
  benutzerId: string,
  vorschlagId: string,
  eingabe: Uebernahme,
): Promise<{ kreditorId: string; belege: number }> {
  const name = leer(eingabe.name)
  if (name === null) throw new NichtMoeglich('Der Name des Kreditors fehlt.')
  const ustId = leer(eingabe.ustId)
  const email = leer(eingabe.email)
  const iban = leer(eingabe.iban)?.replace(/\s+/g, '').toUpperCase() ?? null
  if (iban !== null && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) {
    throw new NichtMoeglich('Das sieht nicht wie eine IBAN aus.')
  }
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new NichtMoeglich('Das sieht nicht wie eine E-Mail-Adresse aus.')
  }

  return alsBenutzer(benutzerId, async (c) => {
    const vorschlag = await offenenVorschlag(c, vorschlagId)

    // Der Kreditor -- unter der Schreibpolicy. Ohne Recht: RLS-Fehler, den
    // die Aufrufer als NichtErlaubt lesen.
    let kreditorId: string
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into kreditor (mandant_id, name, ust_id, email)
         values (app.mein_mandant(), $1, $2, $3) returning id`,
        [name, ustId, email],
      )
      kreditorId = rows[0]!.id
    } catch (fehler) {
      throw uebersetzen(fehler)
    }
    if (iban !== null) {
      await c.query(
        `insert into kreditor_bankverbindung (kreditor_id, iban, status) values ($1, $2, 'neu')`,
        [kreditorId, iban],
      )
    }

    const belege = await zuordnen(c, benutzerId, vorschlag, kreditorId, 'uebernommen')
    return { kreditorId, belege }
  })
}

/** Vorschlag einem vorhandenen Kreditor zuordnen. */
export async function vorschlagZuordnen(
  benutzerId: string,
  vorschlagId: string,
  kreditorId: string,
): Promise<{ belege: number }> {
  return alsBenutzer(benutzerId, async (c) => {
    const vorschlag = await offenenVorschlag(c, vorschlagId)
    const { rows } = await c.query<{ id: string }>("select id from kreditor where id = $1 and status = 'aktiv'", [
      kreditorId,
    ])
    if (rows[0] === undefined) throw new NichtMoeglich('Diesen Kreditor gibt es nicht.')
    const belege = await zuordnen(c, benutzerId, vorschlag, kreditorId, 'zugeordnet')
    return { belege }
  })
}

export async function vorschlagVerwerfen(benutzerId: string, vorschlagId: string): Promise<void> {
  await alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `update kreditor_vorschlag
          set status = 'verworfen', entschieden_am = now(), entschieden_von = app.mein_benutzer()
        where id = $1 and status = 'offen'`,
      [vorschlagId],
    )
    mussGewirktHaben(rowCount ?? 0)
  })
}

async function offenenVorschlag(c: PoolClient, id: string): Promise<{ id: string; name: string; ustId: string | null }> {
  const { rows } = await c.query<{ id: string; name: string; ust_id: string | null }>(
    "select id, name, ust_id from kreditor_vorschlag where id = $1 and status = 'offen'",
    [id],
  )
  const v = rows[0]
  if (v === undefined) throw new NichtMoeglich('Diesen Vorschlag gibt es nicht mehr — er ist entschieden oder nicht sichtbar.')
  return { id: v.id, name: v.name, ustId: v.ust_id }
}

/**
 * Alle offenen Vorschlaege desselben Rechnungsstellers schliessen und ihre
 * Belege dem Kreditor geben -- wo noch keiner steht. Danach Pruefung und
 * Aufgaben je Beleg neu, wie beim Nachtragen.
 */
async function zuordnen(
  c: PoolClient,
  benutzerId: string,
  vorschlag: { id: string; name: string; ustId: string | null },
  kreditorId: string,
  ausgang: 'uebernommen' | 'zugeordnet',
): Promise<number> {
  const { rows: betroffen, rowCount } = await c.query<{ dokument_id: string }>(
    `update kreditor_vorschlag
        set status = $3, kreditor_id = $4, entschieden_am = now(), entschieden_von = app.mein_benutzer()
      where status = 'offen'
        and (id = $1 or lower(name) = lower($2) or ($5::text is not null and ust_id = $5))
      returning dokument_id`,
    [vorschlag.id, vorschlag.name, ausgang, kreditorId, vorschlag.ustId],
  )
  mussGewirktHaben(rowCount ?? 0)

  let belege = 0
  for (const { dokument_id } of betroffen) {
    const { rowCount: gesetzt } = await c.query(
      `insert into rechnung_fakten (dokument_id, kreditor_id) values ($1, $2)
       on conflict (dokument_id) do update set kreditor_id = coalesce(rechnung_fakten.kreditor_id, excluded.kreditor_id)
       where rechnung_fakten.kreditor_id is null`,
      [dokument_id, kreditorId],
    )
    if ((gesetzt ?? 0) > 0) {
      belege += 1
      await plausibilitaetPruefen(c, dokument_id)
      await aufgabenNeuZuweisen(c, dokument_id)
    }
  }
  void benutzerId
  return belege
}

function mussGewirktHaben(zeilen: number): void {
  if (zeilen === 0) {
    throw new NichtErlaubt(
      'Die Entscheidung hat nichts bewirkt — der Vorschlag ist für Sie nicht änderbar. Meist fehlt das Recht zur Stammdatenpflege.',
    )
  }
}

function uebersetzen(fehler: unknown): Error {
  const text = fehler instanceof Error ? fehler.message : String(fehler)
  if (text.includes('row-level security')) {
    return new NichtErlaubt('Dafür fehlt das Recht. Kreditoren legt an, wer Stammdaten pflegen darf.')
  }
  if (text.includes('duplicate key')) return new NichtMoeglich('Diesen Kreditor gibt es bereits.')
  return fehler instanceof Error ? fehler : new Error(text)
}
