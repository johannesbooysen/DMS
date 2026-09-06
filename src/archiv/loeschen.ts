/**
 * Löschen nach Fristablauf (Konzept §24.5).
 *
 * Die Kehrseite der Aufbewahrungspflicht — und der Punkt, an dem GoBD und
 * DSGVO in dieselbe Richtung zeigen: Was aufbewahrt werden musste, **darf**
 * danach nicht länger liegen. Bis hierher konnte das System nur aufbewahren
 * und einschränken; die Kandidatenliste stand seit Wochen, die Ausführung
 * fehlte.
 *
 * **Zwei Gründe, und sie sind verschieden.** Ein Löschanspruch wartet auf
 * eine Antwort — dort steht ein Mensch dahinter. Ein bloßer Fristablauf tut
 * das nicht, ist aber dieselbe Pflicht. Beides in einen Topf zu werfen
 * verschleiert, wo Eile geboten ist.
 *
 * **Gelöscht wird je Beleg, auf ausdrückliche Handlung.** Eine Funktion, die
 * alle fälligen Belege auf einmal räumt, wird irgendwann versehentlich
 * aufgerufen — und danach gibt es nichts, worauf man zurückgreifen könnte.
 * Die Datei im Objektspeicher räumt dagegen ein Durchgang ab: Sie ist
 * bereits gelöscht, das Aufräumen ist nur die Vollstreckung.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '@/ablage'
import { alsAnmeldung, alsBenutzer } from '@/db'

export type Loeschgrund = 'loeschanspruch' | 'fristablauf'

export interface Loeschkandidat {
  dokumentId: string
  grund: Loeschgrund
  aufbewahrungBis: string
  archiviertAm: string | null
  belegart: string
  objektnummer: string | null
}

export interface Loeschzeile {
  dokumentId: string
  grund: Loeschgrund
  aufbewahrungBis: string
  geloeschtAm: string
  geloeschtVon: string | null
  dateiOffen: boolean
}

/**
 * Belege, deren Aufbewahrung abgelaufen ist.
 *
 * Mit und ohne Löschanspruch — `app.loeschkandidaten` kennt nur die mit
 * Anspruch, und die anderen fielen bisher durch.
 */
export async function loeschfaellige(
  benutzerId: string,
  stichtag?: string,
): Promise<Loeschkandidat[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      // to_char: Ein `date` wird sonst zum Date-Objekt in Serverzeitzone,
      // und aus dem 31.12. wird der 30.12. -- bei einer Aufbewahrungsfrist
      // wäre das ein Tag zu früh gelöscht (Projektregel).
      `select dokument_id, grund,
              to_char(aufbewahrung_bis, 'YYYY-MM-DD') as aufbewahrung_bis,
              to_char(archiviert_am, 'YYYY-MM-DD') as archiviert_am,
              belegart, objektnummer
         from app.loeschfaellig(coalesce($1::date, current_date))`,
      [stichtag ?? null],
    )
    return rows.map((z) => ({
      dokumentId: String(z['dokument_id']),
      grund: String(z['grund']) as Loeschgrund,
      aufbewahrungBis: String(z['aufbewahrung_bis']),
      archiviertAm: z['archiviert_am'] == null ? null : String(z['archiviert_am']),
      belegart: String(z['belegart']),
      objektnummer: z['objektnummer'] == null ? null : String(z['objektnummer']),
    }))
  })
}

export class NichtLoeschbar extends Error {}

/**
 * Löscht einen Beleg endgültig.
 *
 * Die Datei bleibt zunächst liegen — sie wird vom Durchgang abgeräumt. Das
 * ist Absicht: Der Beleg ist mit dem Commit gelöscht, und ob der
 * Objektspeicher gerade erreichbar ist, darf daran nichts ändern.
 */
export async function endgueltigLoeschen(
  benutzerId: string,
  dokumentId: string,
): Promise<void> {
  try {
    const gefunden = await alsBenutzer(benutzerId, async (c) => {
      const { rows } = await c.query<{ ok: boolean }>(
        'select app.dokument_endgueltig_loeschen($1) as ok',
        [dokumentId],
      )
      return rows[0]?.ok === true
    })
    if (!gefunden) {
      throw new NichtLoeschbar('Der Beleg ist nicht erreichbar.')
    }
  } catch (fehler) {
    if (fehler instanceof NichtLoeschbar) throw fehler
    const text = fehler instanceof Error ? fehler.message : String(fehler)
    if (text.includes('aufzubewahren') || text.includes('Recht')) {
      throw new NichtLoeschbar(text.replace(/^.*?:\s*/, ''))
    }
    throw fehler
  }
}

/** Das Löschprotokoll — was bleibt, wenn ein Beleg geht. */
export async function loeschprotokoll(
  benutzerId: string,
  grenze = 200,
): Promise<Loeschzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select l.dokument_id, l.grund,
              to_char(l.aufbewahrung_bis, 'YYYY-MM-DD') as aufbewahrung_bis,
              to_char(l.geloescht_am, 'YYYY-MM-DD') as geloescht_am,
              b.name as geloescht_von,
              (l.storage_key is not null and l.datei_geloescht_am is null) as datei_offen
         from loeschung l
         left join benutzer b on b.id = l.geloescht_von
        order by l.geloescht_am desc
        limit $1`,
      [grenze],
    )
    return rows.map((z) => ({
      dokumentId: String(z['dokument_id']),
      grund: String(z['grund']) as Loeschgrund,
      aufbewahrungBis: String(z['aufbewahrung_bis']),
      geloeschtAm: String(z['geloescht_am']),
      geloeschtVon: z['geloescht_von'] == null ? null : String(z['geloescht_von']),
      dateiOffen: z['datei_offen'] === true,
    }))
  })
}

export interface Raeumbilanz {
  entfernt: number
  gescheitert: number
}

/**
 * Räumt die Dateien der gelöschten Belege ab.
 *
 * **Das Protokoll ist die Warteschlange** — dasselbe Muster wie beim
 * Ausgangsbuch und bei der Objektsperre, aus demselben Grund: Ein
 * zusätzlicher Auftrag wäre ein zweites Fehlerfenster für dieselbe Sache.
 *
 * **Mit der Fassung**, nicht ohne: Ein Löschen ohne Fassungskennung setzt
 * bei versionierten Eimern nur eine Löschmarke, und die Datei bliebe liegen
 * — unsichtbar und ungelöscht. Genau das wäre hier das Gegenteil des
 * Gewollten.
 *
 * Läuft ohne Benutzer (`alsAnmeldung`), weil der Worker keinen hat. Die
 * Funktionen dahinter sind `security definer` und prüfen selbst.
 */
export async function loeschdateienAbraeumen(
  ablage: Ablage,
  grenze = 200,
): Promise<Raeumbilanz> {
  const offen = await alsAnmeldung(async (c) => {
    const { rows } = await c.query<{
      dokument_id: string
      storage_key: string
      storage_fassung: string | null
    }>('select dokument_id, storage_key, storage_fassung from app.loeschung_dateien_offen($1)', [
      grenze,
    ])
    return rows
  })

  let entfernt = 0
  let gescheitert = 0

  for (const zeile of offen) {
    try {
      /*
       * Erst der Speicher, dann der Vermerk -- dieselbe Reihenfolge wie bei
       * der Objektsperre. Bricht es dazwischen ab, ist die Datei weg und der
       * Vermerk fehlt; der naechste Durchgang versucht es erneut, und ein
       * zweites Loeschen einer nicht mehr vorhandenen Datei ist harmlos.
       *
       * Andersherum stuende im Protokoll "abgeraeumt" ueber einer Datei, die
       * noch liegt -- und niemand faende sie je wieder.
       */
      await ablage.entfernen(zeile.storage_key, zeile.storage_fassung)

      await alsAnmeldung((c) =>
        c.query('select app.loeschung_datei_vermerken($1)', [zeile.dokument_id]),
      )
      entfernt += 1
    } catch {
      // Kein Ablageschluessel ins Log -- er traegt Mandant und Objekt
      // (Projektregel). Die Zeile bleibt offen und wird wieder aufgegriffen.
      gescheitert += 1
    }
  }

  return { entfernt, gescheitert }
}

/**
 * Wie viele Belege fällig sind — ohne die Liste zu laden.
 *
 * Für den Hinweis in der Oberfläche. Eine Zahl, die niemand sieht, führt zu
 * einem Archiv, das jahrelang nicht geräumt wird.
 */
export async function loeschfaelligeAnzahl(c: PoolClient): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    'select count(*) as n from app.loeschfaellig(current_date, 100000)',
  )
  return Number(rows[0]?.n ?? 0)
}
