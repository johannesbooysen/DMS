/**
 * Postfächer und Stempeln.
 *
 * Die drei Postfächer sind Sichten auf `aufgabe`, keine eigenen Ablagen
 * (Konzept 8.5). Was sie unterscheidet, ist der Filter — nicht der Ort, an
 * dem etwas liegt.
 *
 * Das Setzen eines Stempels wird hier serverseitig geprüft. Dass die
 * Oberfläche nur mögliche Schaltflächen zeigt, ist Bequemlichkeit; die
 * Entscheidung, ob ein Stempel gesetzt werden darf, fällt hier.
 */

import { alsBenutzer } from '@/db'
import { kontierungPruefen } from '@/kontierung/kontierung'
import { UebergabeNichtMoeglich, zahlungUebergeben } from '@/zahlung'
import { postablage } from '@/app/lib/zahlungsmittel'
import { ABLAGE } from '@/app/lib/belege'
import { stempeln } from '@/workflow/engine'

export interface Postfachzeile {
  aufgabeId: string
  dokumentId: string
  laufId: string
  stufeId: string
  stufe: string
  stufentyp: string
  kreditor: string | null
  korrespondent: string | null
  betreff: string | null
  rechnungsnummer: string | null
  brutto: number | null
  objektnummer: string | null
  ordnungsgruppe: string | null
  ampel: string | null
  faelligAm: string | null
  uebernommenVon: string | null
}

const ZEILEN_ABFRAGE = `
  select a.id as aufgabe_id, d.id as dokument_id, l.id as lauf_id,
         s.id as stufe_id, s.bezeichnung as stufe, s.stufentyp,
         k.name as kreditor, f.rechnungsnummer, f.brutto,
         sv.korrespondent, sv.betreff,
         o.objektnummer, og.name as ordnungsgruppe, d.ampel_gesamt,
         a.faellig_am, a.uebernommen_von
    from aufgabe a
    join dokument_lauf l on l.id = a.lauf_id
    join dokument d on d.id = l.dokument_id
    join prozessstufe s on s.id = a.stufe_id
    left join rechnung_fakten f on f.dokument_id = d.id
    left join kreditor k on k.id = f.kreditor_id
    left join schriftverkehr_fakten sv on sv.dokument_id = d.id
    left join objekt o on o.id = d.objekt_id
    left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
   where a.status in ('offen','in_arbeit')
`

function zeile(z: Record<string, unknown>): Postfachzeile {
  const text = (wert: unknown): string | null => (wert == null ? null : String(wert))
  return {
    aufgabeId: String(z['aufgabe_id']),
    dokumentId: String(z['dokument_id']),
    laufId: String(z['lauf_id']),
    stufeId: String(z['stufe_id']),
    stufe: String(z['stufe']),
    stufentyp: String(z['stufentyp']),
    kreditor: text(z['kreditor']),
    korrespondent: text(z['korrespondent']),
    betreff: text(z['betreff']),
    rechnungsnummer: text(z['rechnungsnummer']),
    brutto: z['brutto'] == null ? null : Number(z['brutto']),
    objektnummer: text(z['objektnummer']),
    ordnungsgruppe: text(z['ordnungsgruppe']),
    ampel: text(z['ampel_gesamt']),
    faelligAm: text(z['faellig_am']),
    uebernommenVon: text(z['uebernommen_von']),
  }
}

/** Persönliches Postfach: was mir zugewiesen ist. */
export async function persoenlichesPostfach(benutzerId: string): Promise<Postfachzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query(
      `${ZEILEN_ABFRAGE} and a.zugewiesen_benutzer = app.mein_benutzer()
        order by a.faellig_am nulls last, d.eingang_am`,
    )
    return rows.map(zeile)
  })
}

/**
 * Pool-Postfach: Aufgaben, die einer Gruppe oder einer Rolle gehören statt
 * einer Person — Spezialgebiet und Fachrolle. Wer eine übernimmt, sperrt sie
 * für eine Weile; bei Untätigkeit fällt sie zurück (Konzept 8.6).
 *
 * Die Rollenzuweisung wird gegen `benutzer_rolle_objekt` geprüft: Eine Rolle,
 * die jemand nur für Objekt 42 trägt, öffnet ihm nicht die Belege von
 * Objekt 43.
 */
export async function poolPostfach(benutzerId: string): Promise<Postfachzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query(
      `${ZEILEN_ABFRAGE}
         and (
           a.zugewiesen_gruppe = any (app.meine_gruppen())
           or exists (
             select 1 from benutzer_rolle_objekt bro
              where bro.rolle_id = a.zugewiesen_rolle
                and bro.benutzer_id = app.mein_benutzer()
                and (bro.objekt_id = d.objekt_id or bro.objekt_id is null)
                and bro.gueltig_von <= current_date
                and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
           )
         )
         and (a.sperre_bis is null or a.sperre_bis < now()
              or a.uebernommen_von = app.mein_benutzer())
        order by a.faellig_am nulls last, d.eingang_am`,
    )
    return rows.map(zeile)
  })
}

export interface Klaerungszeile {
  klaerungId: string
  dokumentId: string
  grund: string
  kommentar: string
  wiedervorlageAm: string
  kreditor: string | null
  korrespondent: string | null
  betreff: string | null
  brutto: number | null
}

/** Klärungspostfach: persönlich, mit Wiedervorlage. */
export async function klaerungsPostfach(benutzerId: string): Promise<Klaerungszeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select kl.id, kl.dokument_id, kl.grund, kl.kommentar, kl.wiedervorlage_am,
              k.name as kreditor, f.brutto,
              sv.korrespondent, sv.betreff
         from klaerung kl
         join dokument d on d.id = kl.dokument_id
         left join rechnung_fakten f on f.dokument_id = d.id
         left join kreditor k on k.id = f.kreditor_id
         left join schriftverkehr_fakten sv on sv.dokument_id = d.id
        where kl.erledigt_am is null
          and kl.verantwortlich_benutzer = app.mein_benutzer()
        order by kl.wiedervorlage_am`,
    )
    return rows.map((z) => ({
      klaerungId: String(z['id']),
      dokumentId: String(z['dokument_id']),
      grund: String(z['grund']),
      kommentar: String(z['kommentar']),
      wiedervorlageAm: String(z['wiedervorlage_am']),
      kreditor: z['kreditor'] == null ? null : String(z['kreditor']),
      korrespondent: z['korrespondent'] == null ? null : String(z['korrespondent']),
      betreff: z['betreff'] == null ? null : String(z['betreff']),
      brutto: z['brutto'] == null ? null : Number(z['brutto']),
    }))
  })
}

export interface Stempelknopf {
  stempeltypId: string
  name: string
  entscheidung: string
  farbe: string | null
  kommentarPflicht: boolean
}

export async function aufgabeLaden(
  benutzerId: string,
  aufgabeId: string,
): Promise<{ zeile: Postfachzeile; stempel: Stempelknopf[] } | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `${ZEILEN_ABFRAGE} and a.id = $1`,
      [aufgabeId],
    )
    const z = rows[0]
    if (z === undefined) return null
    const gefunden = zeile(z)

    const { rows: knoepfe } = await c.query<Record<string, unknown>>(
      'select * from app.moegliche_stempel($1, $2)',
      [gefunden.laufId, gefunden.stufeId],
    )
    return {
      zeile: gefunden,
      stempel: knoepfe.map((k) => ({
        stempeltypId: String(k['stempeltyp_id']),
        name: String(k['name']),
        entscheidung: String(k['entscheidung']),
        farbe: k['farbe'] == null ? null : String(k['farbe']),
        kommentarPflicht: Boolean(k['kommentar_pflicht']),
      })),
    }
  })
}

export class StempelAbgelehnt extends Error {}

/**
 * Setzt einen Stempel — nach serverseitiger Prüfung.
 *
 * Geprüft wird gegen `app.moegliche_stempel`, also gegen dieselbe Quelle, aus
 * der die Oberfläche ihre Schaltflächen bezieht. Ein untergeschobener
 * Stempeltyp scheitert hier, nicht erst an der Datenbank.
 */
export async function stempelSetzen(
  benutzerId: string,
  eingabe: {
    aufgabeId: string
    stempeltypId: string
    kommentar?: string | null
    wiedervorlageAm?: string | null
  },
): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ lauf_id: string; stufe_id: string; dokument_id: string }>(
      `select a.lauf_id, a.stufe_id, l.dokument_id
         from aufgabe a join dokument_lauf l on l.id = a.lauf_id
        where a.id = $1 and a.status in ('offen','in_arbeit')`,
      [eingabe.aufgabeId],
    )
    const aufgabe = rows[0]
    if (aufgabe === undefined) throw new StempelAbgelehnt('Aufgabe nicht offen')

    const { rows: erlaubt } = await c.query<{
      stempeltyp_id: string
      entscheidung: string
      kommentar_pflicht: boolean
    }>('select * from app.moegliche_stempel($1, $2)', [aufgabe.lauf_id, aufgabe.stufe_id])

    const gewaehlt = erlaubt.find((e) => e.stempeltyp_id === eingabe.stempeltypId)
    if (gewaehlt === undefined) {
      throw new StempelAbgelehnt('Dieser Stempel ist an dieser Stufe nicht möglich')
    }

    // Der Summenzwang blockiert die Kontierungsstufe -- nicht die Ampel, die
    // Stufe (Konzept 6). Ein halb kontierter Beleg darf nicht weiter.
    if (gewaehlt.entscheidung === 'freigabe') {
      const { rows: stufen } = await c.query<{ stufentyp: string }>(
        'select stufentyp from prozessstufe where id = $1',
        [aufgabe.stufe_id],
      )
      if (stufen[0]?.stufentyp === 'kontierung') {
        const hindernis = await kontierungPruefen(c, aufgabe.dokument_id)
        if (hindernis !== null) throw new StempelAbgelehnt(hindernis)
      }

      // Die Zahlungsstufe ist keine Bestaetigung, sondern eine Handlung: Der
      // Stempel uebergibt tatsaechlich. Deshalb steht die Uebergabe vor dem
      // Stempel -- scheitert sie, wird auch nicht gestempelt, und die Aufgabe
      // bleibt offen (Konzept 12).
      if (stufen[0]?.stufentyp === 'zahlung') {
        try {
          const ergebnis = await zahlungUebergeben(c, { ablage: ABLAGE, post: postablage(c) }, {
            dokumentId: aufgabe.dokument_id,
            benutzerId,
          })
          if (ergebnis.status === 'gesperrt') {
            throw new StempelAbgelehnt(ergebnis.hindernis ?? 'Die Zahlung ist gesperrt.')
          }
        } catch (fehler) {
          // Ein nicht eingerichteter Weg ist ein Hindernis, kein Absturz.
          // Beim Bedienen kam hier ein Serverfehler heraus, nachdem der
          // Anwender die Schaltflaeche gedrueckt hatte -- ohne Begruendung
          // und ohne zu wissen, ob gezahlt wurde.
          if (fehler instanceof UebergabeNichtMoeglich) {
            throw new StempelAbgelehnt(fehler.message)
          }
          throw fehler
        }
      }
    }

    const kommentar = eingabe.kommentar?.trim() ?? ''
    if (gewaehlt.kommentar_pflicht && kommentar === '') {
      throw new StempelAbgelehnt('Für diesen Stempel ist ein Kommentar Pflicht')
    }

    if (gewaehlt.entscheidung === 'klaerung') {
      // Kommentar und Wiedervorlage sind Pflicht, sonst kein Eintritt
      // (Konzept 8.5). Die Prüfung steht hier und als Bedingung in der
      // Tabelle -- die Oberfläche darf nicht die einzige Hürde sein.
      if (kommentar === '') throw new StempelAbgelehnt('Klärung braucht einen Kommentar')
      if (!eingabe.wiedervorlageAm) {
        throw new StempelAbgelehnt('Klärung braucht ein Wiedervorlagedatum')
      }
      await c.query(
        `insert into klaerung (dokument_id, grund, kommentar, eroeffnet_von,
                               verantwortlich_benutzer, stufe_beim_eintritt,
                               wiedervorlage_am)
         values ($1, 'Rueckfrage', $2, app.mein_benutzer(), app.mein_benutzer(), $3, $4)`,
        [aufgabe.dokument_id, kommentar, aufgabe.stufe_id, eingabe.wiedervorlageAm],
      )
    }

    await stempeln(c, {
      laufId: aufgabe.lauf_id,
      stufeId: aufgabe.stufe_id,
      benutzerId,
      stempeltypId: eingabe.stempeltypId,
      entscheidung: gewaehlt.entscheidung as 'freigabe' | 'ablehnung' | 'rueckgabe' | 'klaerung',
      kommentar: kommentar === '' ? null : kommentar,
    })
  })
}
