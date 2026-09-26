/**
 * Regelbasierte Erkennung -- was sich mit einem Muster sicher lesen laesst,
 * liest kein Modell.
 *
 * Beim Bedienen gefunden: Das Modell uebersah "Rechnungsdatum 16.08.26" und
 * "Faelligkeitsdatum 30.08.26" (zweistelliges Jahr), und eine IBAN mit
 * Leerzeichen kam als Text mit Sternchen an. Eine IBAN hat eine
 * Pruefziffer, eine USt-IdNr. ein festes Format, ein Datum steht hinter
 * seinem Wort -- dafuer braucht es keine Milliarden Parameter, sondern
 * einen regulaeren Ausdruck. Dieselbe Rangordnung wie bei Objekt und
 * Kategorie (Konzept 15): **Deterministisches schlaegt Geratenes.**
 *
 * Die Regeln laufen immer, auch ohne Modell, und sie laufen in
 * Millisekunden. Das Modell ergaenzt, was Regeln nicht sicher greifen
 * (Betraege in Tabellen, Leistungszeitraeume in Prosa). Beim Zusammenfuehren
 * gewinnt je Feld das hoehere Vertrauen; bei Gleichstand die Regel.
 *
 * Kein Vertrauen 1: Die Eins ist der strukturierten Rechnung vorbehalten
 * (Konzept 14). Eine IBAN mit richtiger Pruefziffer bekommt 0,98 -- sie
 * kann trotzdem die IBAN eines Dritten auf dem Beleg sein.
 */

import { betragLesen } from './zahlen'
import type { ErkanntesFeld, Extraktionsanbieter, Extraktionsanfrage, Extraktionsergebnis } from './typen'

const DATUM = String.raw`(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2})`
const BETRAG = String.raw`(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2})`

/** dd.mm.yyyy, dd.mm.yy oder yyyy-mm-dd -> ISO. Zweistellige Jahre sind 20xx. */
export function datumLesen(roh: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roh)
  if (iso) return gueltig(iso[1]!, iso[2]!, iso[3]!)
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(roh)
  if (!de) return null
  const jahr = de[3]!.length === 2 ? `20${de[3]}` : de[3]!
  return gueltig(jahr, de[2]!.padStart(2, '0'), de[1]!.padStart(2, '0'))
}

function gueltig(j: string, m: string, t: string): string | null {
  const monat = Number(m)
  const tag = Number(t)
  const jahr = Number(j)
  if (monat < 1 || monat > 12 || tag < 1 || tag > 31 || jahr < 1990 || jahr > 2100) return null
  return `${j}-${m}-${t}`
}

/** IBAN mit Pruefziffer (ISO 7064, Mod 97-10). */
/** IBAN-Laengen je Land -- die Pruefziffer allein reicht nicht (siehe unten). */
const IBAN_LAENGE: Record<string, number> = {
  DE: 22, AT: 20, CH: 21, NL: 18, BE: 16, FR: 27, IT: 27, ES: 24, LU: 20, PL: 28, DK: 18, SE: 24, NO: 15, FI: 18, GB: 22, IE: 22, PT: 25, CZ: 24,
}

export function ibanGueltig(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  // "RF63..." ist eine Zahlungsreferenz (ISO 11649) und besteht dieselbe
  // Mod-97-Pruefung -- beim Bedienen als IBAN in den Vorschlag geraten.
  // RF ist kein Land; und wo das Land bekannt ist, muss die Laenge stimmen.
  const land = s.slice(0, 2)
  if (land === 'RF') return false
  const laenge = IBAN_LAENGE[land]
  if (laenge !== undefined && s.length !== laenge) return false
  const umgestellt = s.slice(4) + s.slice(0, 4)
  let rest = 0
  for (const zeichen of umgestellt) {
    const wert = /\d/.test(zeichen) ? zeichen : String(zeichen.charCodeAt(0) - 55)
    for (const ziffer of wert) rest = (rest * 10 + Number(ziffer)) % 97
  }
  return rest === 1
}

function erster(text: string, muster: RegExp): string | null {
  const m = muster.exec(text)
  return m?.[1] ?? null
}

function letzter(text: string, muster: RegExp): string | null {
  let ergebnis: string | null = null
  for (const m of text.matchAll(new RegExp(muster.source, muster.flags.includes('g') ? muster.flags : muster.flags + 'g'))) {
    ergebnis = m[1] ?? ergebnis
  }
  return ergebnis
}

export function regelnAnwenden(seiten: ReadonlyArray<{ seite: number; text: string }>): ErkanntesFeld[] {
  const text = [...seiten]
    .sort((a, b) => a.seite - b.seite)
    .map((s) => s.text)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
  const felder: ErkanntesFeld[] = []
  const feld = (f: ErkanntesFeld) => felder.push({ ...f, quelle: 'regel' })

  // IBAN: alle Kandidaten mit Leerzeichen zusammenziehen, die erste mit
  // gueltiger Pruefziffer zaehlt. Maskierte ("DE46 **** ...") fallen durch.
  for (const m of text.matchAll(/\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?)\b/g)) {
    const iban = m[1]!.replace(/\s+/g, '')
    if (ibanGueltig(iban)) {
      feld({ feldname: 'iban_im_beleg', text: iban, confidence: 0.98 })
      break
    }
  }

  const ust = erster(text, /\b(DE ?\d{9}|ATU ?\d{8}|CHE[- ]?\d{3}\.?\d{3}\.?\d{3}(?: ?MWST)?)\b/)
  // Bewusst unter dem Deckel des Modells (0,95): Ein Beleg nennt oft mehrere
  // USt-IdNr. -- die des Ausstellers und die einer abgerechneten Stadt --,
  // und welche zum Rechnungssteller gehoert, liest das Modell aus dem
  // Zusammenhang. Die Regel fuellt nur, wo das Modell nichts hat.
  if (ust !== null) feld({ feldname: 'kreditor_ust_id', text: ust.replace(/\s+/g, ''), confidence: 0.9 })

  const email = erster(text, /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/)
  if (email !== null) feld({ feldname: 'kreditor_email', text: email.toLowerCase(), confidence: 0.96 })

  const nummer = erster(text, /Rechnungs?[- ]?(?:nummer|nr\.?|no\.?)[ :]*([A-Z0-9][A-Z0-9\-/.]{2,})/i)
  if (nummer !== null) feld({ feldname: 'rechnungsnummer', text: nummer.replace(/[.,:;]+$/, ''), confidence: 0.96 })

  const rechnungsdatum =
    erster(text, new RegExp(String.raw`Rechnungsdatum[ :]*${DATUM}`, 'i')) ??
    erster(text, new RegExp(String.raw`\bRechnung(?:s-?Nr\.?[ :]*\S+)?\s+vom[ :]*${DATUM}`, 'i'))
  const rd = rechnungsdatum === null ? null : datumLesen(rechnungsdatum)
  if (rd !== null) feld({ feldname: 'rechnungsdatum', datum: rd, confidence: 0.96 })

  // Das Datum steht oft nicht direkt hinter dem Wort, sondern eine
  // Tabellenzeile tiefer ("Faelligkeitsdatum Verw.-Zweck / 1,80 EUR 30.08.26").
  // Deshalb ein kurzes Fenster; "1,80" ist kein Datum und stoert nicht.
  const faellig = erster(
    text,
    new RegExp(String.raw`(?:F[äa]lligkeits?datum|f[äa]llig(?: am| bis| zum)?|zahlbar bis(?: zum)?|Zahlungsziel|Zahlbar am)[\s\S]{0,60}?${DATUM}`, 'i'),
  )
  const zz = faellig === null ? null : datumLesen(faellig)
  if (zz !== null) feld({ feldname: 'zahlungsziel', datum: zz, confidence: 0.9 })
  else if (rd !== null) {
    const tage = erster(text, /(?:zahlbar|Zahlung)\s+(?:innerhalb\s+von\s+|binnen\s+)(\d{1,3})\s+Tag/i)
    if (tage !== null) {
      const d = new Date(`${rd}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + Number(tage))
      feld({ feldname: 'zahlungsziel', datum: d.toISOString().slice(0, 10), confidence: 0.7 })
    }
  }

  const zeitraum = new RegExp(String.raw`Leistungs(?:zeitraum|datum)[ :]*${DATUM}(?:\s*(?:-|–|bis)\s*${DATUM})?`, 'i').exec(text)
  if (zeitraum) {
    const von = datumLesen(zeitraum[1]!)
    const bis = zeitraum[2] === undefined ? von : datumLesen(zeitraum[2])
    if (von !== null) feld({ feldname: 'leistung_von', datum: von, confidence: 0.85 })
    if (bis !== null) feld({ feldname: 'leistung_bis', datum: bis, confidence: 0.85 })
  }

  const brutto = letzter(
    text,
    new RegExp(String.raw`(?:Gesamtbetrag|Rechnungsbetrag|Bruttobetrag|Endbetrag|Gesamtsumme|zu zahlen(?:der Betrag)?)(?: \(inkl\.? ?MwSt\.?\))?[ :]*(?:EUR|€)? ?${BETRAG} ?(?:EUR|€)?`, 'i'),
  )
  const b = brutto === null ? null : betragLesen(brutto)
  if (b !== null) feld({ feldname: 'brutto', zahl: b, confidence: 0.75 })

  const netto = letzter(text, new RegExp(String.raw`(?:Nettobetrag|Netto(?:summe)?)[ :]*(?:EUR|€)? ?${BETRAG}`, 'i'))
  const n = netto === null ? null : betragLesen(netto)
  if (n !== null) feld({ feldname: 'netto', zahl: n, confidence: 0.6 })

  const steuer = letzter(text, new RegExp(String.raw`(?:MwSt\.?|USt\.?|Umsatzsteuer|Mehrwertsteuer)(?: ?\d{1,2}(?:,\d)? ?%)?[ :]*(?:EUR|€)? ?${BETRAG}`, 'i'))
  const st = steuer === null ? null : betragLesen(steuer)
  if (st !== null) feld({ feldname: 'steuer', zahl: st, confidence: 0.5 })

  const skonto = /(\d{1,2}(?:,\d)?) ?% ?Skonto/i.exec(text) ?? /Skonto(?: von)? (\d{1,2}(?:,\d)?) ?%/i.exec(text)
  if (skonto) {
    const p = betragLesen(skonto[1]!)
    if (p !== null) feld({ feldname: 'skonto_prozent', zahl: p, confidence: 0.8 })
    const bis = erster(text, new RegExp(String.raw`Skonto[^.\n]{0,40}?bis(?: zum)?[ :]*${DATUM}`, 'i'))
    const sb = bis === null ? null : datumLesen(bis)
    if (sb !== null) feld({ feldname: 'skonto_bis', datum: sb, confidence: 0.8 })
  }

  return felder
}

export const regelAnbieter: Extraktionsanbieter = {
  name: 'regeln',
  async zustaendig(anfrage: Extraktionsanfrage): Promise<boolean> {
    return anfrage.seiten.some((s) => s.text.trim() !== '')
  },
  async extrahieren(anfrage: Extraktionsanfrage): Promise<Extraktionsergebnis | null> {
    const felder = regelnAnwenden(anfrage.seiten)
    return felder.length === 0 ? null : { felder, quelle: 'regel', modell: 'regeln' }
  },
}
