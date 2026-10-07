/**
 * Verteilregeln fuer Schriftverkehr -- Stammdaten (Migration 20261006170000).
 *
 * Drei Dinge stellt das Haus hier ein: welche **Signalwoerter** ein
 * Schreiben wichtig machen und welchem Thema sie es zuordnen, welche
 * **Absender** fest an eine Person oder Gruppe gehen, und welche **Themen**
 * die Geschaeftsleitung sehen will (`ordnungsgruppe.gl_informieren`). Dazu
 * das **Kuerzel** am Benutzer, damit "z. Hd. AA" eine Person trifft.
 *
 * Schreiben darf, wer Stammdaten pflegt (Policy); gemessen wird an der
 * Wirkung (`mussGewirktHaben`), weil eine Policy nicht abweist, sondern die
 * Zeile verschwinden laesst.
 */

import { alsBenutzer } from '../db'
import { mussGewirktHaben, NichtErlaubt, NichtMoeglich, type Eingaben } from './index'

export const REGELARTEN = ['signalwort', 'absender'] as const
export type Regelart = (typeof REGELARTEN)[number]

export interface Regelzeile {
  id: string
  art: Regelart
  muster: string
  ordnungsgruppe: { id: string; name: string } | null
  wichtig: boolean
  empfaenger: { art: 'benutzer' | 'gruppe'; id: string; name: string } | null
  aktiv: boolean
}

export async function regelnLaden(benutzerId: string): Promise<Regelzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select r.id, r.art, r.muster, r.wichtig, r.aktiv,
              r.ordnungsgruppe_id, og.name as ordnungsgruppe_name,
              r.benutzer_id, b.name as benutzer_name, r.gruppe_id, g.name as gruppe_name
         from schriftverkehr_regel r
         left join ordnungsgruppe og on og.id = r.ordnungsgruppe_id
         left join benutzer b on b.id = r.benutzer_id
         left join gruppe g on g.id = r.gruppe_id
        order by r.art, r.aktiv desc, r.sortierung, r.muster`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      art: z['art'] as Regelart,
      muster: String(z['muster']),
      ordnungsgruppe:
        z['ordnungsgruppe_id'] == null ? null : { id: String(z['ordnungsgruppe_id']), name: String(z['ordnungsgruppe_name'] ?? '') },
      wichtig: z['wichtig'] === true,
      empfaenger:
        z['benutzer_id'] != null
          ? { art: 'benutzer', id: String(z['benutzer_id']), name: String(z['benutzer_name'] ?? '') }
          : z['gruppe_id'] != null
            ? { art: 'gruppe', id: String(z['gruppe_id']), name: String(z['gruppe_name'] ?? '') }
            : null,
      aktiv: z['aktiv'] === true,
    }))
  })
}

function pflichttext(wert: string | null | undefined, was: string): string {
  const t = (wert ?? '').trim()
  if (t === '') throw new NichtMoeglich(`${was} ist Pflicht.`)
  return t
}

function leer(wert: string | null | undefined): string | null {
  const t = (wert ?? '').trim()
  return t === '' ? null : t
}

function schreibfehler(fehler: unknown): never {
  if (fehler instanceof Error && /row-level security/.test(fehler.message)) {
    throw new NichtErlaubt('Verteilregeln pflegt, wer Stammdaten pflegen darf.')
  }
  if (fehler instanceof Error && /schriftverkehr_regel_mandant_id_art_muster_key/.test(fehler.message)) {
    throw new NichtMoeglich('Diese Regel gibt es schon.')
  }
  if (fehler instanceof Error && /schriftverkehr_regel_muster_check/.test(fehler.message)) {
    throw new NichtMoeglich('Das Muster hat zwei bis achtzig Zeichen.')
  }
  if (fehler instanceof Error && /gehoert nicht zu diesem Mandanten/.test(fehler.message)) {
    throw new NichtMoeglich('Thema oder Empfänger gehören nicht zu diesem Haus.')
  }
  throw fehler
}

/**
 * Eine Regel anlegen. `empfaenger` kommt als "benutzer:<id>" oder
 * "gruppe:<id>" aus einem Auswahlfeld -- ein Feld, zwei Tabellen.
 */
export async function regelAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const art = pflichttext(f['art'], 'Die Art')
  if (!(REGELARTEN as readonly string[]).includes(art)) throw new NichtMoeglich(`Unbekannte Regelart: ${art}.`)
  const muster = pflichttext(f['muster'], art === 'signalwort' ? 'Das Signalwort' : 'Der Absender')
  const ordnungsgruppeId = leer(f['ordnungsgruppeId'])
  const wichtig = f['wichtig'] === 'ja'
  const empfaengerRoh = leer(f['empfaenger'])
  let benutzerIdNeu: string | null = null
  let gruppeId: string | null = null
  if (empfaengerRoh !== null) {
    const [typ, id] = empfaengerRoh.split(':')
    if (typ === 'benutzer') benutzerIdNeu = id ?? null
    else if (typ === 'gruppe') gruppeId = id ?? null
    else throw new NichtMoeglich('Unbekannter Empfänger.')
  }
  if (art === 'signalwort' && ordnungsgruppeId === null && !wichtig) {
    throw new NichtMoeglich('Ein Signalwort braucht eine Wirkung: ein Thema, die Wichtig-Marke oder beides.')
  }
  if (art === 'absender' && ordnungsgruppeId === null && !wichtig && empfaengerRoh === null) {
    throw new NichtMoeglich('Eine Absenderregel braucht eine Wirkung: Empfänger, Thema oder Wichtig-Marke.')
  }
  return alsBenutzer(benutzerId, async (c) => {
    try {
      await c.query(
        `insert into schriftverkehr_regel (mandant_id, art, muster, ordnungsgruppe_id, wichtig, benutzer_id, gruppe_id, sortierung)
         values (dms.mein_mandant(), $1, $2, $3, $4, $5, $6,
                 coalesce((select max(sortierung) from schriftverkehr_regel), 0) + 10)`,
        [art, muster, ordnungsgruppeId, wichtig, benutzerIdNeu, gruppeId],
      )
    } catch (fehler) {
      schreibfehler(fehler)
    }
  })
}

export async function regelUmschalten(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflichttext(f['id'], 'Die Regel')
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query('update schriftverkehr_regel set aktiv = not aktiv where id = $1', [id])
    mussGewirktHaben(rowCount ?? 0)
  })
}

/** Welche Themen die Geschaeftsleitung sehen will -- als Ganzes aus Kontrollkaestchen. */
export async function glInformierenSetzen(benutzerId: string, gruppenIds: string[]): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows: vorher } = await c.query<{ id: string; gl: boolean }>(
      'select id, gl_informieren as gl from ordnungsgruppe',
    )
    const soll = new Set(gruppenIds)
    let betroffen = 0
    let geaendert = 0
    for (const g of vorher) {
      const neu = soll.has(g.id)
      if (neu === g.gl) continue
      geaendert += 1
      const { rowCount } = await c.query('update ordnungsgruppe set gl_informieren = $2 where id = $1', [g.id, neu])
      betroffen += rowCount ?? 0
    }
    if (geaendert > 0) mussGewirktHaben(betroffen)
  })
}

/** Das Kuerzel eines Benutzers -- leer loescht es. */
export async function kuerzelSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflichttext(f['id'], 'Der Benutzer')
  const kuerzel = leer(f['kuerzel'])
  if (kuerzel !== null && !/^[A-Za-zÄÖÜäöüß]{2,5}$/.test(kuerzel)) {
    throw new NichtMoeglich('Ein Kürzel hat zwei bis fünf Buchstaben.')
  }
  return alsBenutzer(benutzerId, async (c) => {
    try {
      const { rowCount } = await c.query('update benutzer set kuerzel = $2 where id = $1', [id, kuerzel?.toUpperCase() ?? null])
      mussGewirktHaben(rowCount ?? 0)
    } catch (fehler) {
      if (fehler instanceof Error && /benutzer_kuerzel_idx/.test(fehler.message)) {
        throw new NichtMoeglich('Dieses Kürzel trägt schon jemand.')
      }
      if (fehler instanceof Error && /row-level security/.test(fehler.message)) {
        throw new NichtErlaubt('Kürzel vergibt, wer Benutzer verwaltet.')
      }
      throw fehler
    }
  })
}
