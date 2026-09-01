/**
 * Fehlerkorb: was die Aufbereitung aufgegeben hat.
 *
 * Konzept 24, Punkt 8 — dort als offene Frage formuliert, hier beantwortet.
 *
 * **Ein gescheiterter Beleg ist nicht verschwunden.** Der Lauf startet beim
 * Eingang, nicht nach der Aufbereitung; die Aufgabe liegt also im Postfach.
 * Was fehlt, sind Vorschau, Seitentext und erkannte Felder. Der Beleg ist
 * unvollständig, nicht weg — und genau deshalb ist der Fehlerkorb nötig:
 * Ohne ihn bearbeitet jemand einen leeren Beleg und weiß nicht, warum.
 *
 * Drei Ausgänge, mehr gibt es nicht:
 *
 *   * **wiederholen** — die Ursache war vorübergehend (Platte voll, OCR-Dienst
 *     weg). Zurück in die Warteschlange.
 *   * **manuell** — die Aufbereitung wird nicht mehr versucht, der Beleg geht
 *     trotzdem weiter und die Felder werden von Hand erfasst. Das ist keine
 *     Notlösung, sondern die Regel aus dem Konzept: Fällt die Erkennung aus,
 *     läuft der Workflow trotzdem.
 *   * **verworfen** — die Datei ist nicht zu gebrauchen. Storno, kein Löschen;
 *     die Neuerfassung ist ein neues Dokument.
 */

import { alsBenutzer, alsSystem } from '@/db'
import { alsZeitpunkt } from '@/datum'
import { aufbereitungEinreihen, stapelEinreihen } from '@/queue'

export class FehlerkorbAbgelehnt extends Error {}

export type Ausgang = 'wiederholt' | 'manuell' | 'verworfen'

export interface Korbzeile {
  id: string
  dokumentId: string | null
  stapelId: string | null
  objektId: string | null
  warteschlange: string
  grund: string
  versuche: number
  aufgetretenAm: string
  /** Nur gesetzt, wenn es ein Dokument ist — für die Anzeige. */
  storagePraefix: string | null
  eingangskanal: string | null
  dokumentStatus: string | null
  /** Nur beim Stapel — ein Dokument fuehrt keinen Dateinamen. */
  dateiname: string | null
}

export interface Haengerzeile {
  dokumentId: string
  storagePraefix: string
  eingangskanal: string
  objektId: string | null
  eingangAm: string
}

/**
 * Meldet einen aufgegebenen Auftrag.
 *
 * Läuft im Worker über den technischen Benutzer, die Funktion dahinter ist
 * `security definer` — ein Fehler, der nicht gemeldet werden kann, weil der
 * meldende Benutzer das Dokument nicht sieht, wäre der schlechteste Fall:
 * Er wäre still.
 */
export async function fehlerMelden(
  benutzerId: string,
  eingabe: {
    dokumentId?: string | null
    stapelId?: string | null
    warteschlange: string
    grund: string
    versuche?: number
    auftragId?: string | null
  },
): Promise<string | null> {
  return alsSystem(benutzerId, async (c) => {
    const { rows } = await c.query<{ verarbeitungsfehler_melden: string | null }>(
      'select app.verarbeitungsfehler_melden($1, $2, $3, $4, $5, $6)',
      [
        eingabe.dokumentId ?? null,
        eingabe.stapelId ?? null,
        eingabe.warteschlange,
        eingabe.grund,
        eingabe.versuche ?? 0,
        eingabe.auftragId ?? null,
      ],
    )
    return rows[0]?.verarbeitungsfehler_melden ?? null
  })
}

export async function fehlerkorbLaden(benutzerId: string): Promise<Korbzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select v.id, v.dokument_id, v.stapel_id, v.objekt_id, v.warteschlange,
              v.grund, v.versuche, v.aufgetreten_am,
              coalesce(d.storage_praefix, s.storage_key) as storage_praefix,
              coalesce(d.eingangskanal, s.eingangskanal) as eingangskanal,
              d.status as dokument_status,
              s.dateiname
         from verarbeitungsfehler v
         left join dokument d on d.id = v.dokument_id
         left join stapel s on s.id = v.stapel_id
        where v.erledigt_am is null
        order by v.aufgetreten_am
        limit 200`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      dokumentId: z['dokument_id'] == null ? null : String(z['dokument_id']),
      stapelId: z['stapel_id'] == null ? null : String(z['stapel_id']),
      objektId: z['objekt_id'] == null ? null : String(z['objekt_id']),
      warteschlange: String(z['warteschlange']),
      grund: String(z['grund']),
      versuche: Number(z['versuche']),
      aufgetretenAm: alsZeitpunkt(z['aufgetreten_am']) ?? '',
      storagePraefix: z['storage_praefix'] == null ? null : String(z['storage_praefix']),
      eingangskanal: z['eingangskanal'] == null ? null : String(z['eingangskanal']),
      dokumentStatus: z['dokument_status'] == null ? null : String(z['dokument_status']),
      dateiname: z['dateiname'] == null ? null : String(z['dateiname']),
    }))
  })
}

/**
 * Was liegen blieb, ohne dass die Warteschlange es gemeldet hat.
 *
 * Zweite, unabhängige Quelle neben dem Korb: Stirbt der Worker mitten in der
 * Aufbereitung, gibt es keinen aufgegebenen Auftrag und trotzdem ein
 * hängendes Dokument.
 */
export async function haengendeLaden(
  benutzerId: string,
  minuten = 30,
): Promise<Haengerzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select * from app.aufbereitung_haengt($1)',
      [minuten],
    )
    return rows.map((z) => ({
      dokumentId: String(z['dokument_id']),
      storagePraefix: String(z['storage_praefix']),
      eingangskanal: String(z['eingangskanal']),
      objektId: z['objekt_id'] == null ? null : String(z['objekt_id']),
      eingangAm: alsZeitpunkt(z['eingang_am']) ?? '',
    }))
  })
}

/**
 * Einen Hänger neu einreihen.
 *
 * Ein Hänger hat keinen Eintrag im Korb, den man erledigen könnte — er ist ja
 * gerade dadurch aufgefallen, dass niemand etwas gemeldet hat. Hier gibt es
 * deshalb nur eine Handlung, und der Zustand allein entscheidet, ob sie
 * zulässig ist: Nur ein Beleg, der wirklich noch `in_aufbereitung` steht,
 * wird eingereiht. Sonst würde ein doppelter Klick zwei Aufträge erzeugen.
 */
export async function haengerWiederholen(
  benutzerId: string,
  dokumentId: string,
): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ mandant_id: string }>(
      `select mandant_id from dokument
        where id = $1 and status = 'in_aufbereitung'`,
      [dokumentId],
    )
    const treffer = rows[0]
    if (treffer === undefined) return false

    await aufbereitungEinreihen(
      { dokumentId, mandantId: treffer.mandant_id, benutzerId },
      c,
    )
    return true
  })
}

/**
 * Noch einmal versuchen.
 *
 * Der neue Auftrag wird in derselben Transaktion eingereiht, in der der
 * Eintrag geschlossen wird — sonst gäbe es einen erledigten Eintrag ohne
 * Auftrag, und der Beleg läge still weiter.
 */
export async function fehlerWiederholen(
  benutzerId: string,
  fehlerId: string,
): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    const quelle = await quelleLesen(c, fehlerId)
    if (quelle === null) return false

    if (!(await erledigen(c, fehlerId, 'wiederholt'))) return false

    if (quelle.dokumentId !== null) {
      await aufbereitungEinreihen(
        {
          dokumentId: quelle.dokumentId,
          mandantId: quelle.mandantId,
          benutzerId,
        },
        c,
      )
    } else if (quelle.stapelId !== null) {
      await stapelEinreihen(
        { stapelId: quelle.stapelId, mandantId: quelle.mandantId, benutzerId },
        c,
      )
    }
    return true
  })
}

/**
 * Ohne Aufbereitung weiterarbeiten.
 *
 * Der Beleg verlässt `in_aufbereitung` und wird `laufend`. Erfasst wird von
 * Hand. Der Lauf läuft ohnehin schon — er startete beim Eingang.
 */
export async function fehlerManuell(benutzerId: string, fehlerId: string): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    const quelle = await quelleLesen(c, fehlerId)
    if (quelle === null) return false
    if (quelle.dokumentId === null) {
      throw new FehlerkorbAbgelehnt(
        'Ein Stapel lässt sich nicht von Hand übernehmen — er ist noch kein Beleg. ' +
          'Entweder wiederholen oder verwerfen.',
      )
    }

    if (!(await erledigen(c, fehlerId, 'manuell'))) return false

    await c.query(
      `update dokument set status = 'laufend'
        where id = $1 and status = 'in_aufbereitung'`,
      [quelle.dokumentId],
    )
    return true
  })
}

/**
 * Verwerfen — als Storno, nicht als Löschung.
 *
 * Das Dokument hat es gegeben; es bleibt mit Grund stehen und der Lauf wird
 * geschlossen. Kommt die Datei später lesbar herein, ist das ein neues
 * Dokument.
 */
export async function fehlerVerwerfen(
  benutzerId: string,
  fehlerId: string,
  grund: string,
): Promise<boolean> {
  if (grund.trim() === '') {
    throw new FehlerkorbAbgelehnt('Ein Storno braucht eine Begründung.')
  }

  return alsBenutzer(benutzerId, async (c) => {
    const quelle = await quelleLesen(c, fehlerId)
    if (quelle === null) return false

    if (!(await erledigen(c, fehlerId, 'verworfen'))) return false

    if (quelle.dokumentId !== null) {
      await c.query('select app.dokument_stornieren($1, $2)', [
        quelle.dokumentId,
        grund.trim(),
      ])
    } else if (quelle.stapelId !== null) {
      // Ein Stapel kennt keinen Storno -- vor der Uebernahme gibt es keine
      // Belege, die stehen bleiben muessten. `verworfen` ist sein Endzustand.
      await c.query(`update stapel set status = 'verworfen' where id = $1`, [
        quelle.stapelId,
      ])
    }
    return true
  })
}

/* ------------------------------------------------------------------------ */

interface Quelle {
  dokumentId: string | null
  stapelId: string | null
  mandantId: string
}

async function quelleLesen(
  c: import('pg').PoolClient,
  fehlerId: string,
): Promise<Quelle | null> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select dokument_id, stapel_id, mandant_id
       from verarbeitungsfehler
      where id = $1 and erledigt_am is null`,
    [fehlerId],
  )
  const z = rows[0]
  if (z === undefined) return null
  return {
    dokumentId: z['dokument_id'] == null ? null : String(z['dokument_id']),
    stapelId: z['stapel_id'] == null ? null : String(z['stapel_id']),
    mandantId: String(z['mandant_id']),
  }
}

async function erledigen(
  c: import('pg').PoolClient,
  fehlerId: string,
  ausgang: Ausgang,
): Promise<boolean> {
  const { rows } = await c.query<{ verarbeitungsfehler_erledigen: boolean }>(
    'select app.verarbeitungsfehler_erledigen($1, $2)',
    [fehlerId, ausgang],
  )
  return rows[0]?.verarbeitungsfehler_erledigen === true
}
