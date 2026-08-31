/**
 * Mahnungen.
 *
 * Grundlage: Konzept 14. Eine Mahnung läuft nicht wie ein gewöhnlicher Beleg
 * durch. Sie ist keine Forderung, die man bezahlt, sondern eine Aussage über
 * eine andere Forderung — und die gehört geprüft, bevor jemand reagiert.
 *
 * Die Extraktion sucht über Kreditor und Rechnungsnummer die Ursprungsrechnung
 * und wertet deren Zustand aus. In allen Fällen wird die Mahnung mit der
 * Rechnung verkettet und archiviert, **nie separat bezahlt**.
 *
 * Warum das wichtig ist: Eine Mahnung zu einer bereits gezahlten Rechnung ist
 * der häufigste Anlass für eine Doppelzahlung. Und eine Mahnung ohne
 * auffindbare Rechnung ist der einzige Hinweis darauf, dass ein Beleg nie
 * angekommen ist — das fällt sonst erst auf, wenn die Frist längst abgelaufen
 * ist.
 */

import type { PoolClient } from 'pg'
import type { Befund } from './plausibilitaet'

interface Ursprung {
  id: string
  status: string
  lauf_status: string | null
  stufe: string | null
  eingang_am: string
  in_klaerung: boolean
  klaerung_bei: string | null
}

/**
 * Sucht die Ursprungsrechnung.
 *
 * Gesucht wird über Kreditor und Rechnungsnummer, **nicht** über den Betrag:
 * Eine Mahnung trägt Mahngebühren und Zinsen, ihr Betrag weicht also
 * regelmäßig ab. Der Betrag taugt hier zur Bestätigung, nicht zur Suche.
 */
async function ursprungSuchen(
  c: PoolClient,
  mahnungId: string,
): Promise<Ursprung | null> {
  const { rows } = await c.query<Ursprung>(
    `select d.id, d.status, d.eingang_am,
            l.status as lauf_status,
            s.bezeichnung as stufe,
            exists (select 1 from klaerung k
                     where k.dokument_id = d.id and k.erledigt_am is null) as in_klaerung,
            (select b.name from klaerung k
               join benutzer b on b.id = k.verantwortlich_benutzer
              where k.dokument_id = d.id and k.erledigt_am is null
              limit 1) as klaerung_bei
       from dokument mahnung
       join rechnung_fakten mf on mf.dokument_id = mahnung.id
       join rechnung_fakten f
         on f.kreditor_id = mf.kreditor_id
        and f.rechnungsnummer = mf.rechnungsnummer
       join dokument d on d.id = f.dokument_id
       left join dokument_lauf l on l.dokument_id = d.id
       left join prozessstufe s on s.id = l.aktuelle_stufe_id
      where mahnung.id = $1
        and d.id <> mahnung.id
        and d.belegart <> 'mahnung'
        and d.mandant_id = mahnung.mandant_id
      order by d.eingang_am
      limit 1`,
    [mahnungId],
  )
  return rows[0] ?? null
}

function tageSeit(zeitpunkt: string): number {
  const tage = (Date.now() - new Date(zeitpunkt).getTime()) / 86_400_000
  return Math.max(0, Math.round(tage))
}

/**
 * Prüft eine Mahnung und verkettet sie mit der Ursprungsrechnung.
 *
 * Die Verkettung geschieht in allen Fällen, in denen eine Rechnung gefunden
 * wird — auch wenn der Befund harmlos ist. Beide gehören in dieselbe Akte.
 */
export async function mahnungPruefen(
  c: PoolClient,
  mahnungId: string,
): Promise<Befund[]> {
  const ursprung = await ursprungSuchen(c, mahnungId)

  if (ursprung === null) {
    return [
      {
        pruefung: 'mahnung_ohne_rechnung',
        schwere: 'orange',
        hinweis:
          'Zu dieser Mahnung ist keine Rechnung im System. Entweder ist der ' +
          'Beleg nie angekommen, oder er wurde unter einer anderen Nummer ' +
          'erfasst. Beim Kreditor die Rechnung anfordern und prüfen, ob eine ' +
          'Zahlung offen ist.',
      },
    ]
  }

  // Verketten, bevor bewertet wird: Die Zuordnung gilt unabhaengig davon,
  // wie der Befund ausfaellt (Konzept 14).
  await c.query(
    `insert into dokument_beziehung (von_dokument, zu_dokument, art)
     values ($1, $2, 'mahnung_zu')
     on conflict do nothing`,
    [mahnungId, ursprung.id],
  )

  const liegezeit = tageSeit(ursprung.eingang_am)

  if (ursprung.status === 'archiviert') {
    return [
      {
        pruefung: 'mahnung_bereits_erledigt',
        schwere: 'hart',
        hinweis:
          `Die zugehörige Rechnung ist bereits abgeschlossen und archiviert ` +
          `(Eingang vor ${liegezeit} Tagen). Die Mahnung ist damit vermutlich ` +
          'unberechtigt. Zahlungsnachweis heraussuchen und dem Kreditor ' +
          'übermitteln — auf keinen Fall erneut zahlen.',
      },
    ]
  }

  if (ursprung.in_klaerung || ursprung.lauf_status === 'klaerung') {
    return [
      {
        pruefung: 'mahnung_rechnung_in_klaerung',
        schwere: 'orange',
        hinweis:
          'Die zugehörige Rechnung liegt in Klärung' +
          (ursprung.klaerung_bei === null ? '' : ` bei ${ursprung.klaerung_bei}`) +
          `, seit ${liegezeit} Tagen im Haus. Etwaige Mahnkosten dort mit ` +
          'ansprechen.',
      },
    ]
  }

  if (ursprung.lauf_status === 'laufend') {
    return [
      {
        pruefung: 'mahnung_rechnung_im_lauf',
        schwere: 'orange',
        hinweis:
          `Die zugehörige Rechnung ist noch in Bearbeitung` +
          (ursprung.stufe === null ? '' : ` (Stufe: ${ursprung.stufe})`) +
          ` und liegt seit ${liegezeit} Tagen im Haus. ` +
          'Bearbeitung beschleunigen, statt die Mahnung zu bezahlen.',
      },
    ]
  }

  if (ursprung.status === 'abgelehnt') {
    return [
      {
        pruefung: 'mahnung_rechnung_abgelehnt',
        schwere: 'orange',
        hinweis:
          'Die zugehörige Rechnung wurde abgelehnt. Dem Kreditor die ' +
          'Ablehnung mitteilen, statt die Mahnung zu bearbeiten.',
      },
    ]
  }

  return [
    {
      pruefung: 'mahnung_zugeordnet',
      schwere: 'hinweis',
      hinweis: `Der Mahnung ist eine Rechnung zugeordnet, Eingang vor ${liegezeit} Tagen.`,
    },
  ]
}
