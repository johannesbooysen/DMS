/**
 * Nebenläufe: Wartecontainer und Bauteile.
 *
 * Konzept 10. Was hier steht, sind die **zwei Mechanismen**, die beide
 * Nebenläufe brauchen — nicht die Nebenläufe selbst. Die Abfolgen aus den
 * Diagrammen (Selbstzahlung gegen Abtretung; Wartung gegen Reparatur gegen
 * Erneuerung) sind Stufen und Bedingungen in `prozessdefinition` und gehören
 * in die Einstellungen.
 *
 * Wer hier eine Funktion `versicherungsfallBearbeiten` einbaut, hat den
 * ersten Satz des Abschnitts überlesen: „Nebenläufe sind keine
 * Sonderprogramme."
 */

import type { PoolClient } from 'pg'
import { alsDatum, alsZeitpunkt } from '@/datum'
import { alsBenutzer } from '@/db'

export type Ereignis = 'erstattung' | 'versicherungszahlung' | 'gewaehrleistungsantwort'

export interface Wartezeile {
  containerId: string
  dokumentId: string
  art: string
  erwartetesEreignis: Ereignis
  erwarteterBetrag: number | null
  wiedervorlageAm: string
  ueberfaellig: boolean
  ueberfaelligTage: number
  kreditor: string | null
  objektnummer: string | null
  brutto: number | null
}

export class WartenAbgelehnt extends Error {}

/**
 * Öffnet einen Wartecontainer.
 *
 * Die Wiedervorlage ist Pflicht und muss in der Zukunft liegen — beides
 * erzwingt die Datenbank. Ein Container ohne Wiedervorlage wäre ein Ort, an
 * dem Belege verschwinden, und genau das soll er verhindern.
 */
export async function wartenBeginnen(
  benutzerId: string,
  eingabe: {
    dokumentId: string
    art: string
    ereignis: Ereignis
    wiedervorlageAm: string
    erwarteterBetrag?: number | null
  },
): Promise<string> {
  if (eingabe.art.trim() === '') {
    throw new WartenAbgelehnt('Der Container braucht eine Bezeichnung.')
  }

  const id = await alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ warten_beginnen: string | null }>(
      'select app.warten_beginnen($1, $2, $3, $4::date, $5)',
      [
        eingabe.dokumentId,
        eingabe.art.trim(),
        eingabe.ereignis,
        eingabe.wiedervorlageAm,
        eingabe.erwarteterBetrag ?? null,
      ],
    )
    return rows[0]?.warten_beginnen ?? null
  })

  if (id === null) {
    throw new WartenAbgelehnt('Zu diesem Beleg läuft kein Ablauf.')
  }
  return id
}

/**
 * Schließt einen Wartecontainer.
 *
 * Das Ergebnis ist Pflicht: Ein Container, der ohne Ergebnis endet,
 * hinterlässt die Frage, warum nicht mehr gewartet wird.
 */
export async function wartenBeenden(
  benutzerId: string,
  containerId: string,
  ergebnis: string,
): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ warten_beenden: boolean }>(
      'select app.warten_beenden($1, $2)',
      [containerId, ergebnis],
    )
    return rows[0]?.warten_beenden === true
  })
}

/** Die offenen Container, fälligste zuerst. */
export async function wartendeLaden(
  benutzerId: string,
  optionen: { nurFaellige?: boolean } = {},
): Promise<Wartezeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select w.id, w.dokument_id, w.art, w.erwartetes_ereignis,
              w.erwarteter_betrag, w.wiedervorlage_am,
              (current_date - w.wiedervorlage_am)::integer as ueberfaellig_tage,
              k.name as kreditor, o.objektnummer, f.brutto
         from wartecontainer w
         join dokument d on d.id = w.dokument_id
         left join objekt o on o.id = d.objekt_id
         left join rechnung_fakten f on f.dokument_id = d.id
         left join kreditor k on k.id = f.kreditor_id
        where w.erledigt_am is null
          and ($1::boolean is not true or w.wiedervorlage_am <= current_date)
        order by w.wiedervorlage_am`,
      [optionen.nurFaellige ?? false],
    )
    return rows.map((z) => ({
      containerId: String(z['id']),
      dokumentId: String(z['dokument_id']),
      art: String(z['art']),
      erwartetesEreignis: String(z['erwartetes_ereignis']) as Ereignis,
      erwarteterBetrag: z['erwarteter_betrag'] == null ? null : Number(z['erwarteter_betrag']),
      wiedervorlageAm: alsDatum(z['wiedervorlage_am']) ?? '',
      ueberfaelligTage: Number(z['ueberfaellig_tage']),
      ueberfaellig: Number(z['ueberfaellig_tage']) >= 0,
      kreditor: z['kreditor'] == null ? null : String(z['kreditor']),
      objektnummer: z['objektnummer'] == null ? null : String(z['objektnummer']),
      brutto: z['brutto'] == null ? null : Number(z['brutto']),
    }))
  })
}

/** Die Container eines Belegs, auch die geschlossenen. */
export async function wartenZumBeleg(
  c: PoolClient,
  dokumentId: string,
): Promise<
  Array<{
    containerId: string
    art: string
    erwartetesEreignis: string
    wiedervorlageAm: string
    erledigtAm: string | null
    ergebnis: string | null
  }>
> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select id, art, erwartetes_ereignis, wiedervorlage_am, erledigt_am, ergebnis
       from wartecontainer where dokument_id = $1 order by eroeffnet_am`,
    [dokumentId],
  )
  return rows.map((z) => ({
    containerId: String(z['id']),
    art: String(z['art']),
    erwartetesEreignis: String(z['erwartetes_ereignis']),
    wiedervorlageAm: alsDatum(z['wiedervorlage_am']) ?? '',
    erledigtAm: alsZeitpunkt(z['erledigt_am']),
    ergebnis: z['ergebnis'] == null ? null : String(z['ergebnis']),
  }))
}

/* ---------------------------------------------------------------------------
 * Bauteile und Gewährleistung
 * ------------------------------------------------------------------------ */

export interface Bauteilzeile {
  bauteilId: string
  bezeichnung: string
  einbauAm: string | null
  gewaehrleistungBis: string | null
  lieferant: string | null
  resttage: number
}

/**
 * Bauteile mit laufender Gewährleistung.
 *
 * Der Vorschlag bei einer Reparatur — mit **Stichtag**, nicht mit dem heutigen
 * Datum. Die Frage lautet „war zum Schadenszeitpunkt Gewährleistung offen",
 * und zwischen Schaden und Rechnung vergehen Wochen. Wer hier `current_date`
 * einsetzt, verliert genau die Fälle, auf die es ankommt.
 */
export async function gewaehrleistungOffen(
  benutzerId: string,
  objektId: string,
  stichtag?: string,
): Promise<Bauteilzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select * from app.gewaehrleistung_offen($1, coalesce($2::date, current_date))',
      [objektId, stichtag ?? null],
    )
    return rows.map((z) => ({
      bauteilId: String(z['bauteil_id']),
      bezeichnung: String(z['bezeichnung']),
      einbauAm: alsDatum(z['einbau_am']),
      gewaehrleistungBis: alsDatum(z['gewaehrleistung_bis']),
      lieferant: z['lieferant'] == null ? null : String(z['lieferant']),
      resttage: Number(z['resttage']),
    }))
  })
}

/**
 * Erfasst ein Bauteil.
 *
 * Bei einer Erneuerung wird das alte Teil über `ersetztBauteilId` verkettet
 * und stillgelegt — nicht gelöscht. Ohne die Kette wäre nach der zweiten
 * Erneuerung nicht mehr zu sagen, wie alt die Anlage ist.
 */
export async function bauteilErfassen(
  benutzerId: string,
  eingabe: {
    objektId: string
    bezeichnung: string
    einbauAm?: string | null
    gewaehrleistungBis?: string | null
    lieferantId?: string | null
    dokumentId?: string | null
    ersetztBauteilId?: string | null
  },
): Promise<string> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into bauteil (objekt_id, bezeichnung, einbau_am, gewaehrleistung_bis,
                            lieferant_id, dokument_id, ersetzt_bauteil_id)
       values ($1, $2, $3::date, $4::date, $5, $6, $7)
       returning id`,
      [
        eingabe.objektId,
        eingabe.bezeichnung,
        eingabe.einbauAm ?? null,
        eingabe.gewaehrleistungBis ?? null,
        eingabe.lieferantId ?? null,
        eingabe.dokumentId ?? null,
        eingabe.ersetztBauteilId ?? null,
      ],
    )

    if (eingabe.ersetztBauteilId != null) {
      // Stilllegen, nicht löschen: Die Historie ist der Zweck der Tabelle.
      await c.query('update bauteil set aktiv = false where id = $1', [
        eingabe.ersetztBauteilId,
      ])
    }
    return rows[0].id
  })
}

/** Die Bauteile eines Objekts, aktive zuerst. */
export async function bauteileLaden(
  benutzerId: string,
  objektId: string,
): Promise<
  Array<Bauteilzeile & { aktiv: boolean; ersetztBauteilId: string | null }>
> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select b.id, b.bezeichnung, b.einbau_am, b.gewaehrleistung_bis,
              b.aktiv, b.ersetzt_bauteil_id, k.name as lieferant,
              (b.gewaehrleistung_bis - current_date)::integer as resttage
         from bauteil b
         left join kreditor k on k.id = b.lieferant_id
        where b.objekt_id = $1
        order by b.aktiv desc, b.einbau_am desc nulls last`,
      [objektId],
    )
    return rows.map((z) => ({
      bauteilId: String(z['id']),
      bezeichnung: String(z['bezeichnung']),
      einbauAm: alsDatum(z['einbau_am']),
      gewaehrleistungBis: alsDatum(z['gewaehrleistung_bis']),
      lieferant: z['lieferant'] == null ? null : String(z['lieferant']),
      resttage: z['resttage'] == null ? 0 : Number(z['resttage']),
      aktiv: Boolean(z['aktiv']),
      ersetztBauteilId:
        z['ersetzt_bauteil_id'] == null ? null : String(z['ersetzt_bauteil_id']),
    }))
  })
}
