/**
 * Misst die Erkennung an erzeugten Belegen.
 *
 * „Vor jeder Performance-Optimierung messen, danach erneut" — Konzept §21.
 * Für ein lokales Modell ist die Zahl doppelt wichtig: Sie entscheidet, ob
 * die Größe des Modells zur Hardware passt oder ob die kleinere Fassung
 * genügen muss.
 *
 * Verglichen wird gegen die bekannte Wahrheit: Die Belege entstehen hier,
 * also ist jedes Feld überprüfbar. Das Ergebnis ist damit eine Trefferquote,
 * keine Einschätzung.
 *
 *   npx tsx scripts/extraktion-messen.ts [Anzahl]
 */

import { antwortLesen, ollamaAnbieter } from '../src/extraktion/ollama'
import { extraktionsvertrauen } from '../src/extraktion'
import type { ErkanntesFeld } from '../src/extraktion/typen'

const anzahl = Number(process.argv[2] ?? 5)

/** Erfundene Belege mit bekannter Wahrheit. */
const BELEGE = [
  {
    text: [
      'Musterreinigung GmbH, Beispielweg 1, 00000 Musterstadt',
      'USt-IdNr. DE000000000',
      '',
      'Rechnung Nr. RE-2026-0815',
      'Rechnungsdatum: 14.08.2026',
      'Leistungszeitraum: 01.07.2026 bis 30.09.2026',
      '',
      'Reinigung Treppenhaus        420,00 EUR',
      'Gartenpflege                 260,00 EUR',
      'Winterdienst Bereitschaft    180,00 EUR',
      '',
      'Nettobetrag                  860,00 EUR',
      'zzgl. 19 % USt               163,40 EUR',
      'Rechnungsbetrag            1.023,40 EUR',
      '',
      'Zahlbar bis 28.08.2026 ohne Abzug.',
      'IBAN DE02120300000000202051',
    ].join('\n'),
    wahrheit: {
      kreditor_name: 'Musterreinigung GmbH',
      rechnungsnummer: 'RE-2026-0815',
      rechnungsdatum: '2026-08-14',
      brutto: 1023.4,
      netto: 860,
    },
  },
  {
    text: [
      'Elektro Blitz e.K.',
      'Kirchweg 8 · 00000 Andersstadt · USt-IdNr. DE111111111',
      '',
      'RECHNUNG',
      'Beleg-Nr.: 2026/4711    Datum: 03.09.2026',
      'Objekt: Amselgasse 12, Wartung Aufzugsbeleuchtung',
      '',
      'Position 1  Arbeitszeit 3,5 Std.        297,50',
      'Position 2  Material                     84,20',
      '',
      'Summe netto                             381,70',
      'Umsatzsteuer 19 %                        72,52',
      'Gesamtbetrag                            454,22 EUR',
      '',
      'Bei Zahlung bis 10.09.2026 gewähren wir 2 % Skonto.',
    ].join('\n'),
    wahrheit: {
      kreditor_name: 'Elektro Blitz e.K.',
      rechnungsnummer: '2026/4711',
      rechnungsdatum: '2026-09-03',
      brutto: 454.22,
      netto: 381.7,
    },
  },
]

function wert(felder: ErkanntesFeld[], name: string): string | number | null {
  const f = felder.find((x) => x.feldname === name)
  if (f === undefined) return null
  return f.zahl ?? f.datum ?? f.text ?? null
}

/** Vergleicht großzügig: Groß- und Kleinschreibung und Leerraum egal. */
function gleich(erkannt: string | number | null, erwartet: string | number): boolean {
  if (erkannt === null) return false
  if (typeof erwartet === 'number') return Math.abs(Number(erkannt) - erwartet) < 0.005
  return String(erkannt).trim().toLocaleLowerCase('de') === erwartet.toLocaleLowerCase('de')
}

console.log(`Modell: ${ollamaAnbieter.name}`)
console.log(`Belege: ${BELEGE.length}, Durchläufe je Beleg: ${anzahl}\n`)

const zeiten: number[] = []
let treffer = 0
let moeglich = 0
let ohneAntwort = 0

for (const [nr, beleg] of BELEGE.entries()) {
  console.log(`--- Beleg ${nr + 1} ---`)
  for (let lauf = 0; lauf < anzahl; lauf++) {
    const start = process.hrtime.bigint()
    const ergebnis = await ollamaAnbieter.extrahieren({
      dokumentId: `messung-${nr}-${lauf}`,
      inhalt: Buffer.alloc(0),
      seiten: [{ seite: 1, text: beleg.text }],
    })
    const dauer = Number(process.hrtime.bigint() - start) / 1e6
    zeiten.push(dauer)

    if (ergebnis === null) {
      ohneAntwort += 1
      console.log(`  Lauf ${lauf + 1}: keine Antwort (${Math.round(dauer)} ms)`)
      continue
    }

    const felder = ergebnis.felder
    const einzeln: string[] = []
    for (const [name, erwartet] of Object.entries(beleg.wahrheit)) {
      moeglich += 1
      const erkannt = wert(felder, name)
      const passt = gleich(erkannt, erwartet as string | number)
      if (passt) treffer += 1
      else einzeln.push(`${name}: ${JSON.stringify(erkannt)} statt ${JSON.stringify(erwartet)}`)
    }

    const vertrauen = extraktionsvertrauen(felder)
    console.log(
      `  Lauf ${lauf + 1}: ${Math.round(dauer)} ms, ${felder.length} Felder, ` +
        `Vertrauen ${vertrauen === null ? 'unvollständig' : vertrauen.toFixed(2)}` +
        (einzeln.length === 0 ? ', alles richtig' : `\n      ${einzeln.join('\n      ')}`),
    )
  }
}

const sortiert = [...zeiten].sort((a, b) => a - b)
const median = sortiert[Math.floor(sortiert.length / 2)] ?? 0

console.log('\n--- Zusammenfassung ---')
console.log(`Trefferquote:   ${treffer}/${moeglich} Felder`)
console.log(`Ohne Antwort:   ${ohneAntwort} von ${zeiten.length} Läufen`)
console.log(`Dauer Median:   ${Math.round(median)} ms`)
console.log(`Dauer min/max:  ${Math.round(sortiert[0] ?? 0)} / ${Math.round(sortiert.at(-1) ?? 0)} ms`)

// Damit die Zahl nicht nur im Terminal steht:
console.log('\nEintragen in docs/messungen.md, wenn die Werte belastbar sind.')

// Kleine Selbstprüfung des Auswerters, unabhängig vom Modell.
const probe = antwortLesen('{"rechnungsnummer":{"wert":"RE-1","confidence":0.9}}')
if (probe.length !== 1) throw new Error('antwortLesen liefert nicht das Erwartete')
