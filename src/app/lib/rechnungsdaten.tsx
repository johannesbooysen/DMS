/**
 * Rechnungsdaten -- die erkannten Felder mit Wert und Herkunft.
 *
 * Eine Tabelle: Feld, Wert, woher. "erkannt (92 %)" sagt, dass ein Modell
 * es gelesen hat und wie sicher; "ZUGFeRD" heisst aus dem XML; "geändert"
 * heisst, jemand hat den erkannten Wert ueberschrieben; "eingetragen", dass
 * es keine Erkennung dazu gibt. Ein Pflichtfeld ohne Wert steht rot als
 * "fehlt" -- die Luecke soll ins Auge fallen, nicht die Zeile verschwinden.
 *
 * Leere Felder, die keine Pflicht sind, werden unter "weitere" zusammengeklappt:
 * Wer prueft, will die sieben gefuellten sehen, nicht sechs Striche.
 */

import type { Rechnungsdaten as Daten, Rechnungsdatum } from '@/belege/rechnungsdaten'
import { Ampel } from '@/app/lib/anzeige'

function herkunft(z: Rechnungsdatum): { text: string; klasse: string } {
  if (z.wert === null) return z.pflicht ? { text: 'Pflicht', klasse: 'rot' } : { text: '', klasse: 'leise' }
  switch (z.herkunft) {
    case 'zugferd':
      return { text: 'ZUGFeRD / XRechnung', klasse: 'gruen' }
    case 'ki':
    case 'regel': {
      const p = z.vertrauen === null ? null : Math.round(z.vertrauen * 100)
      const klasse = p === null ? 'leise' : p >= 95 ? 'gruen' : p >= 60 ? 'orange' : 'rot'
      return { text: p === null ? 'erkannt' : `erkannt (${p} %)`, klasse }
    }
    case 'mensch':
      return { text: 'geändert', klasse: 'leise' }
    default:
      return { text: 'eingetragen', klasse: 'leise' }
  }
}

function Zeile({ z }: { z: Rechnungsdatum }) {
  const h = herkunft(z)
  return (
    <tr>
      <th scope="row" style={{ textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>
        {z.label}
      </th>
      <td>{z.wert === null ? <span className={z.pflicht ? 'rot' : 'leise'}>{z.pflicht ? 'fehlt' : '—'}</span> : z.wert}</td>
      <td className={`klein ${h.klasse}`}>{h.text}</td>
    </tr>
  )
}

export function Rechnungsdaten({ daten, kompakt = false }: { daten: Daten; kompakt?: boolean }) {
  if (daten.zeilen.length === 0) return null
  const sichtbar = daten.zeilen.filter((z) => z.wert !== null || z.pflicht)
  const weitere = daten.zeilen.filter((z) => z.wert === null && !z.pflicht)
  return (
    <section aria-labelledby="rechnungsdaten-titel" className={kompakt ? 'klein' : undefined}>
      <h2 id="rechnungsdaten-titel">
        Rechnungsdaten <Ampel wert={daten.ampelExtraktion} />
      </h2>
      {daten.fehlendePflicht.length > 0 && (
        <p className="rot klein" style={{ marginTop: 0 }}>
          Pflichtfelder ohne Wert: {daten.fehlendePflicht.join(', ')}.
        </p>
      )}
      <table style={{ width: '100%' }}>
        <thead style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
          <tr>
            <th scope="col">Feld</th>
            <th scope="col">Wert</th>
            <th scope="col">Herkunft</th>
          </tr>
        </thead>
        <tbody>
          {sichtbar.map((z) => (
            <Zeile key={z.feld} z={z} />
          ))}
        </tbody>
      </table>
      {weitere.length > 0 && (
        <details>
          <summary className="klein leise" style={{ cursor: 'pointer' }}>
            {weitere.length} weitere ohne Wert
          </summary>
          <table style={{ width: '100%' }}>
            <tbody>
              {weitere.map((z) => (
                <Zeile key={z.feld} z={z} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  )
}
