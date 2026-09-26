/**
 * Die Rechnungsdaten eines Belegs -- jedes Feld mit Wert und Herkunft.
 *
 * Bis hierher zeigte die Belegansicht nur den Betrag; die uebrigen zwoelf
 * erkannten Felder standen in `rechnung_fakten` und `extraktion_feld`, und
 * niemand sah sie. Wer beurteilen soll, ob die Erkennung stimmt, muss sehen,
 * **was** erkannt wurde und **wie sicher** -- sonst prueft er die Rechnung
 * gegen nichts.
 *
 * Herkunft je Feld: `zugferd` (aus dem XML, Vertrauen 1), `ki` (Modell, mit
 * seinem Vertrauen), `regel`, `mensch` (jemand hat den erkannten Wert
 * ueberschrieben) oder null (eingetragen, ohne dass eine Erkennung dazu
 * vorliegt -- Nachtrag, Uebernahme, Seed). Ein Pflichtfeld ohne Wert steht
 * als "fehlt" da, nicht als Luecke.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '../db'
import type { Feldname } from '../extraktion/typen'
import { FELDER, pflichtfelderFuerDokument } from '../stammdaten/pflichtfeld'

export type Herkunft = 'zugferd' | 'ki' | 'regel' | 'mensch' | null

export interface Rechnungsdatum {
  feld: Feldname
  label: string
  /** Anzeigefertig: Betrag mit Euro, Datum deutsch, Prozent mit Zeichen. */
  wert: string | null
  vertrauen: number | null
  herkunft: Herkunft
  pflicht: boolean
}

export interface Rechnungsdaten {
  belegart: string
  ampelExtraktion: string | null
  zeilen: Rechnungsdatum[]
  /** Beschriftungen der Pflichtfelder ohne Wert. */
  fehlendePflicht: string[]
}

const BELEGARTEN_MIT_FAKTEN = new Set(['rechnung', 'gutschrift', 'mahnung'])
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const LABEL = new Map<Feldname, string>(FELDER.map((f) => [f.name, f.label]))

const ZAHLEN: ReadonlySet<Feldname> = new Set(['netto', 'steuer', 'brutto', 'skonto_prozent'])
const DATEN: ReadonlySet<Feldname> = new Set(['rechnungsdatum', 'leistung_von', 'leistung_bis', 'zahlungsziel', 'skonto_bis'])

function deutschesDatum(iso: string): string {
  const [j, m, t] = iso.split('-')
  return `${t}.${m}.${j}`
}

function anzeigen(feld: Feldname, roh: string | number | null): string | null {
  if (roh === null) return null
  if (feld === 'skonto_prozent') return `${Number(roh).toLocaleString('de-DE')} %`
  if (ZAHLEN.has(feld)) return euro.format(Number(roh))
  if (DATEN.has(feld)) return deutschesDatum(String(roh))
  return String(roh)
}

/** Ob der Wert in den Fakten dem erkannten entspricht -- sonst hat ein Mensch ihn geaendert. */
function gleich(feld: Feldname, fakt: string | number | null, erkannt: string | number | null): boolean {
  if (fakt === null || erkannt === null) return false
  if (ZAHLEN.has(feld)) return Math.abs(Number(fakt) - Number(erkannt)) < 0.005
  return String(fakt).trim().toLowerCase().replace(/\s+/g, '') === String(erkannt).trim().toLowerCase().replace(/\s+/g, '')
}

export async function rechnungsdatenLaden(benutzerId: string, dokumentId: string): Promise<Rechnungsdaten | null> {
  return alsBenutzer(benutzerId, (c) => rechnungsdatenAuf(c, dokumentId))
}

export async function rechnungsdatenAuf(c: PoolClient, dokumentId: string): Promise<Rechnungsdaten | null> {
  const { rows } = await c.query<Record<string, string | null>>(
    `select d.belegart, d.ampel_extraktion,
            k.name as kreditor_name, k.ust_id as kreditor_ust_id,
            f.rechnungsnummer,
            to_char(f.rechnungsdatum, 'YYYY-MM-DD') as rechnungsdatum,
            to_char(f.leistung_von, 'YYYY-MM-DD') as leistung_von,
            to_char(f.leistung_bis, 'YYYY-MM-DD') as leistung_bis,
            f.netto::text as netto, f.steuer::text as steuer, f.brutto::text as brutto,
            f.iban_im_beleg,
            to_char(f.zahlungsziel, 'YYYY-MM-DD') as zahlungsziel,
            f.skonto_prozent::text as skonto_prozent,
            to_char(f.skonto_bis, 'YYYY-MM-DD') as skonto_bis
       from dokument d
       left join rechnung_fakten f on f.dokument_id = d.id
       left join kreditor k on k.id = f.kreditor_id
      where d.id = $1`,
    [dokumentId],
  )
  const fakten = rows[0]
  if (fakten === undefined) return null
  const belegart = fakten['belegart'] ?? 'rechnung'
  if (!BELEGARTEN_MIT_FAKTEN.has(belegart)) {
    return { belegart, ampelExtraktion: fakten['ampel_extraktion'], zeilen: [], fehlendePflicht: [] }
  }

  // Je Feld die sicherste Erkennung -- eine Zeitfolge gibt es in der
  // Tabelle nicht, und bei einer zweiten Aufbereitung zaehlt ohnehin die,
  // die den Wert in die Fakten gebracht hat.
  const { rows: erkannt } = await c.query<{
    feldname: Feldname
    wert_text: string | null
    wert_zahl: string | null
    wert_datum: string | null
    confidence: string | null
    quelle: Herkunft
  }>(
    `select distinct on (feldname) feldname, wert_text, wert_zahl::text as wert_zahl,
            to_char(wert_datum, 'YYYY-MM-DD') as wert_datum, confidence::text as confidence, quelle
       from extraktion_feld
      where dokument_id = $1
      order by feldname, confidence desc nulls last`,
    [dokumentId],
  )
  const erkanntJeFeld = new Map(erkannt.map((e) => [e.feldname, e]))
  const pflicht = new Set(await pflichtfelderFuerDokument(c, dokumentId))

  const zeilen: Rechnungsdatum[] = FELDER.map(({ name: feld, label }) => {
    const fakt = fakten[feld] ?? null
    const e = erkanntJeFeld.get(feld)
    const erkannterWert = e === undefined ? null : (e.wert_zahl ?? e.wert_datum ?? e.wert_text)
    let herkunft: Herkunft = null
    let vertrauen: number | null = null
    if (fakt !== null && e !== undefined) {
      if (gleich(feld, fakt, erkannterWert)) {
        herkunft = e.quelle
        vertrauen = e.confidence === null ? null : Number(e.confidence)
      } else {
        herkunft = 'mensch'
      }
    }
    return {
      feld,
      label,
      wert: anzeigen(feld, fakt),
      vertrauen,
      herkunft,
      pflicht: pflicht.has(feld),
    }
  })

  return {
    belegart,
    ampelExtraktion: fakten['ampel_extraktion'],
    zeilen,
    fehlendePflicht: zeilen.filter((z) => z.pflicht && z.wert === null).map((z) => z.label),
  }
}

export { LABEL as FELDBESCHRIFTUNG }
