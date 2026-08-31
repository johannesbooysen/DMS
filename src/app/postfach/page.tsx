/**
 * Die drei Postfaecher.
 *
 * Alle drei sind Sichten auf `aufgabe` beziehungsweise `klaerung` -- keine
 * eigenen Ablagen (Konzept 8.5). Deshalb stehen sie auf einer Seite: Es ist
 * dieselbe Arbeit, nur anders gefiltert.
 */

import {
  klaerungsPostfach,
  persoenlichesPostfach,
  poolPostfach,
  type Postfachzeile,
} from '@/app/lib/postfach'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Ampel, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

function Aufgabenliste({ zeilen, leer }: { zeilen: Postfachzeile[]; leer: string }) {
  if (zeilen.length === 0) return <p style={{ color: '#666' }}>{leer}</p>

  return (
    <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', width: '100%' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
          <th style={{ padding: '0.4rem 0.5rem' }}></th>
          <th style={{ padding: '0.4rem 0.5rem' }}>Beleg</th>
          <th style={{ padding: '0.4rem 0.5rem' }}>Objekt</th>
          <th style={{ padding: '0.4rem 0.5rem' }}>Stufe</th>
          <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Betrag</th>
          <th style={{ padding: '0.4rem 0.5rem' }}>Fällig</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => (
          <tr key={z.aufgabeId} style={{ borderBottom: '1px solid #eee' }}>
            <td style={{ padding: '0.4rem 0.5rem' }}>
              <Ampel wert={z.ampel} />
            </td>
            <td style={{ padding: '0.4rem 0.5rem' }}>
              <a href={`/aufgabe/${z.aufgabeId}`}>
                {z.kreditor ?? 'Ohne Kreditor'}
                {z.rechnungsnummer !== null && ` · ${z.rechnungsnummer}`}
              </a>
            </td>
            <td style={{ padding: '0.4rem 0.5rem' }}>{z.objektnummer ?? '—'}</td>
            <td style={{ padding: '0.4rem 0.5rem' }}>{z.stufe}</td>
            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
              {z.brutto === null ? '—' : euro.format(z.brutto)}
            </td>
            <td style={{ padding: '0.4rem 0.5rem' }}>
              {z.faelligAm === null ? '—' : datum.format(new Date(z.faelligAm))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default async function Postfaecher() {
  const benutzer = await angemeldeterBenutzer()
  const [persoenlich, spezial, klaerungen] = await Promise.all([
    persoenlichesPostfach(benutzer),
    poolPostfach(benutzer),
    klaerungsPostfach(benutzer),
  ])

  return (
    <Seitenrahmen titel="Postfächer">
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Persönlich ({persoenlich.length})</h2>
        <Aufgabenliste zeilen={persoenlich} leer="Nichts zugewiesen." />
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Pool: Spezialgebiet und Rolle ({spezial.length})</h2>
        <Aufgabenliste zeilen={spezial} leer="Nichts im Pool." />
      </section>

      <section>
        <h2 style={{ fontSize: '1rem' }}>Klärung ({klaerungen.length})</h2>
        {klaerungen.length === 0 ? (
          <p style={{ color: '#666' }}>Nichts in Klärung.</p>
        ) : (
          <ul>
            {klaerungen.map((k) => (
              <li key={k.klaerungId} style={{ marginBottom: '0.5rem' }}>
                <a href={`/beleg/${k.dokumentId}`}>{k.kreditor ?? 'Ohne Kreditor'}</a>
                {k.brutto !== null && ` · ${euro.format(k.brutto)}`}
                {` · Wiedervorlage ${datum.format(new Date(k.wiedervorlageAm))}`}
                <div style={{ color: '#666' }}>{k.kommentar}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Seitenrahmen>
  )
}
