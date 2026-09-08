/**
 * Notfallzugriff (Konzept §24.10).
 *
 * Fällt der einzige Zuständige eines Objekts aus, sieht niemand sonst dessen
 * Belege — die Objektsichtbarkeit hängt an `objekt_zustaendigkeit` und
 * `benutzer_rolle_objekt`. Skonti verfallen, Fristen laufen ab, und es fällt
 * erst auf, wenn jemand mahnt.
 *
 * **Reichweite, nie Art.** Ein Notfallzugriff erweitert den Geltungsbereich
 * vorhandener Rechte auf ein weiteres Objekt. Wer stempeln darf, stempelt
 * dort auch; wer es nie durfte, weiterhin nicht. Die Rollenvergabe bleibt
 * unberührt — genau deshalb steht danach in `benutzer_rolle_objekt` keine
 * Zuständigkeit, die es fachlich nie gab.
 *
 * Die ganze Wirkung sitzt in `app.meine_objekte()` und `app.darf()`; hier
 * steht nur das Anlegen, Beenden und Anzeigen. Wer die Regel sucht, findet
 * sie in der Migration `20260908100000`, nicht in diesem Modul.
 */

import type { PoolClient } from 'pg'

export class NichtErlaubt extends Error {}
export class NichtMoeglich extends Error {}

/** Höchstdauer, auch in der Datenbank als Check hinterlegt. */
export const HOECHSTDAUER_TAGE = 14

export interface Zugriff {
  id: string
  benutzerId: string
  benutzer: string
  objektId: string
  objektnummer: string
  objektname: string
  grund: string
  beginn: Date
  ende: Date
  /** Läuft dieser Zugriff auf den Angemeldeten selbst? */
  eigener: boolean
}

interface ZugriffZeile {
  id: string
  benutzer_id: string
  benutzer: string
  objekt_id: string
  objektnummer: string
  objektname: string
  grund: string
  beginn: Date
  ende: Date
  eigener: boolean
}

/**
 * Die laufenden Notfallzugriffe des Mandanten — **alle**, nicht nur die
 * eigenen.
 *
 * Das ist der Ersatz für die Vorabfreigabe, die im Notfall niemand geben
 * kann: Sichtbarkeit ist hier die Kontrolle. Wer nur seine eigenen sähe,
 * hätte eine leise Hintertür.
 */
export async function laufende(c: PoolClient): Promise<Zugriff[]> {
  const { rows } = await c.query<ZugriffZeile>(
    `select id, benutzer_id, benutzer, objekt_id, objektnummer, objektname,
            grund, beginn, ende, eigener
       from app.notfallzugriff_offen()`,
  )
  return rows.map((z) => ({
    id: z.id,
    benutzerId: z.benutzer_id,
    benutzer: z.benutzer,
    objektId: z.objekt_id,
    objektnummer: z.objektnummer,
    objektname: z.objektname,
    grund: z.grund,
    beginn: z.beginn,
    ende: z.ende,
    eigener: z.eigener,
  }))
}

export interface Antrag {
  benutzerId: string
  objektId: string
  grund: string
  tage: number
}

/**
 * Richtet einen befristeten Zugriff ein.
 *
 * Die Prüfungen stehen doppelt — hier und als Check in der Datenbank. Nicht
 * aus Misstrauen gegen die Datenbank, sondern weil ein Constraint-Fehler für
 * einen Menschen unbrauchbar ist: „violates check constraint
 * notfallzugriff_hoechstdauer" sagt nicht, was zu tun ist.
 */
export async function einrichten(c: PoolClient, antrag: Antrag): Promise<string> {
  const grund = antrag.grund.trim()
  if (grund.length < 10) {
    throw new NichtMoeglich(
      'Bitte einen Grund angeben (mindestens zehn Zeichen). Er erklärt den ' +
        'Zugriff, nicht die Abwesenheit — keine Angaben zur Gesundheit.',
    )
  }
  if (!Number.isInteger(antrag.tage) || antrag.tage < 1 || antrag.tage > HOECHSTDAUER_TAGE) {
    throw new NichtMoeglich(
      `Die Dauer muss zwischen 1 und ${HOECHSTDAUER_TAGE} Tagen liegen. Was ` +
        'länger dauert, ist kein Notfall mehr, sondern eine Zuständigkeit — ' +
        'und die gehört in die Stammdaten.',
    )
  }

  try {
    const { rows } = await c.query<{ id: string }>(
      `insert into notfallzugriff
         (mandant_id, benutzer_id, objekt_id, grund, ende, angelegt_von)
       values (app.mein_mandant(), $1, $2, $3,
               now() + make_interval(days => $4::integer), app.mein_benutzer())
       returning id`,
      [antrag.benutzerId, antrag.objektId, grund, antrag.tage],
    )
    const id = rows[0]?.id
    if (id === undefined) throw new NichtErlaubt(NICHT_ERLAUBT)
    return id
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler)
    if (text.includes('row-level security')) throw new NichtErlaubt(NICHT_ERLAUBT)
    if (text.includes('violates foreign key')) {
      throw new NichtMoeglich('Benutzer oder Objekt gibt es nicht (mehr).')
    }
    throw fehler
  }
}

const NICHT_ERLAUBT =
  'Dafür fehlt das Recht. Einen Notfallzugriff richtet ein, wer die Rolle ' +
  'mit dem Recht „notfallzugriff" trägt — es ist von der Benutzerverwaltung ' +
  'getrennt, weil es ein Vorgang mit Begründungspflicht ist.'

/**
 * Beendet einen laufenden Zugriff vorzeitig.
 *
 * **Null geänderte Zeilen heißt nicht erledigt.** Eine Policy weist nicht
 * ab, sie lässt die Zeile verschwinden — deshalb wird hier gezählt und nicht
 * das Ausbleiben eines Fehlers geprüft.
 */
export async function beenden(c: PoolClient, id: string): Promise<void> {
  const ergebnis = await c.query(
    `update notfallzugriff
        set beendet_am = now(), beendet_von = app.mein_benutzer()
      where id = $1 and beendet_am is null`,
    [id],
  )
  if (ergebnis.rowCount === 0) {
    throw new NichtErlaubt(
      'Der Zugriff wurde nicht beendet — entweder ist er schon beendet, oder ' +
        'das Recht dazu fehlt. Beenden darf, wer einrichten darf, und der ' +
        'Betroffene selbst.',
    )
  }
}

/**
 * Objekte, die für einen Notfallzugriff in Frage kommen: die des Mandanten,
 * die der Anfragende **nicht** ohnehin schon sieht.
 *
 * **Ohne `security definer`, mit einer benannten Einschränkung.** Die
 * Abfrage läuft unter der RLS, zeigt also nur, was der Anfragende ohnehin
 * sieht. Das trägt beide wirklichen Fälle: Die Geschäftsleitung, die den
 * Zugriff einrichtet, sieht mandantenweit; und wer die eigenen Objekte vor
 * dem Urlaub übergibt, sieht genau diese.
 *
 * Es trägt **nicht** den Fall, dass jemand mit dem Recht `notfallzugriff`,
 * aber ohne mandantenweite Sicht, ein fremdes Objekt abdecken soll — dann
 * steht es nicht in der Liste. Eine `security definer`-Umgehung wäre eine
 * zweite Stelle, an der die Mandantengrenze richtig sein muss, für einen
 * Fall, der eine falsch geschnittene Rolle beschreibt. Wer das Recht hat,
 * fremde Objekte abzudecken, braucht auch die Sicht darauf.
 */
export async function objekteZurAuswahl(
  c: PoolClient,
): Promise<{ id: string; objektnummer: string; name: string }[]> {
  const { rows } = await c.query<{ id: string; objektnummer: string; name: string }>(
    `select id, objektnummer, bezeichnung as name
       from objekt
      where mandant_id = app.mein_mandant()
      order by objektnummer`,
  )
  return rows
}

/** Aktive Benutzer des Mandanten, für die Auswahl im Formular. */
export async function benutzerZurAuswahl(
  c: PoolClient,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await c.query<{ id: string; name: string }>(
    `select id, name from benutzer
      where mandant_id = app.mein_mandant() and aktiv
      order by name`,
  )
  return rows
}

/**
 * Darf der Angemeldete einen Notfallzugriff einrichten?
 *
 * Nur für die Anzeige — die Grenze zieht die Policy. Eine Maske, die den
 * Knopf zeigt und danach abweist, ist ärgerlicher als eine ohne Knopf.
 */
export async function darfEinrichten(c: PoolClient): Promise<boolean> {
  const { rows } = await c.query<{ d: boolean }>("select app.darf('notfallzugriff') as d")
  return rows[0]?.d === true
}
