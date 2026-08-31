/**
 * Lokales Modell über Ollama.
 *
 * Läuft auf eigener Hardware, im eigenen Netz — kein Datenabfluss, keine
 * Auftragsverarbeitung, keine Kosten je Beleg. Das ist der Weg, mit dem sich
 * die Strecke bauen und prüfen lässt, ohne dass ein einziger echter Beleg das
 * Haus verlässt.
 *
 * Der Anbieter bekommt **Text**, keine Bilder: Die Aufbereitung hat den
 * Seitentext bereits gelesen. Das senkt die Anforderungen an das Modell
 * erheblich — ein mittelgroßes Textmodell auf einer einzelnen Grafikkarte
 * genügt, es braucht kein Modell, das Seiten sehen kann.
 *
 * Zum Anschluss eines Dienstes wie Bedrock wäre eine zweite Datei dieser Art
 * nötig und sonst nichts; die Fachlogik kennt nur `Extraktionsanbieter`.
 */

import { betragLesen } from './zahlen'
import type {
  ErkanntesFeld,
  Extraktionsanbieter,
  Extraktionsanfrage,
  Extraktionsergebnis,
  Feldname,
} from './typen'

const ADRESSE = process.env['DMS_OLLAMA'] ?? 'http://127.0.0.1:11434'
const MODELL = process.env['DMS_OLLAMA_MODELL'] ?? 'qwen2.5:7b-instruct'

/** Wie viel Text an das Modell geht. Rechnungen tragen ihr Wesentliches vorn. */
const HOECHSTZEICHEN = 12_000

const ERWARTETE_FELDER: Feldname[] = [
  'kreditor_name',
  'kreditor_ust_id',
  'rechnungsnummer',
  'rechnungsdatum',
  'leistung_von',
  'leistung_bis',
  'netto',
  'steuer',
  'brutto',
  'iban_im_beleg',
  'zahlungsziel',
  'skonto_prozent',
  'skonto_bis',
]

const ZAHLENFELDER = new Set<Feldname>(['netto', 'steuer', 'brutto', 'skonto_prozent'])
const DATUMSFELDER = new Set<Feldname>([
  'rechnungsdatum',
  'leistung_von',
  'leistung_bis',
  'zahlungsziel',
  'skonto_bis',
])

function anweisung(text: string, kiBeschreibung?: string | null): string {
  return [
    'Du liest deutsche Eingangsrechnungen für eine Immobilienverwaltung.',
    'Gib ausschließlich JSON zurück, ohne Erklärung.',
    '',
    'Für jedes Feld, das du im Text findest, ein Objekt mit "wert" und',
    '"confidence" (0 bis 1). Felder, die du nicht findest, lässt du weg —',
    'rate nicht. Ein fehlendes Feld ist besser als ein falsches, weil es in',
    'die manuelle Erfassung geht statt in eine stille Fehlbuchung.',
    '',
    `Mögliche Felder: ${ERWARTETE_FELDER.join(', ')}`,
    'Beträge als Zahl mit Punkt als Dezimaltrennzeichen, Daten als JJJJ-MM-TT.',
    kiBeschreibung == null || kiBeschreibung === ''
      ? ''
      : `Zur Einordnung des Belegs: ${kiBeschreibung}`,
    '',
    'Rechnungstext:',
    text.slice(0, HOECHSTZEICHEN),
  ]
    .filter((zeile) => zeile !== '')
    .join('\n')
}

/** Wandelt die Antwort des Modells in Felder um — vorsichtig. */
export function antwortLesen(roh: string): ErkanntesFeld[] {
  // Modelle rahmen JSON gern in Codeblöcke. Wir nehmen das erste Objekt.
  const anfang = roh.indexOf('{')
  const ende = roh.lastIndexOf('}')
  if (anfang < 0 || ende <= anfang) return []

  let gelesen: unknown
  try {
    gelesen = JSON.parse(roh.slice(anfang, ende + 1))
  } catch {
    return []
  }
  if (typeof gelesen !== 'object' || gelesen === null) return []

  const felder: ErkanntesFeld[] = []
  for (const feldname of ERWARTETE_FELDER) {
    const eintrag = (gelesen as Record<string, unknown>)[feldname]
    if (eintrag === undefined || eintrag === null) continue

    const wert =
      typeof eintrag === 'object' ? (eintrag as Record<string, unknown>)['wert'] : eintrag
    const rohVertrauen =
      typeof eintrag === 'object' ? (eintrag as Record<string, unknown>)['confidence'] : undefined
    if (wert === undefined || wert === null || wert === '') continue

    // Ohne Angabe des Modells nehmen wir einen mittleren Wert an -- nie 1:
    // Die Eins ist strukturierten Rechnungen vorbehalten (Konzept 14).
    const confidence = Math.min(
      0.95,
      Math.max(0, typeof rohVertrauen === 'number' ? rohVertrauen : 0.7),
    )

    if (ZAHLENFELDER.has(feldname)) {
      const zahl = betragLesen(wert as string | number)
      if (zahl !== null) felder.push({ feldname, zahl, confidence })
      continue
    }
    if (DATUMSFELDER.has(feldname)) {
      const datum = String(wert).slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) felder.push({ feldname, datum, confidence })
      continue
    }
    felder.push({ feldname, text: String(wert).trim(), confidence })
  }
  return felder
}

export const ollamaAnbieter: Extraktionsanbieter = {
  name: `ollama:${MODELL}`,

  async zustaendig(anfrage: Extraktionsanfrage): Promise<boolean> {
    return anfrage.seiten.some((s) => s.text.trim().length > 0)
  },

  async extrahieren(anfrage: Extraktionsanfrage): Promise<Extraktionsergebnis | null> {
    const text = anfrage.seiten.map((s) => s.text).join('\n')
    if (text.trim() === '') return null

    try {
      const antwort = await fetch(`${ADRESSE}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODELL,
          prompt: anweisung(text, anfrage.kiBeschreibung),
          format: 'json',
          stream: false,
          options: { temperature: 0 },
        }),
      })
      if (!antwort.ok) return null

      const daten = (await antwort.json()) as { response?: string }
      const felder = antwortLesen(daten.response ?? '')
      return felder.length === 0 ? null : { felder, quelle: 'ki', modell: MODELL }
    } catch {
      // Faellt der Anbieter aus, bleibt das Dokument nicht liegen: Der
      // Workflow startet trotzdem, erfasst wird von Hand (Konzept 13).
      return null
    }
  },
}
