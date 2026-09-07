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
import { alsBenutzer } from '@/db'
import { wunschLaden } from '@/benachrichtigung'
import { wunschSpeichernAktion } from '@/app/lib/benachrichtigung-aktionen'
import { Ampel, belegBezeichnung, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

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
                {belegBezeichnung(z)}
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
  const [persoenlich, spezial, klaerungen, wunsch] = await Promise.all([
    persoenlichesPostfach(benutzer),
    poolPostfach(benutzer),
    klaerungsPostfach(benutzer),
    alsBenutzer(benutzer, wunschLaden),
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
                <a href={`/beleg/${k.dokumentId}`}>{belegBezeichnung(k)}</a>
                {k.brutto !== null && ` · ${euro.format(k.brutto)}`}
                {` · Wiedervorlage ${datum.format(new Date(k.wiedervorlageAm))}`}
                <div style={{ color: '#666' }}>{k.kommentar}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        style={{
          borderTop: '1px solid #ddd',
          color: '#555',
          fontSize: '0.85rem',
          marginTop: '2rem',
          paddingTop: '1rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.25rem' }}>Tägliche Übersicht</h2>
        <p style={{ margin: '0 0 0.75rem' }}>
          Eine Sammelmail am Tag — und nur, wenn etwas offen ist. Keine Mail je Aufgabe: Die
          filtert nach zwei Wochen jeder in einen Ordner, den niemand öffnet, und dann ist
          auch die eine verloren, die wichtig war.{' '}
          <strong>Belegdaten stehen nicht darin</strong>, nur Zahlen und ein Link hierher.
        </p>
        <form
          action={wunschSpeichernAktion}
          style={{ alignItems: 'flex-end', display: 'flex', gap: '0.75rem' }}
        >
          <input type="hidden" name="zurueck" value="/postfach" />
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.15rem' }}>
            <span>Sammelmail</span>
            <select
              name="taeglich"
              defaultValue={wunsch.taeglich ? 'ja' : 'nein'}
              style={{ border: '1px solid #bbb', font: 'inherit', padding: '0.3rem' }}
            >
              <option value="ja">ja</option>
              <option value="nein">nein</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.15rem' }}>
            <span>Uhrzeit</span>
            <select
              name="stunde"
              defaultValue={String(wunsch.stunde)}
              style={{ border: '1px solid #bbb', font: 'inherit', padding: '0.3rem' }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            style={{
              background: '#3B4A80',
              border: 0,
              color: '#fff',
              font: 'inherit',
              padding: '0.35rem 0.7rem',
            }}
          >
            Übernehmen
          </button>
        </form>
      </section>
    </Seitenrahmen>
  )
}
