/**
 * Verfahrensdokumentation — welche Fassung wann galt.
 *
 * Das dritte Stück der Revisionssicherheit (Konzept §24.4). Hash-Kette und
 * Objektsperre belegen, dass ein Beleg seit dem Archivieren derselbe ist. Sie
 * belegen nicht, **nach welchem Verfahren** er dorthin kam — und ohne diesen
 * Nachweis wird die Archivierung im Prüfungsfall nicht anerkannt.
 *
 * **Der Text steht nicht hier.** Er wird aus dem Repository erzeugt
 * (`npm run verfahrensdoku`) und liegt in `docs/verfahrensdokumentation.md`.
 * Dieses Modul kümmert sich um den Teil, den ein Dokument über sich selbst
 * nicht sagen kann: ab wann es gilt, und dass der vorgelegte Text der
 * freigegebene ist.
 *
 * **Freigeben ist eine eigene Handlung.** Nicht jeder erzeugte Stand ist eine
 * Fassung — sonst gäbe es je Commit eine, und die Frage „welches Verfahren
 * galt damals" hätte hundert Antworten im Jahr. Freigegeben wird, wenn sich
 * am Verfahren etwas geändert hat, das jemanden interessiert.
 */

import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'

export interface Fassung {
  version: string
  gueltigAb: string
  titel: string
  inhaltHash: string
  storageKey: string
  freigegebenAm: string
}

/** Wo eine Fassung in der Ablage liegt. */
export function fassungsSchluessel(version: string): string {
  return `verfahrensdoku/${version}.md`
}

export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Gibt eine Fassung frei.
 *
 * **Erst die Ablage, dann die Datenbank** — dieselbe Reihenfolge und derselbe
 * Grund wie bei der Objektsperre: Bricht es dazwischen ab, liegt eine Datei
 * herum, auf die niemand zeigt. Das ist harmlos. Andersherum stünde in der
 * Tabelle eine Fassung, deren Text nirgends liegt — und genau die würde in
 * einer Prüfung verlangt.
 */
export async function fassungFreigeben(
  c: PoolClient,
  ablage: Ablage,
  angaben: { version: string; gueltigAb: string; titel: string; text: string },
): Promise<{ id: string; inhaltHash: string; storageKey: string }> {
  const inhaltHash = textHash(angaben.text)
  const storageKey = fassungsSchluessel(angaben.version)

  await ablage.schreiben(storageKey, Buffer.from(angaben.text, 'utf8'))

  const { rows } = await c.query<{ verfahrensdoku_freigeben: string }>(
    'select app.verfahrensdoku_freigeben($1, $2::date, $3, $4, $5)',
    [angaben.version, angaben.gueltigAb, angaben.titel, inhaltHash, storageKey],
  )
  const id = rows[0]?.verfahrensdoku_freigeben
  if (id === undefined) {
    throw new Error('Die Freigabe hat keine Fassung angelegt.')
  }
  return { id, inhaltHash, storageKey }
}

/** Alle freigegebenen Fassungen, neueste zuerst. */
export async function fassungen(c: PoolClient): Promise<Fassung[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    // to_char: Ein `date` wird sonst zum Date-Objekt in Serverzeitzone, und
    // aus dem 01.01. wird der 31.12. -- bei einem Gueltigkeitsdatum waere das
    // ein Tag mit der falschen Fassung (Projektregel).
    `select version, to_char(gueltig_ab, 'YYYY-MM-DD') as gueltig_ab, titel,
            inhalt_hash, storage_key,
            to_char(freigegeben_am, 'YYYY-MM-DD') as freigegeben_am
       from verfahrensdokumentation
      order by gueltig_ab desc, freigegeben_am desc`,
  )
  return rows.map((z) => ({
    version: String(z['version']),
    gueltigAb: String(z['gueltig_ab']),
    titel: String(z['titel']),
    inhaltHash: String(z['inhalt_hash']),
    storageKey: String(z['storage_key']),
    freigegebenAm: String(z['freigegeben_am']),
  }))
}

/**
 * Prüft, ob der abgelegte Text einer Fassung noch der freigegebene ist.
 *
 * Der eigentliche Nachweis. Ohne ihn wäre die Kopie in der Ablage nur eine
 * Datei — mit ihm ist sie ein Beleg. Fehlt sie, ist das kein `false`, sondern
 * eine eigene Auskunft: „nicht auffindbar" und „verändert" sind verschiedene
 * Befunde und führen zu verschiedenen Handlungen.
 */
export async function fassungPruefen(
  c: PoolClient,
  ablage: Ablage,
  version: string,
): Promise<{ befund: 'unveraendert' | 'veraendert' | 'fehlt' | 'unbekannt' }> {
  const { rows } = await c.query<{ inhalt_hash: string; storage_key: string }>(
    'select inhalt_hash, storage_key from verfahrensdokumentation where version = $1',
    [version],
  )
  const z = rows[0]
  if (z === undefined) return { befund: 'unbekannt' }

  const inhalt = await ablage.lesen(z.storage_key).catch(() => null)
  if (inhalt === null) return { befund: 'fehlt' }

  return {
    befund: textHash(inhalt.toString('utf8')) === z.inhalt_hash ? 'unveraendert' : 'veraendert',
  }
}

/**
 * Archivierte Belege ohne Verfahrensdokumentation.
 *
 * Eine Lücke im Nachweis — entweder gab es beim Archivieren noch keine
 * Fassung, oder die Freigabe wurde vergessen. Beides fällt sonst erst in der
 * Prüfung auf, also dann, wenn es sich nicht mehr beheben lässt.
 */
export async function luecken(
  c: PoolClient,
): Promise<Array<{ dokumentId: string; archiviertAm: string }>> {
  const { rows } = await c.query<{ dokument_id: string; archiviert_am: string }>(
    `select dokument_id, to_char(archiviert_am, 'YYYY-MM-DD') as archiviert_am
       from app.archiv_ohne_verfahrensdoku()`,
  )
  return rows.map((z) => ({
    dokumentId: z.dokument_id,
    archiviertAm: z.archiviert_am,
  }))
}
