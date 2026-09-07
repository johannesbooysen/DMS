/**
 * Lebenszeichen und Gesundheit der Betriebsumgebung (ADR 0007).
 *
 * **Warum das nicht nur eine Datenbankabfrage ist.** Ein Gesundheitsendpunkt,
 * der prüft, ob die Anwendung antwortet, beantwortet die Frage, die er selbst
 * schon beantwortet hat — sie antwortet ja, sonst wäre die Anfrage nicht
 * angekommen. Interessant ist der **andere** Prozess: Am Worker hängen die
 * Objektsperre, das Abräumen gelöschter Dateien und die Sammelmail. Fällt er
 * aus, hört das System still auf, sie auszuführen, und die Oberfläche sieht
 * dabei normal aus.
 *
 * Deshalb gilt hier: **Ein fehlendes Lebenszeichen ist ein Befund, kein
 * Nichts.** Wer nie eingetragen hat, ist nicht „unbekannt", sondern nicht
 * gelaufen — dieselbe Regel wie bei `sicherung:pruefen`.
 */

import { alsAnmeldung } from '@/db'

/** Name des Worker-Dienstes in `betrieb_lebenszeichen`. */
export const WORKER = 'worker'

/**
 * Wie alt ein Lebenszeichen sein darf, bevor es als verstummt gilt.
 *
 * Der Worker trägt jede Minute ein. Drei verpasste Takte, bevor Alarm
 * geschlagen wird: Ein einzelner ausgefallener Takt — ein langer
 * Datenbankzugriff, ein Neustart — ist kein Vorfall, und ein Endpunkt, der
 * bei jedem Neustart rot wird, wird nach einer Woche nicht mehr angesehen.
 */
export const FRIST_S = 180

export interface Dienst {
  dienst: string
  alterS: number
  fassung: string | null
  frisch: boolean
}

export interface Gesundheit {
  gesund: boolean
  datenbank: boolean
  dienste: Dienst[]
  /** Dienste, die erwartet werden, aber noch nie eingetragen haben. */
  verstummt: string[]
}

/** Trägt das Lebenszeichen eines Dienstes ein. */
export async function lebenszeichenSetzen(dienst: string): Promise<void> {
  await alsAnmeldung(async (c) => {
    await c.query('select app.lebenszeichen_setzen($1, $2)', [
      dienst,
      process.env['DMS_FASSUNG'] ?? null,
    ])
  })
}

/**
 * Gesamtbefund für den Endpunkt und die Container-Prüfung.
 *
 * Ist die Datenbank nicht erreichbar, ist alles Weitere gegenstandslos —
 * dann ist der Befund `gesund: false` und die Liste leer, nicht etwa leer
 * und damit stillschweigend in Ordnung.
 */
export async function gesundheit(erwartet: string[] = [WORKER]): Promise<Gesundheit> {
  let dienste: Dienst[]
  try {
    dienste = await alsAnmeldung(async (c) => {
      const { rows } = await c.query<{
        dienst: string
        alter_s: number
        fassung: string | null
      }>('select dienst, alter_s, fassung from app.lebenszeichen()')
      return rows.map((r) => ({
        dienst: r.dienst,
        alterS: Number(r.alter_s),
        fassung: r.fassung,
        frisch: Number(r.alter_s) <= FRIST_S,
      }))
    })
  } catch {
    // Kein Grund und keine Verbindungszeichenfolge nach draußen — sie trägt
    // Kennung und Rechnername (Projektregel).
    return { gesund: false, datenbank: false, dienste: [], verstummt: erwartet }
  }

  // Wer gar nicht eingetragen hat, fehlt in der Liste. Ihn dort einfach
  // nicht vorzufinden wäre die stillste Art, einen toten Dienst zu übersehen.
  const verstummt = erwartet.filter(
    (name) => !dienste.some((d) => d.dienst === name && d.frisch),
  )

  return {
    gesund: verstummt.length === 0,
    datenbank: true,
    dienste,
    verstummt,
  }
}
