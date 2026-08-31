/**
 * Auswahl des Anbieters und Übernahme der Ergebnisse.
 *
 * Reihenfolge nach Konzept 13: Die strukturierte Rechnung geht immer vor.
 * Sie braucht kein Modell, kostet nichts und ist per Definition sicher —
 * erst wenn kein XML vorliegt, kommt ein Modell zum Zug.
 */

import type { PoolClient } from 'pg'
import { ollamaAnbieter } from './ollama'
import type { ErkanntesFeld, Extraktionsanbieter, Extraktionsanfrage } from './typen'
import { zugferdAnbieter } from './zugferd'

/**
 * Welcher Anbieter für die freie Erkennung zuständig ist.
 *
 * `keiner` ist die Vorgabe: Ohne ausdrückliche Einstellung wird nicht
 * geraten, und die Erfassung bleibt manuell. Das ist die ehrlichere
 * Voreinstellung als ein Modell, das niemand bestellt hat.
 */
function freierAnbieter(): Extraktionsanbieter | null {
  switch (process.env['DMS_EXTRAKTION'] ?? 'keiner') {
    case 'ollama':
      return ollamaAnbieter
    default:
      return null
  }
}

export interface Extraktionsbericht {
  quelle: 'zugferd' | 'ki' | 'keine'
  anzahl: number
  /** Minimum der Confidence über die Pflichtfelder (Konzept 14). */
  vertrauen: number | null
  ampel: 'gruen' | 'orange' | 'rot' | null
}

/** Pflichtfelder der Belegart Rechnung — sie bestimmen die Ampel. */
const PFLICHTFELDER = ['kreditor_name', 'rechnungsnummer', 'rechnungsdatum', 'brutto'] as const

/**
 * Das Extraktionsvertrauen ist das **Minimum** über die Pflichtfelder, nicht
 * der Durchschnitt: Ein unsicher gelesener Betrag wird nicht dadurch besser,
 * dass der Lieferantenname eindeutig war (Konzept 14).
 */
export function extraktionsvertrauen(felder: ErkanntesFeld[]): number | null {
  const werte = PFLICHTFELDER.map(
    (name) => felder.find((f) => f.feldname === name)?.confidence,
  )
  if (werte.some((w) => w === undefined)) return null // ein Pflichtfeld fehlt
  return Math.min(...(werte as number[]))
}

export function ampelAus(vertrauen: number | null): 'gruen' | 'orange' | 'rot' {
  if (vertrauen === null) return 'rot'
  if (vertrauen >= 0.95) return 'gruen'
  if (vertrauen >= 0.6) return 'orange'
  return 'rot'
}

/**
 * Erkennt die Felder und schreibt sie fort.
 *
 * `extraktion_feld` bekommt **jedes** Feld mit seiner Confidence und, sofern
 * bekannt, der Fundstelle. `rechnung_fakten` bekommt nur, was fachlich
 * gebraucht wird — und wird nie überschrieben, wenn ein Mensch den Wert
 * schon bestätigt hat.
 */
export async function extrahierenUndUebernehmen(
  c: PoolClient,
  anfrage: Extraktionsanfrage,
): Promise<Extraktionsbericht> {
  const anbieter: Extraktionsanbieter[] = [zugferdAnbieter]
  const frei = freierAnbieter()
  if (frei !== null) anbieter.push(frei)

  let ergebnis = null
  for (const kandidat of anbieter) {
    if (!(await kandidat.zustaendig(anfrage))) continue
    ergebnis = await kandidat.extrahieren(anfrage)
    if (ergebnis !== null) break
  }

  if (ergebnis === null) {
    // Kein Vorschlag ist ein zulaessiger Zustand, kein Fehler. Der Beleg
    // laeuft weiter und wird von Hand erfasst.
    await c.query(
      `update dokument set ampel_extraktion = 'rot' where id = $1 and ampel_extraktion is null`,
      [anfrage.dokumentId],
    )
    return { quelle: 'keine', anzahl: 0, vertrauen: null, ampel: 'rot' }
  }

  for (const feld of ergebnis.felder) {
    await c.query(
      `insert into extraktion_feld (dokument_id, feldname, wert_text, wert_zahl,
                                    wert_datum, confidence, seite, bbox, quelle, modell)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        anfrage.dokumentId,
        feld.feldname,
        feld.text ?? null,
        feld.zahl ?? null,
        feld.datum ?? null,
        feld.confidence,
        feld.seite ?? null,
        feld.bbox ?? null,
        ergebnis.quelle,
        ergebnis.modell ?? null,
      ],
    )
  }

  const nachName = new Map(ergebnis.felder.map((f) => [f.feldname, f]))
  const zahl = (name: string): number | null => nachName.get(name as never)?.zahl ?? null
  const datum = (name: string): string | null => nachName.get(name as never)?.datum ?? null
  const text = (name: string): string | null => nachName.get(name as never)?.text ?? null

  // Kreditor ueber die USt-ID oder den Namen zuordnen. Deterministisch und
  // ohne Lernspeicher -- der kommt spaeter (Konzept 15).
  const { rows: kreditoren } = await c.query<{ id: string }>(
    `select k.id from kreditor k, dokument d
      where d.id = $1 and k.mandant_id = d.mandant_id and k.status = 'aktiv'
        and (($2::text is not null and k.ust_id = $2)
             or ($3::text is not null and lower(k.name) = lower($3)))
      order by (k.ust_id = $2) desc
      limit 1`,
    [anfrage.dokumentId, text('kreditor_ust_id'), text('kreditor_name')],
  )

  await c.query(
    `insert into rechnung_fakten (dokument_id, kreditor_id, rechnungsnummer, rechnungsdatum,
                                  leistung_von, leistung_bis, netto, steuer, brutto,
                                  iban_im_beleg, zahlungsziel, skonto_prozent, skonto_bis)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (dokument_id) do update set
       kreditor_id     = coalesce(rechnung_fakten.kreditor_id, excluded.kreditor_id),
       rechnungsnummer = coalesce(rechnung_fakten.rechnungsnummer, excluded.rechnungsnummer),
       rechnungsdatum  = coalesce(rechnung_fakten.rechnungsdatum, excluded.rechnungsdatum),
       leistung_von    = coalesce(rechnung_fakten.leistung_von, excluded.leistung_von),
       leistung_bis    = coalesce(rechnung_fakten.leistung_bis, excluded.leistung_bis),
       netto           = coalesce(rechnung_fakten.netto, excluded.netto),
       steuer          = coalesce(rechnung_fakten.steuer, excluded.steuer),
       brutto          = coalesce(rechnung_fakten.brutto, excluded.brutto),
       iban_im_beleg   = coalesce(rechnung_fakten.iban_im_beleg, excluded.iban_im_beleg),
       zahlungsziel    = coalesce(rechnung_fakten.zahlungsziel, excluded.zahlungsziel),
       skonto_prozent  = coalesce(rechnung_fakten.skonto_prozent, excluded.skonto_prozent),
       skonto_bis      = coalesce(rechnung_fakten.skonto_bis, excluded.skonto_bis)`,
    [
      anfrage.dokumentId,
      kreditoren[0]?.id ?? null,
      text('rechnungsnummer'),
      datum('rechnungsdatum'),
      datum('leistung_von'),
      datum('leistung_bis'),
      zahl('netto'),
      zahl('steuer'),
      zahl('brutto'),
      text('iban_im_beleg'),
      datum('zahlungsziel'),
      zahl('skonto_prozent'),
      datum('skonto_bis'),
    ],
  )

  const vertrauen = extraktionsvertrauen(ergebnis.felder)
  const ampel = ampelAus(vertrauen)
  await c.query(`update dokument set ampel_extraktion = $2 where id = $1`, [
    anfrage.dokumentId,
    ampel,
  ])

  return {
    quelle: ergebnis.quelle === 'zugferd' ? 'zugferd' : 'ki',
    anzahl: ergebnis.felder.length,
    vertrauen,
    ampel,
  }
}
