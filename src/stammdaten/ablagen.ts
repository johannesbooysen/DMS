/**
 * Ablagen -- wo ein Beleg liegt und wer ihn sieht (Migration 20261006150000).
 *
 * Ein Stammdatum des Hauses wie die Ordnungsgruppe, aber mit anderer
 * Wirkung: Die Ordnungsgruppe steuert Zustaendigkeit und Ablauf, die Ablage
 * steuert Sichtbarkeit und Rechte. Jede Ablage nennt die Belegarten, die
 * von selbst in ihr landen; eine ist die Vorgabe fuer den Rest.
 *
 * Rechte je Ablage stehen in `rolle_recht` mit `ablage_id` -- derselbe
 * Mechanismus wie Belegart und Ordnungsgruppe als Geltungsbereich, nur dass
 * dieser hier in der Sichtbarkeits-Policy wirkt (`dms.meine_ablagen()`).
 */

import { alsBenutzer } from '../db'
import { entwurfKopieren, hausstandard } from '../workflow/konfiguration'
import { mussGewirktHaben, NichtErlaubt, NichtMoeglich, type Eingaben } from './index'

export const BELEGARTEN = ['rechnung', 'gutschrift', 'mahnung', 'kundenrechnung', 'schriftverkehr', 'sonstiges'] as const

/**
 * Rechte, die sich je Ablage vergeben lassen -- genau die, die je Ablage
 * auch **wirken**: `ansehen` ueber die Sichtbarkeits-Policy, `bearbeiten`
 * beim Ablagewechsel (`dms.darf_in_ablage`). `dms.darf()` kennt die Ablage
 * nicht (Kopf der Migration 20261006150000); ein Haken an `kontieren` mit
 * Ablage saehe nach einer Grenze aus, die es nicht gibt. Wer ein weiteres
 * Recht hier aufnimmt, fuehrt vorher die Ablage durch dessen Pruefpfad.
 */
export const ABLAGE_RECHTE = ['ansehen', 'bearbeiten'] as const
export type Ablagerecht = (typeof ABLAGE_RECHTE)[number]

export interface Ablagezeile {
  id: string
  name: string
  kurzcode: string
  beschreibung: string | null
  belegarten: string[]
  istStandard: boolean
  sortierung: number
  aktiv: boolean
  /** Wie viele Belege liegen hier -- sichtbar fuer den Fragenden. */
  belege: number
}

export async function ablagenLaden(benutzerId: string): Promise<Ablagezeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select a.id, a.name, a.kurzcode, a.beschreibung, a.belegarten, a.ist_standard, a.sortierung, a.aktiv,
              (select count(*) from dokument d where d.ablage_id = a.id)::int as belege
         from ablage a
        order by a.aktiv desc, a.sortierung, a.name`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      kurzcode: String(z['kurzcode']),
      beschreibung: z['beschreibung'] == null ? null : String(z['beschreibung']),
      belegarten: (z['belegarten'] as string[] | null) ?? [],
      istStandard: z['ist_standard'] === true,
      sortierung: Number(z['sortierung']),
      aktiv: z['aktiv'] === true,
      belege: Number(z['belege']),
    }))
  })
}

/**
 * Nur die aktiven, in Reihenfolge -- fuer Auswahlfelder.
 *
 * Eigene Abfrage, nicht `ablagenLaden`: Das zaehlt je Ablage die Belege, und
 * das gehoert auf die Stammdatenseite, nicht in jede Belegansicht und jeden
 * Posteingang.
 */
export async function aktiveAblagen(benutzerId: string): Promise<Array<{ id: string; name: string; istStandard: boolean }>> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string; name: string; ist_standard: boolean }>(
      'select id, name, ist_standard from ablage where aktiv order by sortierung, name',
    )
    return rows.map((z) => ({ id: z.id, name: z.name, istStandard: z.ist_standard }))
  })
}

function belegartenLesen(roh: string | null | undefined): string[] {
  const liste = (roh ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')
  const unbekannt = liste.filter((b) => !(BELEGARTEN as readonly string[]).includes(b))
  if (unbekannt.length > 0) throw new NichtMoeglich(`Unbekannte Belegart: ${unbekannt.join(', ')}.`)
  return liste
}

function pflichttext(wert: string | null | undefined, was: string): string {
  const t = (wert ?? '').trim()
  if (t === '') throw new NichtMoeglich(`${was} ist Pflicht.`)
  return t
}

function schreibfehler(fehler: unknown): never {
  if (fehler instanceof Error && /row-level security/.test(fehler.message)) {
    throw new NichtErlaubt('Ablagen anlegen und ändern darf, wer Stammdaten pflegt.')
  }
  if (fehler instanceof Error && /ablage_mandant_id_kurzcode_key/.test(fehler.message)) {
    throw new NichtMoeglich('Den Kurzcode gibt es schon.')
  }
  if (fehler instanceof Error && /ablage_standard_idx/.test(fehler.message)) {
    throw new NichtMoeglich('Es gibt schon eine Standard-Ablage -- erst dort den Standard nehmen.')
  }
  throw fehler
}

export async function ablageAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const name = pflichttext(f['name'], 'Der Name')
  const kurzcode = pflichttext(f['kurzcode'], 'Der Kurzcode').toUpperCase()
  const belegarten = belegartenLesen(f['belegarten'])
  const beschreibung = (f['beschreibung'] ?? '').trim()
  const standard = f['standard'] === 'ja'
  return alsBenutzer(benutzerId, async (c) => {
    let neu: string | undefined
    try {
      if (standard) {
        await c.query('update ablage set ist_standard = false where ist_standard')
      }
      const { rows } = await c.query<{ id: string }>(
        `insert into ablage (mandant_id, name, kurzcode, beschreibung, belegarten, ist_standard,
                             sortierung)
         values (dms.mein_mandant(), $1, $2, $3, $4, $5,
                 coalesce((select max(sortierung) from ablage), 0) + 10)
         returning id`,
        [name, kurzcode, beschreibung === '' ? null : beschreibung, belegarten, standard],
      )
      neu = rows[0]?.id
    } catch (fehler) {
      schreibfehler(fehler)
    }
    if (neu !== undefined) await entwuerfeMitbringen(c, neu, belegarten)
  })
}

/**
 * Jede Belegart der Ablage bekommt einen Entwurf als Kopie des Hausstandards
 * (Migration 20261009100000) -- sofort unter Ablaeufe bearbeitbar; bis zur
 * Aktivierung gilt der Standard. Ohne das Recht, Ablaeufe zu konfigurieren,
 * entsteht kein Entwurf, und die Ablage entsteht trotzdem: Der Entwurf ist
 * ein Angebot, kein Bestandteil. Ein Sicherungspunkt je Belegart, weil ein
 * abgewiesener Insert sonst die ganze Transaktion verdirbt.
 */
async function entwuerfeMitbringen(c: import('pg').PoolClient, ablageId: string, belegarten: string[]): Promise<void> {
  for (const belegart of belegarten) {
    const standard = await hausstandard(c, belegart)
    if (standard === null) continue
    await c.query('savepoint entwurf')
    try {
      await entwurfKopieren(c, standard, { ablageId })
      await c.query('release savepoint entwurf')
    } catch {
      await c.query('rollback to savepoint entwurf')
    }
  }
}

/** Belegarten und Beschreibung einer Ablage neu setzen. */
export async function ablageAendern(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflichttext(f['id'], 'Die Ablage')
  const belegarten = belegartenLesen(f['belegarten'])
  const beschreibung = (f['beschreibung'] ?? '').trim()
  return alsBenutzer(benutzerId, async (c) => {
    const { rows: vorher } = await c.query<{ belegarten: string[] }>('select belegarten from ablage where id = $1', [id])
    const { rowCount } = await c.query(
      'update ablage set belegarten = $2, beschreibung = $3 where id = $1',
      [id, belegarten, beschreibung === '' ? null : beschreibung],
    )
    mussGewirktHaben(rowCount ?? 0)
    // Eine neu hinzugekommene Belegart bekommt ihren Entwurf wie beim Anlegen.
    const alt = new Set(vorher[0]?.belegarten ?? [])
    await entwuerfeMitbringen(c, id, belegarten.filter((b) => !alt.has(b)))
  })
}

/** Nur deaktivieren, nie loeschen: An der Ablage haengt die Sichtbarkeit ihrer Belege. */
export async function ablageUmschalten(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflichttext(f['id'], 'Die Ablage')
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ ist_standard: boolean; aktiv: boolean }>(
      'select ist_standard, aktiv from ablage where id = $1',
      [id],
    )
    if (rows[0]?.ist_standard && rows[0].aktiv) {
      throw new NichtMoeglich('Die Standard-Ablage lässt sich nicht deaktivieren -- erst eine andere zum Standard machen.')
    }
    const { rowCount } = await c.query('update ablage set aktiv = not aktiv where id = $1', [id])
    mussGewirktHaben(rowCount ?? 0)
  })
}

export async function ablageStandardSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  const id = pflichttext(f['id'], 'Die Ablage')
  return alsBenutzer(benutzerId, async (c) => {
    await c.query('update ablage set ist_standard = false where ist_standard and id <> $1', [id])
    const { rowCount } = await c.query('update ablage set ist_standard = true where id = $1 and aktiv', [id])
    // Ohne Recht bewirkt das zweite Update nichts, und alsBenutzer rollt das
    // erste zurueck -- der alte Standard geht nicht verloren.
    mussGewirktHaben(rowCount ?? 0)
  })
}

// ---------------------------------------------------------------------------
// Rechte je Ablage
// ---------------------------------------------------------------------------

export interface Ablagerechte {
  rolleId: string
  /** ablageId null = alle Ablagen. */
  eintraege: Array<{ aktion: Ablagerecht; ablageId: string | null }>
}

/** Die ablage-faehigen Rechte aller Rollen -- ohne Belegart- oder Gruppengeltung. */
export async function ablagerechteLaden(benutzerId: string): Promise<Ablagerechte[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ rolle_id: string; aktion: Ablagerecht; ablage_id: string | null }>(
      `select rr.rolle_id, rr.aktion, rr.ablage_id
         from rolle_recht rr
        where rr.belegart is null and rr.ordnungsgruppe_id is null
          and rr.aktion = any ($1::text[])
        order by rr.rolle_id, rr.aktion`,
      [ABLAGE_RECHTE as unknown as string[]],
    )
    const je = new Map<string, Ablagerechte>()
    for (const z of rows) {
      const e = je.get(z.rolle_id) ?? { rolleId: z.rolle_id, eintraege: [] }
      e.eintraege.push({ aktion: z.aktion, ablageId: z.ablage_id })
      je.set(z.rolle_id, e)
    }
    return [...je.values()]
  })
}

/**
 * Die Rechte einer Rolle je Ablage neu setzen -- als Ganzes.
 *
 * `eintraege` sind Paare "aktion|ablageId" beziehungsweise "aktion|alle".
 * Ersetzt werden nur die Rechte ohne Belegart- und Gruppengeltung; was ein
 * Preset mit Belegart gesetzt hat, bleibt. Verwaltungsrechte stehen nicht
 * zur Wahl -- sie gelten dem Haus, nicht einer Ablage.
 */
export async function ablagerechteSetzen(benutzerId: string, rolleId: string, eintraege: string[]): Promise<void> {
  const paare = eintraege.map((e) => {
    const [aktion, ablage] = e.split('|')
    if (!(ABLAGE_RECHTE as readonly string[]).includes(aktion ?? '')) {
      throw new NichtMoeglich(`Unbekanntes Recht: ${aktion ?? ''}.`)
    }
    return { aktion: aktion as Ablagerecht, ablageId: ablage === undefined || ablage === 'alle' ? null : ablage }
  })
  // "alle" schlaegt die Einzelwahl derselben Aktion -- sonst stuenden beide da,
  // und "warum darf er das" waere an zwei Stellen zu beantworten.
  const alleAktionen = new Set(paare.filter((p) => p.ablageId === null).map((p) => p.aktion))
  const bereinigt = paare.filter((p) => p.ablageId === null || !alleAktionen.has(p.aktion))

  return alsBenutzer(benutzerId, async (c) => {
    /*
     * Rechte sind additiv -- und die Rueckfallregel von dms.meine_ablagen
     * (ohne ein ansehen aus einer Rolle gelten alle Ablagen) wuerde das
     * umkehren: Wer einer Rolle mit "ansehen nur in Schriftverkehr" den
     * letzten Sicht-Haken nimmt, oeffnete ihren Traegern jede Ablage. Das
     * wird hier abgewiesen; Sicht entzieht man, indem man die Rolle
     * entzieht.
     */
    const { rows: bisher } = await c.query<{ n: string }>(
      `select count(*) as n from rolle_recht
        where rolle_id = $1 and aktion = 'ansehen' and belegart is null and ordnungsgruppe_id is null`,
      [rolleId],
    )
    if (Number(bisher[0]?.n ?? 0) > 0 && !bereinigt.some((p) => p.aktion === 'ansehen')) {
      throw new NichtMoeglich(
        'Ohne ein Sichtrecht gälten für die Träger dieser Rolle alle Ablagen. Zum Einschränken „ansehen“ auf einzelne Ablagen setzen; zum Entziehen die Rolle entziehen.',
      )
    }

    const geloescht = await c.query(
      `delete from rolle_recht
        where rolle_id = $1 and belegart is null and ordnungsgruppe_id is null
          and aktion = any ($2::text[])`,
      [rolleId, ABLAGE_RECHTE as unknown as string[]],
    )
    let eingefuegt = 0
    try {
      for (const p of bereinigt) {
        const { rowCount } = await c.query(
          `insert into rolle_recht (rolle_id, aktion, ablage_id) values ($1, $2, $3)`,
          [rolleId, p.aktion, p.ablageId],
        )
        eingefuegt += rowCount ?? 0
      }
    } catch (fehler) {
      if (fehler instanceof Error && /row-level security/.test(fehler.message)) {
        throw new NichtErlaubt('Rechte vergeben darf, wer Benutzer verwaltet.')
      }
      throw fehler
    }
    if ((geloescht.rowCount ?? 0) === 0 && eingefuegt === 0 && bereinigt.length > 0) {
      throw new NichtErlaubt('Die Änderung hat nichts bewirkt -- Rechte vergeben darf, wer Benutzer verwaltet.')
    }
  })
}
