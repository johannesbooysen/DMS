/**
 * Sicherung und geprobter Restore (Konzept §24.7).
 *
 * „Ein Archiv ohne getesteten Restore ist kein Archiv."
 *
 * **Was hier steht, ist nicht die Sicherung, sondern die Frage danach.** Die
 * Sicherung macht `pg_dump`; sie ist ein gelöstes Problem. Ungelöst ist:
 * *Ist das Zurückgeholte noch dasselbe?* Ein `pg_restore` mit Rückgabewert 0
 * beantwortet das nicht — es sagt, dass Zeilen angekommen sind, nicht dass
 * die Hash-Kette trägt, dass die Dateien zu ihren Hashes passen und dass die
 * Zugriffsregeln noch greifen.
 *
 * Die drei Prüfungen sind bewusst getrennt, weil sie Verschiedenes bedeuten:
 *
 *   * **Kette** — wurde ein Ereignis nachträglich verändert?
 *   * **Dateien** — liegt zu jedem Archiveintrag noch die Datei, mit der er
 *     archiviert wurde?
 *   * **Schutz** — greifen RLS, Policies und die append-only-Trigger noch?
 *
 * Die dritte ist die stillste. Ein System ohne RLS sieht im Betrieb völlig
 * normal aus; es fällt erst auf, wenn jemand Daten sieht, die ihn nichts
 * angehen.
 *
 * **Dieselben Prüfungen laufen auch gegen die laufende Datenbank.** Eine
 * Probe, die nur nach einem Restore stattfindet, findet einen Schaden
 * frühestens dann — also womöglich Monate nachdem er entstanden ist, und
 * dann liegt er längst in allen Sicherungen.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '@/ablage'
import { inhaltHash } from '@/ablage'

export type Schwere = 'hart' | 'weich'

export interface Befund {
  art: string
  schwere: Schwere
  gegenstand: string
  text: string
}

export interface Pruefbericht {
  befunde: Befund[]
  geprueft: { ereignisse: number; archiveintraege: number; dateien: number }
}

/**
 * Rechnet die Hash-Kette nach.
 *
 * Leeres Ergebnis heißt unversehrt. Die Funktion in der Datenbank nagelt
 * Zeitzone und DateStyle fest — ohne das ergäbe dieselbe Kette auf einem
 * anders eingestellten Server lauter Abweichungen, und genau das passiert
 * bei einem Restore auf einen anderen Rechner.
 */
export async function kettePruefen(c: PoolClient): Promise<Befund[]> {
  const { rows } = await c.query<{ ereignis_id: string; folge: string; befund: string }>(
    'select ereignis_id, folge, befund from app.kette_pruefen(500)',
  )
  return rows.map((z) => ({
    art: z.befund,
    schwere: 'hart' as const,
    gegenstand: z.ereignis_id,
    text:
      z.befund === 'hash_falsch'
        ? `Stempelereignis ${z.folge} wurde nachträglich verändert.`
        : `Die Verkettung bricht bei Ereignis ${z.folge} — ein Eintrag fehlt oder wurde eingeschoben.`,
  }))
}

/** Greifen RLS, Policies und die Trigger noch? */
export async function schutzPruefen(c: PoolClient): Promise<Befund[]> {
  const { rows } = await c.query<{ gegenstand: string; art: string; befund: string }>(
    'select gegenstand, art, befund from app.schutz_pruefen()',
  )
  return rows.map((z) => ({
    art: z.art,
    schwere: 'hart' as const,
    gegenstand: z.gegenstand,
    text: z.befund,
  }))
}

/**
 * Liegt zu jedem Archiveintrag noch seine Datei — und ist es dieselbe?
 *
 * Die einzige Prüfung, die den Objektspeicher anfasst, und deshalb die
 * langsamste: Sie liest jede archivierte Datei und rechnet ihren SHA256
 * nach. Bei 25.000 Belegen im Jahr über zehn Jahre ist das nichts, was
 * nebenher läuft — deshalb `grenze`.
 *
 * **Mit der festgehaltenen Fassung gelesen** (`storage_fassung`). Ohne sie
 * käme bei einem überschriebenen Objekt die neue Fassung zurück, der Hash
 * schlüge fehl, und der Befund wäre richtig — aber die Reparatur unmöglich,
 * weil niemand mehr wüsste, wo das Original liegt.
 */
export async function dateienPruefen(
  c: PoolClient,
  ablage: Ablage,
  grenze = 500,
): Promise<{ befunde: Befund[]; geprueft: number }> {
  const { rows } = await c.query<{
    dokument_id: string
    hash_sha256: string
    storage_key: string | null
    storage_fassung: string | null
  }>(
    `select a.dokument_id, a.hash_sha256, a.storage_fassung,
            (select f.storage_key from dokument_datei f
              where f.dokument_id = a.dokument_id and f.variante = 'original'
              limit 1) as storage_key
       from archiv_eintrag a
      order by a.archiviert_am
      limit $1`,
    [grenze],
  )

  const befunde: Befund[] = []
  let geprueft = 0

  for (const z of rows) {
    if (z.storage_key === null) {
      befunde.push({
        art: 'datei_fehlt',
        schwere: 'hart',
        gegenstand: z.dokument_id,
        text: 'Der Archiveintrag verweist auf keine Datei.',
      })
      continue
    }

    const inhalt = await ablage.lesen(z.storage_key, z.storage_fassung).catch(() => null)
    if (inhalt === null) {
      befunde.push({
        art: 'datei_fehlt',
        schwere: 'hart',
        gegenstand: z.dokument_id,
        // Kein Ablageschluessel in der Meldung -- er traegt Mandant und
        // Objekt (Projektregel). Die Dokumentkennung genuegt zum Finden.
        text: 'Die archivierte Datei ist in der Ablage nicht auffindbar.',
      })
      continue
    }

    geprueft += 1
    if (inhaltHash(inhalt) !== z.hash_sha256) {
      befunde.push({
        art: 'hash_weicht_ab',
        schwere: 'hart',
        gegenstand: z.dokument_id,
        text:
          'Die Datei stimmt nicht mehr mit dem Hash überein, der beim ' +
          'Archivieren festgehalten wurde.',
      })
    }
  }

  return { befunde, geprueft }
}

/**
 * Alle drei Prüfungen zusammen.
 *
 * Die Reihenfolge ist die Reihenfolge der Bedeutung: Ein gebrochener Schutz
 * macht alles Weitere fraglich — wenn sich Ereignisse ändern lassen, sagt
 * eine stimmende Kette nichts mehr.
 */
export async function archivPruefen(
  c: PoolClient,
  ablage: Ablage,
  grenze = 500,
): Promise<Pruefbericht> {
  const schutz = await schutzPruefen(c)
  const kette = await kettePruefen(c)
  const dateien = await dateienPruefen(c, ablage, grenze)

  const { rows } = await c.query<{ ereignisse: string; archiveintraege: string }>(
    `select (select count(*) from stempel_ereignis) as ereignisse,
            (select count(*) from archiv_eintrag) as archiveintraege`,
  )

  return {
    befunde: [...schutz, ...kette, ...dateien.befunde],
    geprueft: {
      ereignisse: Number(rows[0]?.ereignisse ?? 0),
      archiveintraege: Number(rows[0]?.archiveintraege ?? 0),
      dateien: dateien.geprueft,
    },
  }
}

/**
 * Was in der Sicherung stehen muss, damit sich das Zurückgeholte prüfen
 * lässt.
 *
 * Ein Abbild allein genügt nicht: Wenn beim Zurückholen die Hälfte der
 * Belege fehlt, sieht die Datenbank in sich stimmig aus. Erst der Vergleich
 * mit den Zählwerten von vorher deckt es auf.
 */
export interface Manifest {
  erstellt: string
  zaehler: Record<string, number>
}

const GEZAEHLT = [
  'dokument',
  'dokument_datei',
  'stempel_ereignis',
  'archiv_eintrag',
  'kontierung',
  'rechnung_fakten',
  'schriftverkehr_fakten',
  'verfahrensdokumentation',
  'einsicht_gewaehrung',
  'zugriff_protokoll',
] as const

export async function manifestErstellen(c: PoolClient): Promise<Manifest> {
  const zaehler: Record<string, number> = {}
  for (const tabelle of GEZAEHLT) {
    // Tabellennamen aus einer festen Liste, nicht aus Eingaben -- eine
    // Zaehlabfrage laesst sich nicht parametrisieren.
    const { rows } = await c.query<{ n: string }>(`select count(*) as n from ${tabelle}`)
    zaehler[tabelle] = Number(rows[0]?.n ?? 0)
  }
  return { erstellt: new Date().toISOString(), zaehler }
}

/**
 * Vergleicht die Zählwerte nach dem Restore mit denen der Sicherung.
 *
 * **Nur „weniger" ist ein Befund, „mehr" nicht.** Eine Sicherung wird im
 * laufenden Betrieb gezogen; bis zum Ende des Abbilds können Belege
 * dazugekommen sein. Fehlende dagegen kann es nicht geben.
 */
export function manifestVergleichen(vorher: Manifest, nachher: Manifest): Befund[] {
  const befunde: Befund[] = []
  for (const [tabelle, erwartet] of Object.entries(vorher.zaehler)) {
    const ist = nachher.zaehler[tabelle] ?? 0
    if (ist < erwartet) {
      befunde.push({
        art: 'zeilen_fehlen',
        schwere: 'hart',
        gegenstand: tabelle,
        text: `${erwartet - ist} von ${erwartet} Zeilen fehlen nach dem Zurückholen.`,
      })
    }
  }
  return befunde
}
