/**
 * Stempeltypen und ihre Gestaltung -- die Fachschicht des Stempel-Designers.
 *
 * Ein Stempeltyp ist Ablaufkonfiguration (Migration 20260909100000): Wer
 * ihn anlegt oder aendert, bestimmt mittelbar, welche Entscheidungen es
 * gibt. Die Schreibpolicy verlangt deshalb `prozess_konfigurieren` -- hier
 * wird nichts nachgeprueft, die Wirkung wird gezaehlt.
 *
 * Was hier nicht steht: das Zielfeld. Ein Stempel traegt die Entscheidung,
 * nicht das Ziel -- wohin der Beleg danach geht, leitet die Engine ab. Das
 * war der Amagno-Fehler, den das Konzept behebt, und ein Designer, der ein
 * Zielfeld anboete, brachte ihn zurueck.
 */

import { alsBenutzer } from '../db'
import { gestaltungLesen, gestaltungPruefen, type Gestaltung } from '../layer/gestaltung'
import { NichtErlaubt, NichtMoeglich, type Eingaben } from './index'

export interface Stempeltypzeile {
  id: string
  name: string
  kurzcode: string
  entscheidung: string
  farbe: string
  sichtbarAufBeleg: boolean
  aktiv: boolean
  gestaltung: Gestaltung
  /** Wie oft der Typ an Stufen haengt -- ein Typ ohne Stufe wird nie gesetzt. */
  stufen: number
}

const ENTSCHEIDUNGEN = ['freigabe', 'ablehnung', 'rueckgabe', 'klaerung', 'systemaktion'] as const

function mussGewirktHaben(zeilen: number | null): void {
  if (zeilen === 0) {
    throw new NichtErlaubt(
      'Die Änderung hat nichts bewirkt — der Stempeltyp ist für Sie nicht ' +
        'änderbar. Stempel gestalten darf, wer Abläufe konfigurieren darf.',
    )
  }
}

export async function stempeltypenLaden(benutzerId: string): Promise<Stempeltypzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select t.id, t.name, t.kurzcode, t.entscheidung, t.farbe, t.sichtbar_auf_beleg,
              t.aktiv, t.gestaltung,
              (select count(*)::int from prozessstufe_stempeltyp st where st.stempeltyp_id = t.id) as stufen
         from stempeltyp t
        order by t.aktiv desc, t.entscheidung, t.name`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      kurzcode: String(z['kurzcode']),
      entscheidung: String(z['entscheidung']),
      farbe: z['farbe'] == null ? '#3B4A80' : String(z['farbe']),
      sichtbarAufBeleg: z['sichtbar_auf_beleg'] === true,
      aktiv: z['aktiv'] === true,
      gestaltung: gestaltungLesen(z['gestaltung']),
      stufen: Number(z['stufen']),
    }))
  })
}

export async function darfGestalten(benutzerId: string): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ darf: boolean }>(`select app.darf('prozess_konfigurieren') as darf`)
    return rows[0]?.darf === true
  })
}

/** Farbe als #rrggbb -- alles andere wird abgewiesen, nicht stillschweigend ersetzt. */
function farbeLesen(roh: string | null | undefined): string {
  const f = (roh ?? '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(f)) throw new NichtMoeglich('Die Farbe muss als #rrggbb angegeben sein.')
  return f.toUpperCase()
}

export async function stempeltypAnlegen(benutzerId: string, f: Eingaben): Promise<void> {
  const name = (f['name'] ?? '').trim()
  const kurzcode = (f['kurzcode'] ?? '').trim().toUpperCase()
  const entscheidung = f['entscheidung'] ?? ''
  if (name === '' || kurzcode === '') throw new NichtMoeglich('Name und Kurzcode sind Pflicht.')
  if (!(ENTSCHEIDUNGEN as readonly string[]).includes(entscheidung)) {
    throw new NichtMoeglich('Unbekannte Entscheidung.')
  }
  const farbe = farbeLesen(f['farbe'])

  return alsBenutzer(benutzerId, async (c) => {
    let angelegt: number | null
    try {
      const { rowCount } = await c.query(
        `insert into stempeltyp (mandant_id, name, kurzcode, entscheidung, farbe)
         select app.mein_mandant(), $1, $2, $3, $4
          where not exists (select 1 from stempeltyp where kurzcode = $2)`,
        [name, kurzcode, entscheidung, farbe],
      )
      angelegt = rowCount
    } catch (fehler) {
      // Anders als ein update ohne Recht (null Zeilen, kein Fehler) weist ein
      // insert die Zeile laut ab: "new row violates row-level security".
      // Fuer den Anwender ist es dieselbe Auskunft.
      if (fehler instanceof Error && /row-level security/.test(fehler.message)) {
        throw new NichtErlaubt('Stempeltypen anlegen darf, wer das Recht hat, Abläufe zu konfigurieren.')
      }
      throw fehler
    }
    if (angelegt === 0) {
      throw new NichtMoeglich(`Den Kurzcode ${kurzcode} gibt es schon.`)
    }
  })
}

export async function gestaltungSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  const felder = (f['felder'] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')
  const geprueft = gestaltungPruefen({
    felder,
    form: f['form'] ?? '',
    rahmen: f['rahmen'] ?? '',
    drehung: Number(f['drehung'] ?? 0),
    schrift: f['schrift'] ?? '',
  })
  if ('fehler' in geprueft) throw new NichtMoeglich(geprueft.fehler)
  const farbe = farbeLesen(f['farbe'])
  const sichtbar = f['sichtbar'] === 'ja'

  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `update stempeltyp
          set gestaltung = $2::jsonb, farbe = $3, sichtbar_auf_beleg = $4
        where id = $1`,
      [f['id'], JSON.stringify(geprueft.gestaltung), farbe, sichtbar],
    )
    mussGewirktHaben(rowCount)
  })
}

export async function stempeltypUmschalten(benutzerId: string, f: Eingaben): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query('update stempeltyp set aktiv = not aktiv where id = $1', [f['id']])
    mussGewirktHaben(rowCount)
  })
}
