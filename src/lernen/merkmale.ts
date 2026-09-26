/**
 * Beschriftete Merkmale im Belegtext -- was gelernt werden kann.
 *
 * `kandidatenAusText` (zuordnung.ts) sammelt jede Zahl ab vier Zeichen, um
 * sie gegen **gelernte** Merkmale zu halten. Lernen braucht mehr: den Typ.
 * "Kundennummer 40137953" sagt, dass 40137953 eine Kundennummer ist -- und
 * genau das merkt sich das System, wenn ein Mensch den Beleg einem Objekt
 * zuordnet. Beim naechsten Beleg desselben Versorgers mit derselben
 * Kundennummer ist die Zuordnung gruen, ohne dass jemand etwas pflegt
 * (Konzept 15).
 *
 * Nur beschriftete Werte, nur mit Typ: Eine Bestellnummer oder ein
 * Datum lernt niemand als Kundennummer.
 */

import type { Merkmalstyp } from './zuordnung'

export interface Merkmalsfund {
  typ: Merkmalstyp
  wert: string
}

const MUSTER: Array<{ typ: Merkmalstyp; muster: RegExp }> = [
  { typ: 'kundennummer', muster: /Kunden-?\s?(?:nummer|nr\.?|no\.?)[ :]*([A-Z0-9][A-Z0-9\-/]{3,})/gi },
  { typ: 'vertragsnummer', muster: /Vertrags-?\s?(?:nummer|nr\.?|konto)[ :]*([A-Z0-9][A-Z0-9\-/]{3,})/gi },
  { typ: 'zaehlernummer', muster: /Z[äa]hler-?\s?(?:nummer|nr\.?)[ :]*([A-Z0-9][A-Z0-9\-/]{3,})/gi },
  { typ: 'objektnummer', muster: /(?:Objekt|Liegenschafts?)-?\s?(?:nummer|nr\.?)[ :]*([A-Z0-9][A-Z0-9\-/]{1,})/gi },
]

export function merkmaleImText(text: string): Merkmalsfund[] {
  const gefunden = new Map<string, Merkmalsfund>()
  for (const { typ, muster } of MUSTER) {
    for (const m of text.matchAll(muster)) {
      const wert = m[1]!.replace(/[.,:;]+$/, '')
      // Ein Datum oder ein Betrag ist keine Nummer, auch wenn "Nr." davorsteht.
      if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(wert) || /,\d{2}$/.test(wert)) continue
      gefunden.set(`${typ}:${wert.toUpperCase()}`, { typ, wert })
    }
  }
  return [...gefunden.values()]
}
