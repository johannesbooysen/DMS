/**
 * Angaben von Hand nachtragen -- die manuelle Zuordnung (Konzept 13: "rot:
 * Bearbeitung gestoppt, manuelle Zuordnung erzwungen").
 *
 * Ein Beleg, dem die Extraktion nichts abgewinnen konnte -- ein Scan ohne
 * Textebene, ein Foto, ein Beleg ohne eingerichtete Erkennung --, kommt
 * ohne Objekt und ohne Kreditor an. Ohne Objekt gibt es keine
 * Objektverantwortliche, die Aufgabe hat niemanden, und der Beleg stand bis
 * hierher in keinem Postfach: nur in der Suche, als "Ohne Bezeichnung".
 * Genau so ist der erste echte Scan beim Bedienen verschwunden.
 *
 * Jetzt: Wer den Beleg sehen darf, traegt Objekt, Gruppe, Kreditor und die
 * Rechnungsdaten nach. Danach laeuft die Pruefung noch einmal, und die
 * offenen Aufgaben ohne Traeger bekommen ihren Traeger -- ueber dieselbe
 * Aufloesung, die die Engine beim Anlegen nimmt.
 *
 * Welche Felder ein Haus unbedingt haben will, sagt das Stammdatum
 * `pflichtfeld` (Konzept 14). Sind nach dem Nachtragen alle da, wird die
 * Extraktions-Ampel gruen: Ein Mensch hat mehr Gewicht als ein Modell, und
 * eine Ampel, die rot bleibt, nachdem jemand alles eingetragen hat, sagt
 * nichts mehr.
 *
 * Nur fuer Belege, die noch nicht archiviert sind; danach ist der Beleg fest
 * (Konzept 19), und die Trigger sagen das deutlicher als jede Meldung hier.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '../db'
import type { Feldname } from '../extraktion/typen'
import { plausibilitaetPruefen } from '../pruefung/plausibilitaet'
import { aufbereitungEinreihen } from '../queue'
import { merkmaleImText } from '../lernen/merkmale'
import { merkmalLernen } from '../lernen/zuordnung'
import { aufgabenNeuZuweisen, belegartWechseln } from '../workflow/engine'

export class NachtragAbgelehnt extends Error {}

const MERKMALSNAME: Record<string, string> = {
  kundennummer: 'Kundennummer',
  vertragsnummer: 'Vertragsnummer',
  zaehlernummer: 'Zählernummer',
  objektnummer: 'Objektnummer',
}

export interface Nachtrag {
  /** Belegart von Hand -- stellt den Lauf um, solange keine Entscheidung darin liegt. */
  belegart?: string | null
  objektId?: string | null
  ordnungsgruppeId?: string | null
  kreditorId?: string | null
  rechnungsnummer?: string | null
  /** YYYY-MM-DD */
  rechnungsdatum?: string | null
  brutto?: number | null
  netto?: number | null
  steuer?: number | null
  leistungVon?: string | null
  leistungBis?: string | null
  ibanImBeleg?: string | null
  zahlungsziel?: string | null
  skontoProzent?: number | null
  skontoBis?: string | null
}

export interface Nachtragsauswahl {
  objekte: Array<{ id: string; objektnummer: string; bezeichnung: string }>
  gruppen: Array<{ id: string; name: string }>
  kreditoren: Array<{ id: string; name: string }>
}

/** Die Listen fuer das Formular -- alles unter der RLS, also nur das eigene Haus. */
export async function nachtragsauswahl(benutzerId: string): Promise<Nachtragsauswahl> {
  return alsBenutzer(benutzerId, async (c) => ({
    objekte: (
      await c.query<{ id: string; objektnummer: string; bezeichnung: string }>(
        'select id, objektnummer, bezeichnung from objekt order by objektnummer',
      )
    ).rows,
    gruppen: (
      await c.query<{ id: string; name: string }>(
        'select id, name from ordnungsgruppe where aktiv order by sortierung, name',
      )
    ).rows,
    kreditoren: (
      await c.query<{ id: string; name: string }>(
        "select id, name from kreditor where status = 'aktiv' order by name",
      )
    ).rows,
  }))
}

/** Ob am Beleg das fehlt, was ein Mensch nachtragen muesste. */
export function nachtragNoetig(zeile: {
  objektnummer: string | null
  kreditor: string | null
  belegart?: string | null
}): boolean {
  if (zeile.belegart === 'schriftverkehr') return zeile.objektnummer === null
  return zeile.objektnummer === null || zeile.kreditor === null
}

/**
 * Welche Pflichtfelder am Beleg noch fehlen -- fuer die Kennzeichnung im
 * Formular. Leer heisst: alles da (oder nichts verlangt).
 */
export async function fehlendePflichtfelder(benutzerId: string, dokumentId: string): Promise<Feldname[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ belegart: string }>('select belegart from dokument where id = $1', [
      dokumentId,
    ])
    const belegart = rows[0]?.belegart
    if (belegart === undefined) return []
    const pflicht = await pflichtfelderLadenAuf(c, belegart)
    return fehlendeVon(c, dokumentId, pflicht)
  })
}

async function pflichtfelderLadenAuf(c: PoolClient, belegart: string): Promise<Feldname[]> {
  const { rows } = await c.query<{ feldname: Feldname }>(
    'select feldname from pflichtfeld where belegart = $1 order by feldname',
    [belegart],
  )
  return rows.map((r) => r.feldname)
}

/** Je Pflichtfeld: ist es am Beleg gefuellt? Ein Verbund, eine Antwort. */
async function fehlendeVon(c: PoolClient, dokumentId: string, pflicht: readonly Feldname[]): Promise<Feldname[]> {
  if (pflicht.length === 0) return []
  const { rows } = await c.query<Record<Feldname, boolean>>(
    `select f.kreditor_id is not null       as kreditor_name,
            k.ust_id is not null            as kreditor_ust_id,
            f.rechnungsnummer is not null   as rechnungsnummer,
            f.rechnungsdatum is not null    as rechnungsdatum,
            f.leistung_von is not null      as leistung_von,
            f.leistung_bis is not null      as leistung_bis,
            f.netto is not null             as netto,
            f.steuer is not null            as steuer,
            f.brutto is not null            as brutto,
            f.iban_im_beleg is not null     as iban_im_beleg,
            f.zahlungsziel is not null      as zahlungsziel,
            f.skonto_prozent is not null    as skonto_prozent,
            f.skonto_bis is not null        as skonto_bis
       from rechnung_fakten f
       left join kreditor k on k.id = f.kreditor_id
      where f.dokument_id = $1`,
    [dokumentId],
  )
  const stand = rows[0]
  if (stand === undefined) return [...pflicht]
  return pflicht.filter((name) => stand[name] !== true)
}

async function vorhanden(c: PoolClient, tabelle: 'objekt' | 'ordnungsgruppe' | 'kreditor', id: string): Promise<boolean> {
  // Tabellenname aus einer festen Liste, nicht aus der Eingabe. Unter der
  // RLS: Eine Kennung aus einem fremden Haus gibt es hier nicht.
  const { rows } = await c.query<{ id: string }>(`select id from ${tabelle} where id = $1`, [id])
  return rows[0] !== undefined
}

const leer = (w: string | null | undefined): string | null => {
  const t = (w ?? '').trim()
  return t === '' ? null : t
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/

function datumPruefen(wert: string | null, name: string): string | null {
  if (wert !== null && !DATUM.test(wert)) {
    throw new NachtragAbgelehnt(`${name} hat nicht die Form JJJJ-MM-TT.`)
  }
  return wert
}

function zahlPruefen(wert: number | null | undefined, name: string): number | null {
  const z = wert ?? null
  if (z !== null && (!Number.isFinite(z) || z < 0)) {
    throw new NachtragAbgelehnt(`${name} muss eine Zahl ab 0 sein.`)
  }
  return z
}

export async function angabenNachtragen(
  benutzerId: string,
  dokumentId: string,
  n: Nachtrag,
): Promise<{ neuZugewiesen: number; pflichtfelderVollstaendig: boolean; gelernt: string[] }> {
  const objektId = leer(n.objektId)
  const ordnungsgruppeId = leer(n.ordnungsgruppeId)
  const kreditorId = leer(n.kreditorId)
  const rechnungsnummer = leer(n.rechnungsnummer)
  const rechnungsdatum = datumPruefen(leer(n.rechnungsdatum), 'Das Rechnungsdatum')
  const leistungVon = datumPruefen(leer(n.leistungVon), 'Der Leistungsbeginn')
  const leistungBis = datumPruefen(leer(n.leistungBis), 'Das Leistungsende')
  const zahlungsziel = datumPruefen(leer(n.zahlungsziel), 'Das Zahlungsziel')
  const skontoBis = datumPruefen(leer(n.skontoBis), 'Das Skontodatum')
  const brutto = zahlPruefen(n.brutto, 'Der Bruttobetrag')
  const netto = zahlPruefen(n.netto, 'Der Nettobetrag')
  const steuer = zahlPruefen(n.steuer, 'Der Steuerbetrag')
  const skontoProzent = zahlPruefen(n.skontoProzent, 'Der Skontosatz')
  const ibanImBeleg = leer(n.ibanImBeleg)?.replace(/\s+/g, '').toUpperCase() ?? null

  if (rechnungsnummer !== null && rechnungsnummer.length > 80) {
    throw new NachtragAbgelehnt('Die Rechnungsnummer ist zu lang.')
  }
  if (ibanImBeleg !== null && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(ibanImBeleg)) {
    throw new NachtragAbgelehnt('Die IBAN ist nicht lesbar.')
  }

  return alsBenutzer(benutzerId, async (c) => {
    const { rows: belege } = await c.query<{ status: string; belegart: string; mandant_id: string }>(
      'select status, belegart, mandant_id from dokument where id = $1',
      [dokumentId],
    )
    const beleg = belege[0]
    if (beleg === undefined) throw new NachtragAbgelehnt('Diesen Beleg gibt es nicht.')
    if (beleg.status === 'archiviert' || beleg.status === 'storniert') {
      throw new NachtragAbgelehnt('Der Beleg ist archiviert -- Änderungen nur über Storno und Neuerfassung.')
    }
    if (objektId !== null && !(await vorhanden(c, 'objekt', objektId))) {
      throw new NachtragAbgelehnt('Das gewählte Objekt gibt es nicht.')
    }
    if (ordnungsgruppeId !== null && !(await vorhanden(c, 'ordnungsgruppe', ordnungsgruppeId))) {
      throw new NachtragAbgelehnt('Die gewählte Ordnungsgruppe gibt es nicht.')
    }
    if (kreditorId !== null && !(await vorhanden(c, 'kreditor', kreditorId))) {
      throw new NachtragAbgelehnt('Den gewählten Kreditor gibt es nicht.')
    }

    const belegartNeu = leer(n.belegart)
    if (belegartNeu !== null && belegartNeu !== beleg.belegart) {
      if (!['rechnung', 'gutschrift', 'mahnung', 'schriftverkehr', 'sonstiges'].includes(belegartNeu)) {
        throw new NachtragAbgelehnt('Diese Belegart gibt es nicht.')
      }
      const ausgang = await belegartWechseln(c, dokumentId, belegartNeu, 'mensch', 'von Hand gewählt')
      if (ausgang === 'entschieden') {
        throw new NachtragAbgelehnt('Die Belegart lässt sich nur ändern, solange der Beleg keinen Stempel trägt.')
      }
      if (ausgang === 'kein_ablauf') {
        throw new NachtragAbgelehnt('Für diese Belegart gibt es keinen aktiven Ablauf — erst unter Abläufe anlegen.')
      }
      beleg.belegart = belegartNeu
    }

    const { rowCount } = await c.query(
      `update dokument
          set objekt_id = coalesce($2, objekt_id),
              ordnungsgruppe_id = coalesce($3, ordnungsgruppe_id)
        where id = $1`,
      [dokumentId, objektId, ordnungsgruppeId],
    )
    if (rowCount === 0) throw new NachtragAbgelehnt('Der Beleg lässt sich nicht ändern.')

    /*
     * Wer ein Objekt von Hand setzt, bestaetigt eine Zuordnung -- und das
     * System lernt daraus, was der Beleg an beschrifteten Nummern traegt
     * (Kundennummer, Vertragsnummer, Zaehlernummer). Der naechste Beleg
     * desselben Versorgers mit derselben Nummer wird gruen zugeordnet, ohne
     * dass jemand ein Merkmal pflegt (Konzept 15). Der Grund steht am
     * Beleg, mit dem, was gelernt wurde.
     */
    const gelernt: string[] = []
    if (objektId !== null) {
      const { rows: texte } = await c.query<{ text: string | null; kreditor_id: string | null }>(
        `select (select string_agg(s.text, ' ' order by s.seite) from dokument_seite s where s.dokument_id = d.id) as text,
                f.kreditor_id
           from dokument d left join rechnung_fakten f on f.dokument_id = d.id
          where d.id = $1`,
        [dokumentId],
      )
      const funde = merkmaleImText(texte[0]?.text ?? '')
      for (const fund of funde) {
        await merkmalLernen(c, {
          mandantId: beleg.mandant_id,
          kreditorId: kreditorId ?? texte[0]?.kreditor_id ?? null,
          merkmalstyp: fund.typ,
          wert: fund.wert,
          objektId,
        })
        gelernt.push(`${MERKMALSNAME[fund.typ] ?? fund.typ} ${fund.wert}`)
      }
      await c.query('update dokument set objekt_begruendung = $2 where id = $1', [
        dokumentId,
        gelernt.length === 0 ? 'von Hand zugeordnet' : `von Hand zugeordnet; gelernt: ${gelernt.join(', ')}`,
      ])
    }

    let pflichtfelderVollstaendig = true
    if (beleg.belegart !== 'schriftverkehr' && beleg.belegart !== 'sonstiges') {
      // Was ein Mensch eintraegt, gilt -- anders als bei der Extraktion, die
      // Vorhandenes nie ueberschreibt. Leere Felder lassen den Stand stehen.
      const jahr = rechnungsdatum === null ? null : Number(rechnungsdatum.slice(0, 4))
      await c.query(
        `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer, rechnungsdatum, brutto,
                                      wirtschaftsjahr, netto, steuer, leistung_von, leistung_bis,
                                      iban_im_beleg, zahlungsziel, skonto_prozent, skonto_bis)
         values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9::date, $10::date, $11, $12::date, $13, $14::date)
         on conflict (dokument_id) do update set
           kreditor_id     = coalesce(excluded.kreditor_id, rechnung_fakten.kreditor_id),
           rechnungsnummer = coalesce(excluded.rechnungsnummer, rechnung_fakten.rechnungsnummer),
           rechnungsdatum  = coalesce(excluded.rechnungsdatum, rechnung_fakten.rechnungsdatum),
           brutto          = coalesce(excluded.brutto, rechnung_fakten.brutto),
           wirtschaftsjahr = coalesce(excluded.wirtschaftsjahr, rechnung_fakten.wirtschaftsjahr),
           netto           = coalesce(excluded.netto, rechnung_fakten.netto),
           steuer          = coalesce(excluded.steuer, rechnung_fakten.steuer),
           leistung_von    = coalesce(excluded.leistung_von, rechnung_fakten.leistung_von),
           leistung_bis    = coalesce(excluded.leistung_bis, rechnung_fakten.leistung_bis),
           iban_im_beleg   = coalesce(excluded.iban_im_beleg, rechnung_fakten.iban_im_beleg),
           zahlungsziel    = coalesce(excluded.zahlungsziel, rechnung_fakten.zahlungsziel),
           skonto_prozent  = coalesce(excluded.skonto_prozent, rechnung_fakten.skonto_prozent),
           skonto_bis      = coalesce(excluded.skonto_bis, rechnung_fakten.skonto_bis)`,
        [
          dokumentId, kreditorId, rechnungsnummer, rechnungsdatum, brutto, jahr,
          netto, steuer, leistungVon, leistungBis, ibanImBeleg, zahlungsziel, skontoProzent, skontoBis,
        ],
      )

      // Sind die Pflichtfelder des Hauses jetzt alle da, ist die
      // Extraktions-Ampel gruen -- der Mensch hat sie bestaetigt.
      const pflicht = await pflichtfelderLadenAuf(c, beleg.belegart)
      const fehlt = await fehlendeVon(c, dokumentId, pflicht)
      pflichtfelderVollstaendig = fehlt.length === 0
      if (pflichtfelderVollstaendig) {
        await c.query(`update dokument set ampel_extraktion = 'gruen' where id = $1`, [dokumentId])
      }
    }

    // Die Pruefung gegen den neuen Stand, dann die Aufgaben an ihre Traeger.
    await plausibilitaetPruefen(c, dokumentId)
    const neuZugewiesen = await aufgabenNeuZuweisen(c, dokumentId)
    return { neuZugewiesen, pflichtfelderVollstaendig, gelernt }
  })
}

/**
 * Die Aufbereitung fuer einen Beleg noch einmal einreihen -- Texterkennung,
 * Extraktion, Zuordnung, wie beim Eingang. Fuer den Fall, dass die
 * Erkennung erst nach dem Eingang eingerichtet wurde (DMS_EXTRAKTION) oder
 * ein Stammdatum dazukam, das die Zuordnung braucht.
 *
 * Derselbe Auftrag wie beim Eingang und wie beim Wiederholen aus dem
 * Fehlerkorb; die Aufbereitung raeumt ihre Derivate selbst weg. Was ein
 * Mensch schon eingetragen hat, bleibt -- die Extraktion ueberschreibt nie.
 * Der Status geht auf `in_aufbereitung`, damit die Belegansicht wartet und
 * sich selbst neu laedt.
 */
export async function aufbereitungErneut(benutzerId: string, dokumentId: string): Promise<void> {
  await alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ mandant_id: string; status: string }>(
      'select mandant_id, status from dokument where id = $1',
      [dokumentId],
    )
    const beleg = rows[0]
    if (beleg === undefined) throw new NachtragAbgelehnt('Diesen Beleg gibt es nicht.')
    if (beleg.status === 'archiviert' || beleg.status === 'storniert') {
      throw new NachtragAbgelehnt('Ein archivierter Beleg wird nicht noch einmal aufbereitet.')
    }
    if (beleg.status === 'in_aufbereitung') {
      throw new NachtragAbgelehnt('Die Aufbereitung läuft bereits.')
    }
    await c.query(`update dokument set status = 'in_aufbereitung' where id = $1`, [dokumentId])
    await aufbereitungEinreihen({ dokumentId, mandantId: beleg.mandant_id, benutzerId }, c)
  })
}
