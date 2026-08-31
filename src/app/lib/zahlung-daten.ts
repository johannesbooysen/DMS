/**
 * Die Zahlungsansicht mit Daten versorgen.
 *
 * Zwei Fragen beantwortet sie, und die zweite ist die wichtigere:
 * **Was wird passieren**, wenn ich stemple — und **was hält den Beleg auf**,
 * wenn nichts passieren kann. Ein Stempel, der ohne Vorwarnung Geld anweist,
 * wäre so falsch wie einer, der ohne Begründung abgelehnt wird.
 */

import { alsBenutzer } from '@/db'
import { wegHindernis, zahlungenLaden, zahlungMoeglich } from '@/zahlung'
import { ZAHLUNGSMITTEL } from '@/app/lib/zahlungsmittel'

export interface Zahlungsansicht {
  /** Was der Weg tun wird — Name und Art aus den Stammdaten des Objekts. */
  weg: { name: string; art: string; ziel: string | null } | null
  betrag: number | null
  faelligAm: string | null
  empfaenger: string | null
  /** Maskierte IBAN — die vollständige gehört nicht auf jeden Bildschirm. */
  iban: string | null
  lastschrift: boolean
  moeglich: boolean
  hindernis: string | null
  verfallen: number
  zahlungen: Awaited<ReturnType<typeof zahlungenLaden>>
}

/**
 * Zeigt nur die letzten vier Stellen.
 *
 * Zum Wiedererkennen genügt das; für alles andere gibt es die Stammdaten des
 * Kreditors. Eine vollständige IBAN auf einem Bildschirm, an dem viele
 * vorbeigehen, ist ein unnötiges Risiko.
 */
export function ibanMaskieren(iban: string | null): string | null {
  if (iban === null || iban.length < 4) return iban
  return `…${iban.slice(-4)}`
}

export async function zahlungsansichtLaden(
  benutzerId: string,
  dokumentId: string,
): Promise<Zahlungsansicht> {
  return alsBenutzer(benutzerId, async (c) => {
    const sperre = await zahlungMoeglich(c, dokumentId)

    const { rows } = await c.query<Record<string, unknown>>(
      `select z.name as weg_name, z.art as weg_art, z.ziel as weg_ziel,
              f.brutto, to_char(f.zahlungsziel, 'YYYY-MM-DD') as zahlungsziel,
              k.name as kreditor, kb.iban,
              coalesce(f.zahlungsart, v.zahlungsart) as zahlungsart
         from dokument d
         left join rechnung_fakten f on f.dokument_id = d.id
         left join kreditor k on k.id = f.kreditor_id
         left join objekt o on o.id = d.objekt_id
         left join zahlungsweg z on z.id = o.zahlungsweg_id
         left join vertrag v on v.kreditor_id = f.kreditor_id
                            and v.objekt_id = d.objekt_id and v.aktiv
         left join kreditor_bankverbindung kb on kb.kreditor_id = f.kreditor_id
                                             and kb.status = 'verifiziert'
        where d.id = $1
        limit 1`,
      [dokumentId],
    )
    const z = rows[0]

    const weg =
      z?.['weg_name'] == null
        ? null
        : {
            name: String(z['weg_name']),
            art: String(z['weg_art']),
            ziel: z['weg_ziel'] == null ? null : String(z['weg_ziel']),
          }

    // Die Sperre in SQL kennt die Stammdaten, nicht die Einrichtung des
    // Servers. Ob ein Versand steht, weiß nur die Anwendung -- und der
    // Bearbeiter soll es vor dem Stempeln erfahren, nicht danach.
    const wegProblem =
      weg === null ? null : wegHindernis(weg.art, weg.name, ZAHLUNGSMITTEL)

    return {
      weg,
      betrag: z?.['brutto'] == null ? null : Number(z['brutto']),
      faelligAm: z?.['zahlungsziel'] == null ? null : String(z['zahlungsziel']),
      empfaenger: z?.['kreditor'] == null ? null : String(z['kreditor']),
      iban: ibanMaskieren(z?.['iban'] == null ? null : String(z['iban'])),
      lastschrift: z?.['zahlungsart'] === 'lastschrift',
      moeglich: sperre.moeglich && wegProblem === null,
      hindernis: sperre.hindernis ?? wegProblem,
      verfallen: sperre.verfallen,
      zahlungen: await zahlungenLaden(c, dokumentId),
    }
  })
}
