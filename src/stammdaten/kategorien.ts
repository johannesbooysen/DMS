/**
 * Kategorien und ihre Steuerung.
 *
 * **Das hier ist die Vereinfachung gegenueber dem Vorgaengersystem.** Dort
 * ergibt sich der Ablauf aus Filtern ("Magneten"), die an vielen Ordnern
 * haengen: Welcher Beleg wohin geht, steht nirgends -- es entsteht daraus,
 * dass ein Stempel einen Status setzt, den der Filter eines anderen Ordners
 * faengt. Wer wissen will, was nach einem Schritt passiert, muss alle Filter
 * gleichzeitig lesen (docs/analyse-amagno-bestand.md, Abschnitt 1).
 *
 * Hier steht es in **einer Zeile je Kategorie**:
 *
 *   Kategorie ──> Spezialgebiet      ──> wer bearbeitet (ueber die Zustaendigkeit)
 *             ──> Prozessdefinition  ──> welcher Ablauf gilt
 *             ──> Konto              ──> worauf gebucht wird
 *             ──> Schluesselworte    ──> woran der Beleg erkannt wird
 *
 * Keine Bedingung, kein Filter. Bedingungen bleiben, wo sie hingehoeren: als
 * Verzweigung **innerhalb** eines Ablaufs ("ab 5.000 EUR zusaetzlich die
 * Geschaeftsleitung") -- dort stehen sie an einer Stelle und werden
 * mitsimuliert.
 *
 * **Zwei Rechte, nicht eines.** Spezialgebiet, Konto und Schluesselworte sind
 * Stammdatenpflege. Welcher **Ablauf** gilt, ist Ablaufkonfiguration -- wer
 * das bestimmt, bestimmt mittelbar, wer entscheiden darf. Ein Trigger haelt
 * die Grenze (Migration 20260911110000); diese Schicht prueft nichts nach,
 * sie zeigt nur an, was sinnvoll bedienbar ist.
 */

import { alsBenutzer } from '../db'
import { NichtErlaubt, type Eingaben } from './index'

export interface Kategoriezeile {
  id: string
  name: string
  kurzcode: string
  aktiv: boolean
  spezialgebietId: string | null
  spezialgebiet: string | null
  /** Wer das Spezialgebiet traegt -- der eigentliche Ertrag der Kette. */
  bearbeiter: string[]
  ablaufId: string | null
  ablauf: string | null
  kontoId: string | null
  konto: string | null
  schluesselwoerter: string[]
}

export interface Auswahlen {
  spezialgebiete: Array<{ wert: string; text: string }>
  ablaeufe: Array<{ wert: string; text: string }>
  konten: Array<{ wert: string; text: string }>
  kategorien: Array<{ wert: string; text: string }>
}

export interface Kreditorzeile {
  id: string
  name: string
  standardId: string | null
  standard: string | null
}

export interface Rechtelage {
  stammdaten: boolean
  prozess: boolean
}

/**
 * Eine Policy weist nicht ab, sie laesst die Zeile verschwinden -- ein
 * `update` ohne Recht meldet Erfolg mit null Zeilen. Deshalb wird die Wirkung
 * gezaehlt und nicht das Ausbleiben eines Fehlers geprueft.
 */
function mussGewirktHaben(zeilen: number | null): void {
  if (zeilen === 0) {
    throw new NichtErlaubt(
      'Die Änderung hat nichts bewirkt — der Eintrag ist für Sie nicht ' +
        'änderbar. Meist fehlt das Recht zur Stammdatenpflege.',
    )
  }
}

export async function rechtelageKategorien(benutzerId: string): Promise<Rechtelage> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ s: boolean; p: boolean }>(
      `select app.darf('stammdaten_pflegen') as s,
              app.darf('prozess_konfigurieren') as p`,
    )
    return { stammdaten: rows[0]?.s === true, prozess: rows[0]?.p === true }
  })
}

export async function kategorienLaden(benutzerId: string): Promise<Kategoriezeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      /*
       * Die Bearbeiter kommen als Feld mit, nicht als zweite Abfrage: Die
       * Frage "wer bekommt diese Belege" ist der Grund, warum jemand diese
       * Seite oeffnet. Sie in einem zweiten Aufruf zu holen hiesse, sie
       * irgendwann zu vergessen.
       *
       * `gruppe_id` zaehlt mit -- eine Zustaendigkeit kann an einer Gruppe
       * haengen, und eine Kategorie ohne sichtbaren Bearbeiter sieht sonst
       * unversorgt aus, obwohl sie es nicht ist.
       */
      `select og.id, og.name, og.kurzcode, og.aktiv, og.schluesselwoerter,
              og.spezialgebiet_id, sg.name as spezialgebiet,
              og.prozessdefinition_id,
              case when p.id is null then null
                   else p.belegart || ' · Fassung ' || p.version end as ablauf,
              og.konto_vorschlag_id,
              case when k.id is null then null
                   else k.kontonummer || ' ' || k.bezeichnung end as konto,
              coalesce((
                select array_agg(distinct coalesce(b.name, g.name) order by coalesce(b.name, g.name))
                  from spezialgebiet_zustaendigkeit sz
                  left join benutzer b on b.id = sz.benutzer_id
                  left join gruppe g on g.id = sz.gruppe_id
                 where sz.spezialgebiet_id = og.spezialgebiet_id
              ), '{}') as bearbeiter
         from ordnungsgruppe og
         left join spezialgebiet sg on sg.id = og.spezialgebiet_id
         left join prozessdefinition p on p.id = og.prozessdefinition_id
         left join konto k on k.id = og.konto_vorschlag_id
        order by og.sortierung, og.name`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      kurzcode: String(z['kurzcode']),
      aktiv: z['aktiv'] === true,
      spezialgebietId: z['spezialgebiet_id'] == null ? null : String(z['spezialgebiet_id']),
      spezialgebiet: z['spezialgebiet'] == null ? null : String(z['spezialgebiet']),
      bearbeiter: (z['bearbeiter'] as string[] | null) ?? [],
      ablaufId: z['prozessdefinition_id'] == null ? null : String(z['prozessdefinition_id']),
      ablauf: z['ablauf'] == null ? null : String(z['ablauf']),
      kontoId: z['konto_vorschlag_id'] == null ? null : String(z['konto_vorschlag_id']),
      konto: z['konto'] == null ? null : String(z['konto']),
      schluesselwoerter: (z['schluesselwoerter'] as string[] | null) ?? [],
    }))
  })
}

/** Die Listen fuer die Auswahlfelder. */
export async function auswahlenLaden(benutzerId: string): Promise<Auswahlen> {
  return alsBenutzer(benutzerId, async (c) => {
    const [sg, ab, ko, ka] = await Promise.all([
      c.query<{ id: string; name: string }>(
        'select id, name from spezialgebiet where aktiv order by name',
      ),
      // Nur **aktive** Fassungen: Eine Kategorie auf einen Entwurf zeigen zu
      // lassen hiesse, dass der Ablauf erst gilt, wenn jemand anders ihn
      // aktiviert -- bis dahin liefe der Beleg woandershin, ohne Hinweis.
      c.query<{ id: string; text: string }>(
        `select p.id, p.belegart || ' · Fassung ' || p.version as text
           from prozessdefinition p
          where p.status = 'aktiv'
          order by p.belegart, p.version desc`,
      ),
      c.query<{ id: string; text: string }>(
        `select k.id, k.kontonummer || ' ' || k.bezeichnung as text
           from konto k join kontenrahmen r on r.id = k.kontenrahmen_id
          where k.aktiv order by k.kontonummer`,
      ),
      c.query<{ id: string; name: string }>(
        'select id, name from ordnungsgruppe where aktiv order by sortierung, name',
      ),
    ])
    return {
      spezialgebiete: sg.rows.map((z) => ({ wert: z.id, text: z.name })),
      ablaeufe: ab.rows.map((z) => ({ wert: z.id, text: z.text })),
      konten: ko.rows.map((z) => ({ wert: z.id, text: z.text })),
      kategorien: ka.rows.map((z) => ({ wert: z.id, text: z.name })),
    }
  })
}

/** Kommagetrennte Eingabe in ein sauberes Feld. */
function worteLesen(roh: string | null | undefined): string[] {
  if (roh === undefined || roh === null) return []
  return [
    ...new Set(
      roh
        .split(',')
        .map((w) => w.trim())
        .filter((w) => w.length > 0),
    ),
  ]
}

/**
 * Setzt Spezialgebiet, Konto und Schluesselworte einer Kategorie.
 *
 * Der Ablauf wird hier **nicht** angefasst -- er hat ein eigenes Recht und
 * eine eigene Handlung. Eine gemeinsame Maske waere bequemer und wuerde bei
 * jedem Speichern ohne Ablaufrecht ganz fehlschlagen.
 */
export async function zuordnungSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `update ordnungsgruppe
          set spezialgebiet_id = $2,
              konto_vorschlag_id = $3,
              schluesselwoerter = $4
        where id = $1`,
      [
        f['id'],
        f['spezialgebiet'] === undefined || f['spezialgebiet'] === '' ? null : f['spezialgebiet'],
        f['konto'] === undefined || f['konto'] === '' ? null : f['konto'],
        worteLesen(f['schluesselwoerter']),
      ],
    )
    mussGewirktHaben(rowCount)
  })
}

/**
 * Legt fest, welcher Ablauf fuer eine Kategorie gilt.
 *
 * Verlangt `prozess_konfigurieren` -- nicht hier geprueft, sondern vom
 * Trigger `ordnungsgruppe_ablauf_recht`. Eine Pruefung an dieser Stelle waere
 * eine zweite Wahrheit neben der Datenbank, und die beiden liefen auseinander.
 */
export async function ablaufSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      'update ordnungsgruppe set prozessdefinition_id = $2 where id = $1',
      [f['id'], f['ablauf'] === undefined || f['ablauf'] === '' ? null : f['ablauf']],
    )
    mussGewirktHaben(rowCount)
  })
}

export async function kreditorenMitStandard(benutzerId: string): Promise<Kreditorzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select k.id, k.name, k.standard_ordnungsgruppe_id, og.name as standard
         from kreditor k
         left join ordnungsgruppe og on og.id = k.standard_ordnungsgruppe_id
        where k.status <> 'inaktiv'
        order by k.name`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      name: String(z['name']),
      standardId:
        z['standard_ordnungsgruppe_id'] == null
          ? null
          : String(z['standard_ordnungsgruppe_id']),
      standard: z['standard'] == null ? null : String(z['standard']),
    }))
  })
}

/** Die uebliche Kategorie eines Lieferanten -- Vorschlag, kein Zwang. */
export async function kreditorStandardSetzen(benutzerId: string, f: Eingaben): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      'update kreditor set standard_ordnungsgruppe_id = $2 where id = $1',
      [f['id'], f['kategorie'] === undefined || f['kategorie'] === '' ? null : f['kategorie']],
    )
    mussGewirktHaben(rowCount)
  })
}
