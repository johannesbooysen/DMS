/**
 * Strukturierte Rechnungen: ZUGFeRD und XRechnung.
 *
 * Diese Belege tragen ihre Daten als XML mit — im PDF eingebettet (ZUGFeRD,
 * Factur-X) oder als reine XML-Datei (XRechnung). Es gibt nichts zu raten:
 * Das XML ist der führende Datensatz, das PDF nur die Ansicht (Konzept 5).
 * Das Extraktionsvertrauen ist deshalb per Definition 1,0 (Konzept 14).
 *
 * Das ist der einzige Weg ohne Modell und ohne laufende Kosten — und sein
 * Anteil wächst, seit die E-Rechnung im B2B-Bereich verpflichtend ist.
 */

import { XMLParser } from 'fast-xml-parser'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { betragLesen } from './zahlen'
import type {
  ErkanntesFeld,
  Extraktionsanbieter,
  Extraktionsanfrage,
  Extraktionsergebnis,
  Feldname,
} from './typen'

/** Dateinamen, unter denen die Norm das XML im PDF ablegt. */
const ANHANGNAMEN = [
  'factur-x.xml',
  'zugferd-invoice.xml',
  'xrechnung.xml',
  'order-x.xml',
]

const parser = new XMLParser({
  ignoreAttributes: false,
  // Namensräume abschneiden: rsm:CrossIndustryInvoice und
  // ubl:Invoice unterscheiden sich sonst in jedem Pfad.
  transformTagName: (name) => name.replace(/^.*:/, ''),
})

/** Holt das eingebettete XML aus einem PDF, falls vorhanden. */
export async function xmlAusPdf(inhalt: Buffer): Promise<string | null> {
  if (inhalt.subarray(0, 4).toString('latin1') !== '%PDF') return null

  const ladeauftrag = getDocument({ data: new Uint8Array(inhalt), useSystemFonts: false })
  try {
    const doc = await ladeauftrag.promise
    const anhaenge = await doc.getAttachments()
    if (anhaenge === null || anhaenge === undefined) return null

    // pdfjs liefert je nach Fassung eine Map oder ein gewoehnliches Objekt.
    const eintraege =
      anhaenge instanceof Map
        ? [...anhaenge.entries()]
        : Object.entries(anhaenge as Record<string, unknown>)

    for (const [kennung, anhang] of eintraege) {
      const beschreibung = anhang as { filename?: string; content?: Uint8Array | null }
      const name = (beschreibung.filename ?? kennung).toLowerCase()
      if (!ANHANGNAMEN.includes(name)) continue

      // Seit pdfjs 6 traegt die Liste nur die Metadaten; der Inhalt wird
      // einzeln geholt. Aeltere Fassungen liefern ihn gleich mit.
      const daten = beschreibung.content ?? (await doc.getAttachmentContent(kennung))
      if (daten === null || daten === undefined) continue
      return Buffer.from(daten).toString('utf8')
    }
    return null
  } catch {
    // Ein beschaedigtes PDF ist kein Grund, den Beleg zu verlieren -- er geht
    // dann eben den gewoehnlichen Weg.
    return null
  } finally {
    await ladeauftrag.destroy()
  }
}

/** Reine XRechnung: XML ohne PDF-Huelle. */
export function istXmlRechnung(inhalt: Buffer): boolean {
  if (inhalt.subarray(0, 4).toString('latin1') === '%PDF') return false
  const anfang = inhalt.subarray(0, 2048).toString('utf8')
  return anfang.includes('CrossIndustryInvoice') || /[:<]Invoice[\s>]/.test(anfang)
}

/** Sucht rekursiv den ersten Wert unter einem Pfad von Elementnamen. */
function wert(baum: unknown, pfad: string[]): string | null {
  let stelle: unknown = baum
  for (const name of pfad) {
    if (stelle === null || typeof stelle !== 'object') return null
    stelle = (stelle as Record<string, unknown>)[name]
    if (Array.isArray(stelle)) stelle = stelle[0]
  }
  if (stelle === null || stelle === undefined) return null
  if (typeof stelle === 'object') {
    // Elemente mit Attributen liefert der Parser als Objekt mit #text.
    const text = (stelle as Record<string, unknown>)['#text']
    return text === undefined ? null : String(text)
  }
  return String(stelle)
}

/** ZUGFeRD-Datum: 102 = JJJJMMTT. */
function datumLesen(roh: string | null): string | null {
  if (roh === null) return null
  const knapp = roh.trim()
  if (/^\d{8}$/.test(knapp)) {
    return `${knapp.slice(0, 4)}-${knapp.slice(4, 6)}-${knapp.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(knapp)) return knapp.slice(0, 10)
  return null
}

// Auch hier der gemeinsame Auswerter: ZUGFeRD schreibt zwar den Punkt vor,
// aber ein Erzeuger, der sich nicht daran haelt, soll nicht den Betrag
// verhundertfachen.
const zahlLesen = betragLesen

/**
 * Liest die Felder aus dem XML.
 *
 * Abgedeckt sind die beiden Formate, die in Deutschland vorkommen:
 * CrossIndustryInvoice (ZUGFeRD, Factur-X) und UBL Invoice (XRechnung).
 */
export function felderAusXml(xml: string): ErkanntesFeld[] {
  const baum = parser.parse(xml) as Record<string, unknown>
  const felder: ErkanntesFeld[] = []

  const nimm = (feldname: Feldname, roh: string | null, art: 'text' | 'zahl' | 'datum') => {
    if (roh === null || roh.trim() === '') return
    if (art === 'zahl') {
      const zahl = zahlLesen(roh)
      if (zahl !== null) felder.push({ feldname, zahl, confidence: 1 })
      return
    }
    if (art === 'datum') {
      const datum = datumLesen(roh)
      if (datum !== null) felder.push({ feldname, datum, confidence: 1 })
      return
    }
    felder.push({ feldname, text: roh.trim(), confidence: 1 })
  }

  const cii = baum['CrossIndustryInvoice'] as Record<string, unknown> | undefined
  if (cii !== undefined) {
    nimm('rechnungsnummer', wert(cii, ['ExchangedDocument', 'ID']), 'text')
    nimm(
      'rechnungsdatum',
      wert(cii, ['ExchangedDocument', 'IssueDateTime', 'DateTimeString']),
      'datum',
    )
    const handel = ['SupplyChainTradeTransaction']
    nimm(
      'kreditor_name',
      wert(cii, [...handel, 'ApplicableHeaderTradeAgreement', 'SellerTradeParty', 'Name']),
      'text',
    )
    nimm(
      'kreditor_ust_id',
      wert(cii, [
        ...handel,
        'ApplicableHeaderTradeAgreement',
        'SellerTradeParty',
        'SpecifiedTaxRegistration',
        'ID',
      ]),
      'text',
    )
    const summen = [...handel, 'ApplicableHeaderTradeSettlement', 'SpecifiedTradeSettlementHeaderMonetarySummation']
    nimm('netto', wert(cii, [...summen, 'TaxBasisTotalAmount']), 'zahl')
    nimm('steuer', wert(cii, [...summen, 'TaxTotalAmount']), 'zahl')
    nimm('brutto', wert(cii, [...summen, 'GrandTotalAmount']), 'zahl')
    nimm(
      'iban_im_beleg',
      wert(cii, [
        ...handel,
        'ApplicableHeaderTradeSettlement',
        'SpecifiedTradeSettlementPaymentMeans',
        'PayeePartyCreditorFinancialAccount',
        'IBANID',
      ]),
      'text',
    )
    const zeitraum = [...handel, 'ApplicableHeaderTradeSettlement', 'BillingSpecifiedPeriod']
    nimm('leistung_von', wert(cii, [...zeitraum, 'StartDateTime', 'DateTimeString']), 'datum')
    nimm('leistung_bis', wert(cii, [...zeitraum, 'EndDateTime', 'DateTimeString']), 'datum')
    return felder
  }

  const ubl = baum['Invoice'] as Record<string, unknown> | undefined
  if (ubl !== undefined) {
    nimm('rechnungsnummer', wert(ubl, ['ID']), 'text')
    nimm('rechnungsdatum', wert(ubl, ['IssueDate']), 'datum')
    nimm('kreditor_name', wert(ubl, ['AccountingSupplierParty', 'Party', 'PartyName', 'Name']), 'text')
    nimm(
      'kreditor_ust_id',
      wert(ubl, ['AccountingSupplierParty', 'Party', 'PartyTaxScheme', 'CompanyID']),
      'text',
    )
    nimm('netto', wert(ubl, ['LegalMonetaryTotal', 'TaxExclusiveAmount']), 'zahl')
    nimm('brutto', wert(ubl, ['LegalMonetaryTotal', 'TaxInclusiveAmount']), 'zahl')
    nimm('steuer', wert(ubl, ['TaxTotal', 'TaxAmount']), 'zahl')
    nimm(
      'iban_im_beleg',
      wert(ubl, ['PaymentMeans', 'PayeeFinancialAccount', 'ID']),
      'text',
    )
    nimm('leistung_von', wert(ubl, ['InvoicePeriod', 'StartDate']), 'datum')
    nimm('leistung_bis', wert(ubl, ['InvoicePeriod', 'EndDate']), 'datum')
    return felder
  }

  return felder
}

export const zugferdAnbieter: Extraktionsanbieter = {
  name: 'zugferd',

  async zustaendig(anfrage: Extraktionsanfrage): Promise<boolean> {
    if (istXmlRechnung(anfrage.inhalt)) return true
    return (await xmlAusPdf(anfrage.inhalt)) !== null
  },

  async extrahieren(anfrage: Extraktionsanfrage): Promise<Extraktionsergebnis | null> {
    const xml = istXmlRechnung(anfrage.inhalt)
      ? anfrage.inhalt.toString('utf8')
      : await xmlAusPdf(anfrage.inhalt)
    if (xml === null) return null

    const felder = felderAusXml(xml)
    if (felder.length === 0) return null

    return { felder, quelle: 'zugferd', modell: null }
  },
}
