/**
 * Tests der regelbasierten Erkennung und des Zusammenfuehrens mit dem
 * Modell. Der Text ist erfunden, aber in der Form eines echten Belegs, an
 * dem das Modell scheiterte: zweistellige Jahreszahlen, IBAN mit
 * Leerzeichen, Faelligkeitsdatum in einer Tabellenzeile.
 */

import { describe, expect, it } from 'vitest'
import { zusammenfuehren } from '../src/extraktion'
import { datumLesen, ibanGueltig, regelnAnwenden } from '../src/extraktion/regeln'

const BELEG = `Parkhaus Musterstadt GmbH, Beispielweg 1, DE-00000 Musterstadt
Gesamtbetrag (inkl. MwSt.) Fälligkeitsdatum Verw.-Zweck
1,80 € 30.08.26 RF00ABC
Bank Musterbank BIC IBAN MUSTDEFFXXX DE02 1203 0000 0000 2020 51
Rechnungsnummer 10018074 Rechnungsdatum 16.08.26 Aussteller Parkhaus Musterstadt GmbH
Rückfragen an rechnung@parkhaus-musterstadt.invalid
Parkvorgang 2026-06-02, 2h, Stadt Musterstadt - UST-ID: DE131948739
Nettobetrag MwSt. Gesamtbetrag 0% MwSt. 1,80 € 0,00 € 1,80 € Gesamtbetrag 1,80 €`

describe('Bausteine', () => {
  it('liest deutsche Daten mit zwei- und vierstelligem Jahr und ISO', () => {
    expect(datumLesen('30.08.26')).toBe('2026-08-30')
    expect(datumLesen('1.9.2026')).toBe('2026-09-01')
    expect(datumLesen('2026-06-02')).toBe('2026-06-02')
    expect(datumLesen('31.13.2026')).toBeNull()
  })

  it('prueft die IBAN ueber die Pruefziffer', () => {
    expect(ibanGueltig('DE02 1203 0000 0000 2020 51')).toBe(true)
    expect(ibanGueltig('DE02120300000000202052')).toBe(false)
    expect(ibanGueltig('DE46 **** **** **** **87 12')).toBe(false)
  })
})

describe('Regeln am Beleg', () => {
  const felder = regelnAnwenden([{ seite: 1, text: BELEG }])
  const je = new Map(felder.map((f) => [f.feldname, f]))

  it('findet Faelligkeit und Rechnungsdatum mit zweistelligem Jahr', () => {
    expect(je.get('zahlungsziel')).toMatchObject({ datum: '2026-08-30' })
    expect(je.get('rechnungsdatum')).toMatchObject({ datum: '2026-08-16' })
  })

  it('findet IBAN, USt-IdNr., E-Mail und Rechnungsnummer', () => {
    expect(je.get('iban_im_beleg')).toMatchObject({ text: 'DE02120300000000202051', confidence: 0.98 })
    expect(je.get('kreditor_ust_id')).toMatchObject({ text: 'DE131948739' })
    expect(je.get('kreditor_email')).toMatchObject({ text: 'rechnung@parkhaus-musterstadt.invalid' })
    expect(je.get('rechnungsnummer')).toMatchObject({ text: '10018074' })
  })

  it('nimmt den letzten Gesamtbetrag', () => {
    expect(je.get('brutto')).toMatchObject({ zahl: 1.8 })
    expect(felder.every((f) => f.quelle === 'regel')).toBe(true)
  })

  it('rechnet "zahlbar innerhalb von 14 Tagen" vom Rechnungsdatum', () => {
    const f = regelnAnwenden([{ seite: 1, text: 'Rechnungsdatum 01.09.2026\nZahlbar innerhalb von 14 Tagen ohne Abzug. 2 % Skonto bis zum 08.09.2026' }])
    const m = new Map(f.map((x) => [x.feldname, x]))
    expect(m.get('zahlungsziel')).toMatchObject({ datum: '2026-09-15', confidence: 0.7 })
    expect(m.get('skonto_prozent')).toMatchObject({ zahl: 2 })
    expect(m.get('skonto_bis')).toMatchObject({ datum: '2026-09-08' })
  })

  it('liefert nichts fuer einen Text ohne Merkmale', () => {
    expect(regelnAnwenden([{ seite: 1, text: 'Sehr geehrte Damen und Herren, vielen Dank.' }])).toEqual([])
  })
})

describe('Zusammenfuehren', () => {
  it('nimmt je Feld das hoehere Vertrauen, bei Gleichstand die Regel', () => {
    const regeln = { quelle: 'regel' as const, felder: regelnAnwenden([{ seite: 1, text: BELEG }]) }
    const modell = {
      quelle: 'ki' as const,
      modell: 'test',
      felder: [
        { feldname: 'brutto' as const, zahl: 1.8, confidence: 0.95 },
        { feldname: 'zahlungsziel' as const, datum: '2026-09-30', confidence: 0.6 },
        { feldname: 'kreditor_name' as const, text: 'Parkhaus Musterstadt GmbH', confidence: 0.9 },
        { feldname: 'iban_im_beleg' as const, text: 'DE02 1203 0000 0000 2020 51', confidence: 0.98 },
      ],
    }
    const je = new Map(zusammenfuehren(regeln, modell).map((f) => [f.feldname, f]))
    expect(je.get('brutto')).toMatchObject({ quelle: 'ki', confidence: 0.95 })
    expect(je.get('zahlungsziel')).toMatchObject({ quelle: 'regel', datum: '2026-08-30' })
    expect(je.get('kreditor_name')).toMatchObject({ quelle: 'ki' })
    expect(je.get('iban_im_beleg')).toMatchObject({ quelle: 'regel', text: 'DE02120300000000202051' })
    // Ohne Modell bleiben die Regelfelder.
    expect(zusammenfuehren(regeln, null).length).toBe(regeln.felder.length)
  })
})
