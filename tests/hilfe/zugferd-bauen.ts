/**
 * Erzeugt strukturierte Rechnungen für Tests.
 *
 * Synthetisch, wie alle Fixtures. Das XML folgt dem Aufbau von ZUGFeRD
 * (CrossIndustryInvoice) beziehungsweise XRechnung (UBL) — verkürzt auf die
 * Felder, die wir auslesen.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'

export interface Rechnungsdaten {
  rechnungsnummer: string
  datum: string
  kreditor: string
  ustId?: string
  netto: number
  steuer: number
  brutto: number
  iban?: string
  leistungVon?: string
  leistungBis?: string
}

const knapp = (datum: string): string => datum.replace(/-/g, '')

export function ciiXml(d: Rechnungsdaten): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>${d.rechnungsnummer}</ram:ID>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${knapp(d.datum)}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${d.kreditor}</ram:Name>
        ${
          d.ustId === undefined
            ? ''
            : `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${d.ustId}</ram:ID></ram:SpecifiedTaxRegistration>`
        }
      </ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      ${
        d.iban === undefined
          ? ''
          : `<ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${d.iban}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>`
      }
      ${
        d.leistungVon === undefined
          ? ''
          : `<ram:BillingSpecifiedPeriod>
        <ram:StartDateTime><udt:DateTimeString format="102">${knapp(d.leistungVon)}</udt:DateTimeString></ram:StartDateTime>
        <ram:EndDateTime><udt:DateTimeString format="102">${knapp(d.leistungBis ?? d.leistungVon)}</udt:DateTimeString></ram:EndDateTime>
      </ram:BillingSpecifiedPeriod>`
      }
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>${d.netto.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${d.steuer.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${d.brutto.toFixed(2)}</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

export function ublXml(d: Rechnungsdaten): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${d.rechnungsnummer}</cbc:ID>
  <cbc:IssueDate>${d.datum}</cbc:IssueDate>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${d.kreditor}</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${d.steuer.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">${d.netto.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${d.brutto.toFixed(2)}</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
</ubl:Invoice>`
}

/** Ein PDF mit eingebettetem XML — so kommt eine ZUGFeRD-Rechnung herein. */
export async function zugferdPdf(d: Rechnungsdaten): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const schrift = await doc.embedFont(StandardFonts.Helvetica)
  const seite = doc.addPage([595, 842])

  let y = 780
  for (const zeile of [
    d.kreditor,
    `Rechnung ${d.rechnungsnummer} vom ${d.datum}`,
    `Netto ${d.netto.toFixed(2)} EUR, Steuer ${d.steuer.toFixed(2)} EUR`,
    `Gesamt ${d.brutto.toFixed(2)} EUR`,
  ]) {
    seite.drawText(zeile, { x: 60, y, size: 11, font: schrift })
    y -= 18
  }

  await doc.attach(Buffer.from(ciiXml(d), 'utf8'), 'factur-x.xml', {
    mimeType: 'text/xml',
    description: 'Rechnungsdaten',
  })
  return Buffer.from(await doc.save())
}
