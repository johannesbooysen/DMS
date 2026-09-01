/**
 * Belege, die von selbst hereinkommen.
 *
 * Konzept 13 nennt drei Wege: Postfach, Scan, Upload. Upload und Scan
 * beginnen bei einem Menschen. Diese hier laufen im Worker, und daraus folgt
 * die Bauart:
 *
 *   * **Ein Weg herein.** Jedes Fundstück geht durch `dokumentAufnehmen` —
 *     dieselbe Hash- und Dublettenprüfung, dieselbe Warteschlange wie beim
 *     Upload. Eine Quelle liefert Bytes, sonst nichts.
 *   * **Ein Fehler an einer Quelle hält die anderen nicht auf.** Ein
 *     abgelaufenes Postfachpasswort darf den überwachten Ordner nicht
 *     blockieren.
 *   * **Was schiefgeht, steht in der Quelle.** Niemand sieht zu; eine Quelle,
 *     die seit Wochen nichts liefert, muss das selbst sagen.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '@/ablage'
import { alsAnmeldung, alsBenutzer } from '@/db'
import { alsZeitpunkt } from '@/datum'
import { dokumentAufnehmen } from '@/ingest/aufnehmen'
import { ordnerQuelle } from './ordner'
import { imapZugang, mailQuelle } from './mail'
import type { Eingangsquelle, Quelleneinstellungen } from './quelle'

export * from './quelle'
export { ordnerQuelle } from './ordner'
export {
  dateinamenTauglich,
  fundstueckeAusMail,
  imapZugang,
  mailQuelle,
  mailtext,
  type Postfachzugang,
} from './mail'

export interface Quellenzeile {
  id: string
  art: string
  bezeichnung: string
  aktiv: boolean
  taktSekunden: number
  zuletztGeprueft: string | null
  zuletztErfolg: string | null
  letzterFehler: string | null
  aufgenommen: number
  objektId: string | null
}

interface FaelligeQuelle {
  quelleId: string
  mandantId: string
  art: string
  bezeichnung: string
  einstellungen: Quelleneinstellungen
  objektId: string | null
  ordnungsgruppeId: string | null
  belegart: string
  /** Unter wessen Rechten gearbeitet wird -- siehe Migration ...170000. */
  traegerId: string
}

/** Welche Umsetzung zu welcher Art gehört. */
function quelleFuer(art: string): Eingangsquelle {
  switch (art) {
    case 'ordner':
      return ordnerQuelle
    case 'mail':
      return mailQuelle(imapZugang)
    default:
      throw new Error(`Unbekannte Art einer Eingangsquelle: ${art}`)
  }
}

/**
 * Einen Durchgang über alle fälligen Quellen.
 *
 * Läuft im Worker. `quellen` ist für Tests da — damit sie eine Quelle
 * einsetzen können, die weder Dateisystem noch Postfach braucht.
 */
export async function eingangAbholen(
  ablage: Ablage,
  quellen: (art: string) => Eingangsquelle = quelleFuer,
  grenze = 20,
): Promise<{ quellen: number; aufgenommen: number; gescheitert: number }> {
  const faellig = await alsAnmeldung(async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select * from app.eingangsquellen_faellig($1)',
      [grenze],
    )
    return rows.map(
      (z): FaelligeQuelle => ({
        quelleId: String(z['quelle_id']),
        mandantId: String(z['mandant_id']),
        art: String(z['art']),
        bezeichnung: String(z['bezeichnung']),
        einstellungen: (z['einstellungen'] ?? {}) as Quelleneinstellungen,
        objektId: z['objekt_id'] == null ? null : String(z['objekt_id']),
        ordnungsgruppeId:
          z['ordnungsgruppe_id'] == null ? null : String(z['ordnungsgruppe_id']),
        belegart: String(z['belegart']),
        traegerId: String(z['traeger_id']),
      }),
    )
  })

  let aufgenommen = 0
  let gescheitert = 0

  for (const quelle of faellig) {
    try {
      aufgenommen += await eineQuelle(ablage, quelle, quellen(quelle.art))
    } catch (fehler) {
      /*
       * Ein Fehler an einer Quelle beendet nur diese.
       *
       * Und er kommt **nicht** ins Log: Eine Fehlermeldung von IMAP kann die
       * Adresse des Postfachs enthalten, und in Logs gehoeren keine
       * personenbezogenen Daten (Projektregel). Er steht in der Quelle, wo
       * ihn jemand sieht, der ihn beheben kann.
       */
      gescheitert += 1
      const grund = fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'
      await vermerken(quelle.quelleId, 0, grund.slice(0, 500))
    }
  }

  return { quellen: faellig.length, aufgenommen, gescheitert }
}

async function eineQuelle(
  ablage: Ablage,
  quelle: FaelligeQuelle,
  umsetzung: Eingangsquelle,
): Promise<number> {
  const stuecke = await umsetzung.holen(quelle.einstellungen, (herkunft) =>
    schonGeholt(quelle.quelleId, herkunft),
  )

  let anzahl = 0
  for (const stueck of stuecke) {
    /*
     * Noch einmal nachfragen, obwohl die Quelle schon gefiltert hat.
     *
     * Der Filter in der Quelle ist eine **Beschleunigung**, keine Zusage:
     * Bei dreitausend Mails im Postfach soll nicht jede geparst werden.
     * Genau darin steckte ein Fehler -- der IMAP-Teil filtert nach
     * Message-Id, vermerkt wird aber `Message-Id#Anhangsname`. Die
     * Richtigkeit muss hier hängen, wo die Herkunft endgültig feststeht.
     */
    if (await schonGeholt(quelle.quelleId, stueck.herkunft)) continue

    /*
     * Aufnehmen und vormerken in **einer** Transaktion.
     *
     * Getrennt gaebe es zwei schlechte Ausgaenge: ein Beleg ohne Vormerkung
     * -- dann kommt er beim naechsten Durchgang noch einmal --, oder eine
     * Vormerkung ohne Beleg, und dann ist er fuer immer verloren.
     */
    await alsBenutzer(quelle.traegerId, async (c) => {
      const auf = await dokumentAufnehmen(
        c,
        ablage,
        {
          mandantId: quelle.mandantId,
          objektId: quelle.objektId,
          /*
           * Die Belegart der Quelle -- außer bei einer Mail ohne Anhang.
           *
           * Ein Postfach für Rechnungen ist als solches eingerichtet, und
           * fast alles darin ist eine. Eine Nachricht **ohne** Anhang ist es
           * per Definition nicht: Da hat jemand geschrieben. Sie als
           * Rechnung zu führen, hieße einen Beleg zu erwarten, den es nicht
           * gibt — und die Plausibilitätsprüfung schlüge zu Recht an.
           */
          belegart: (stueck.mime === 'message/rfc822'
            ? 'schriftverkehr'
            : quelle.belegart) as never,
          eingangskanal: quelle.art === 'mail' ? 'mail' : 'ftp',
          dateiname: stueck.dateiname,
          mime: stueck.mime,
          inhalt: stueck.inhalt,
        },
        quelle.traegerId,
      )
      if (quelle.ordnungsgruppeId !== null) {
        await c.query('update dokument set ordnungsgruppe_id = $2 where id = $1', [
          auf.dokumentId,
          quelle.ordnungsgruppeId,
        ])
      }
      await vormerken(c, quelle.quelleId, stueck.herkunft, auf.dokumentId)
    })

    anzahl += 1

    /*
     * Aufraeumen erst jetzt.
     *
     * Wer zuerst verschiebt und dann aufnimmt, verliert die Datei, wenn die
     * Aufnahme scheitert. Und ein Fehler beim Aufraeumen darf den bereits
     * aufgenommenen Beleg nicht zurueckdrehen -- er steht schon im System,
     * und die Merkliste verhindert, dass er noch einmal kommt.
     */
    if (umsetzung.erledigen !== undefined) {
      await umsetzung.erledigen(quelle.einstellungen, stueck).catch(() => {
        /* stehenlassen: die Merkliste traegt */
      })
    }
  }

  await vermerken(quelle.quelleId, anzahl, null)
  return anzahl
}

async function schonGeholt(quelleId: string, herkunft: string): Promise<boolean> {
  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<{ eingang_schon_geholt: boolean }>(
      'select app.eingang_schon_geholt($1, $2)',
      [quelleId, herkunft],
    )
    return rows[0]?.eingang_schon_geholt === true
  })
}

async function vormerken(
  c: PoolClient,
  quelleId: string,
  herkunft: string,
  dokumentId: string,
): Promise<void> {
  await c.query('select app.eingang_vormerken($1, $2, $3)', [quelleId, herkunft, dokumentId])
}

async function vermerken(
  quelleId: string,
  anzahl: number,
  fehler: string | null,
): Promise<void> {
  await alsAnmeldung((c) =>
    c.query('select app.eingangsquelle_vermerken($1, $2, $3)', [quelleId, anzahl, fehler]),
  )
}

/* ---------------------------------------------------------------------------
 * Für die Oberfläche
 * ------------------------------------------------------------------------ */

export async function quellenLaden(benutzerId: string): Promise<Quellenzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select id, art, bezeichnung, aktiv, takt_sekunden, zuletzt_geprueft,
              zuletzt_erfolg, letzter_fehler, aufgenommen, objekt_id
         from eingangsquelle
        order by bezeichnung`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      art: String(z['art']),
      bezeichnung: String(z['bezeichnung']),
      aktiv: Boolean(z['aktiv']),
      taktSekunden: Number(z['takt_sekunden']),
      zuletztGeprueft: alsZeitpunkt(z['zuletzt_geprueft']),
      zuletztErfolg: alsZeitpunkt(z['zuletzt_erfolg']),
      letzterFehler: z['letzter_fehler'] == null ? null : String(z['letzter_fehler']),
      aufgenommen: Number(z['aufgenommen']),
      objektId: z['objekt_id'] == null ? null : String(z['objekt_id']),
    }))
  })
}
