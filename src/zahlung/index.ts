/**
 * Zahlungsübergabe.
 *
 * Konzept 12. Der Ablauf ist immer derselbe — geprüft, freigegeben,
 * übergeben, archiviert —, nur das Ziel unterscheidet sich. Diese Datei hält
 * die Reihenfolge zusammen; die Wege stehen in `wege.ts`, die Sperre in
 * `sperre.ts` und in SQL.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'
import { zahlungMoeglich } from './sperre'
import { UebergabeNichtMoeglich, wegFuer, type Postablage } from './wege'

export * from './sperre'
export * from './wege'

export type Zahlungsart = 'voll' | 'eigenanteil' | 'teilbetrag'

export interface Uebergabeergebnis {
  zahlungId: string | null
  status: 'uebergeben' | 'lastschrift' | 'gesperrt'
  /** Warum nicht — leer, wenn es geklappt hat. */
  hindernis: string | null
  protokoll: string | null
}

interface Belegdaten {
  storage_praefix: string
  objekt_id: string | null
  kreditor: string | null
  kreditor_id: string | null
  rechnungsnummer: string | null
  brutto: string | null
  zahlungsziel: string | null
  zahlungsart: string | null
  vertrag_zahlungsart: string | null
  weg_id: string | null
  weg_art: string | null
  weg_name: string | null
  weg_ziel: string | null
  weg_archiviert_sofort: boolean | null
  bankverbindung_id: string | null
  iban: string | null
}

async function belegLaden(c: PoolClient, dokumentId: string): Promise<Belegdaten | undefined> {
  const { rows } = await c.query<Belegdaten>(
    `select d.storage_praefix, d.objekt_id,
            k.name as kreditor, f.kreditor_id, f.rechnungsnummer, f.brutto,
            to_char(f.zahlungsziel, 'YYYY-MM-DD') as zahlungsziel, f.zahlungsart,
            v.zahlungsart as vertrag_zahlungsart,
            z.id as weg_id, z.art as weg_art, z.name as weg_name, z.ziel as weg_ziel,
            z.archiviert_sofort as weg_archiviert_sofort,
            kb.id as bankverbindung_id, kb.iban
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
  return rows[0]
}

/**
 * Zieht der Kreditor selbst ein?
 *
 * Zwei Quellen, in dieser Reihenfolge: was auf dem Beleg steht, sonst was im
 * Vertrag vereinbart ist. Der Beleg gewinnt — eine einmalige Rechnung eines
 * Lieferanten mit Lastschriftvertrag kann trotzdem zu überweisen sein.
 */
export function istLastschrift(beleg: {
  zahlungsart: string | null
  vertrag_zahlungsart: string | null
}): boolean {
  return (beleg.zahlungsart ?? beleg.vertrag_zahlungsart) === 'lastschrift'
}

/**
 * Übergibt einen Beleg zur Zahlung.
 *
 * Die Reihenfolge ist die Aussage:
 *
 *   1. **Sperre zuerst.** Erst prüfen, dann Zeile anlegen — sonst stünde bei
 *      jedem gescheiterten Versuch eine offene Zahlung in der Liste.
 *   2. **Lastschrift vor Wegewahl.** Sie ist kein Weg; es gibt nichts zu
 *      übergeben, nur die Fälligkeit zu vermerken.
 *   3. **Übergeben, dann festschreiben.** Scheitert der Versand, bleibt die
 *      Zahlung offen. Eine als übergeben vermerkte Zahlung, die nie jemanden
 *      erreicht hat, ist der schlimmere Ausgang: Der Beleg verschwindet aus
 *      allen Listen, und das Geld fließt nie.
 */
export async function zahlungUebergeben(
  c: PoolClient,
  mittel: { ablage: Ablage; post?: Postablage | null },
  eingabe: {
    dokumentId: string
    benutzerId: string
    art?: Zahlungsart
    /** Nur beim Eigenanteil oder Teilbetrag. Sonst der Rechnungsbetrag. */
    betrag?: number
  },
): Promise<Uebergabeergebnis> {
  const art = eingabe.art ?? 'voll'

  const sperre = await zahlungMoeglich(c, eingabe.dokumentId)
  if (!sperre.moeglich) {
    return {
      zahlungId: null,
      status: 'gesperrt',
      hindernis: sperre.hindernis,
      protokoll: null,
    }
  }

  const beleg = await belegLaden(c, eingabe.dokumentId)
  if (beleg === undefined) {
    return {
      zahlungId: null,
      status: 'gesperrt',
      hindernis: 'Der Beleg ist nicht erreichbar.',
      protokoll: null,
    }
  }

  const betrag = eingabe.betrag ?? Number(beleg.brutto ?? 0)
  if (!Number.isFinite(betrag) || betrag <= 0) {
    return {
      zahlungId: null,
      status: 'gesperrt',
      hindernis: 'Ohne Betrag lässt sich nichts übergeben.',
      protokoll: null,
    }
  }

  if (istLastschrift(beleg)) {
    const { rows } = await c.query<{ id: string }>(
      `insert into zahlung (dokument_id, betrag, art, bankverbindung_id,
                            faellig_am, status, protokoll)
       values ($1, $2, $3, $4, $5, 'lastschrift',
               'Einzug durch den Kreditor, keine Uebergabe')
       returning id`,
      [
        eingabe.dokumentId,
        betrag,
        art,
        beleg.bankverbindung_id,
        beleg.zahlungsziel,
      ],
    )
    return {
      zahlungId: rows[0].id,
      status: 'lastschrift',
      hindernis: null,
      protokoll: 'Einzug durch den Kreditor, keine Uebergabe',
    }
  }

  const weg = wegFuer(beleg.weg_art as string, {
    ablage: mittel.ablage,
    post: mittel.post ?? null,
  })

  const protokoll = await weg.uebergeben({
    dokumentId: eingabe.dokumentId,
    storagePraefix: beleg.storage_praefix,
    empfaenger: beleg.kreditor ?? '',
    iban: beleg.iban,
    betrag,
    // Der Verwendungszweck ist die Rechnungsnummer -- daran erkennt der
    // Kreditor die Zahlung, nicht an unserer Dokumentkennung.
    verwendungszweck: beleg.rechnungsnummer ?? eingabe.dokumentId,
    faelligAm: beleg.zahlungsziel,
    ziel: beleg.weg_ziel,
    wegname: beleg.weg_name ?? '',
  })

  const { rows } = await c.query<{ id: string }>(
    `insert into zahlung (dokument_id, betrag, art, zahlungsweg_id, bankverbindung_id,
                          faellig_am, status, uebergeben_am, uebergeben_von, protokoll)
     values ($1, $2, $3, $4, $5, $6, 'uebergeben', now(), $7, $8)
     returning id`,
    [
      eingabe.dokumentId,
      betrag,
      art,
      beleg.weg_id,
      beleg.bankverbindung_id,
      beleg.zahlungsziel,
      eingabe.benutzerId,
      protokoll,
    ],
  )

  return { zahlungId: rows[0].id, status: 'uebergeben', hindernis: null, protokoll }
}

export { UebergabeNichtMoeglich }

/** Die Zahlungen eines Belegs, älteste zuerst. */
export async function zahlungenLaden(
  c: PoolClient,
  dokumentId: string,
): Promise<
  Array<{
    id: string
    betrag: number
    art: string
    status: string
    faelligAm: string | null
    uebergebenAm: string | null
    protokoll: string | null
  }>
> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select id, betrag, art, status, faellig_am, uebergeben_am, protokoll
       from zahlung where dokument_id = $1 order by erstellt_am`,
    [dokumentId],
  )
  return rows.map((z) => ({
    id: String(z['id']),
    betrag: Number(z['betrag']),
    art: String(z['art']),
    status: String(z['status']),
    faelligAm: z['faellig_am'] == null ? null : String(z['faellig_am']),
    uebergebenAm: z['uebergeben_am'] == null ? null : String(z['uebergeben_am']),
    protokoll: z['protokoll'] == null ? null : String(z['protokoll']),
  }))
}
