/**
 * Warten am Beleg: was läuft, und ein neues eröffnen.
 *
 * Steht am Beleg und nicht in der Wartenliste, weil hier entschieden wird —
 * die Liste ist nur die Wiedervorlage.
 */

import { wartenBeginnenAktion } from '@/app/lib/nebenlauf-aktionen'
import { datum } from '@/app/lib/darstellung'

export interface Wartestand {
  containerId: string
  art: string
  erwartetesEreignis: string
  wiedervorlageAm: string
  erledigtAm: string | null
  ergebnis: string | null
}

const EREIGNIS: Record<string, string> = {
  erstattung: 'Erstattung',
  versicherungszahlung: 'Zahlung der Versicherung',
  gewaehrleistungsantwort: 'Antwort zur Gewährleistung',
}

export function Warten({
  container,
  dokumentId,
}: {
  container: Wartestand[]
  dokumentId: string
}) {
  const offen = container.filter((w) => w.erledigtAm === null)
  const erledigt = container.filter((w) => w.erledigtAm !== null)

  return (
    <section style={{ margin: '1rem 0' }}>
      <h2 style={{ fontSize: '1rem' }}>Warten auf ein externes Ereignis</h2>

      {offen.length > 0 && (
        <ul style={{ paddingLeft: '1.1rem' }}>
          {offen.map((w) => (
            <li key={w.containerId}>
              <strong>{w.art}</strong> — {EREIGNIS[w.erwartetesEreignis] ?? w.erwartetesEreignis},
              Wiedervorlage {datum.format(new Date(w.wiedervorlageAm))}
            </li>
          ))}
        </ul>
      )}

      {erledigt.length > 0 && (
        <details style={{ margin: '0.5rem 0' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
            {erledigt.length} abgeschlossen
          </summary>
          <ul style={{ color: '#555', fontSize: '0.85rem', paddingLeft: '1.1rem' }}>
            {erledigt.map((w) => (
              <li key={w.containerId}>
                {w.art}: {w.ergebnis}
              </li>
            ))}
          </ul>
        </details>
      )}

      <form
        action={wartenBeginnenAktion}
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginTop: '0.6rem',
        }}
      >
        <input type="hidden" name="dokumentId" value={dokumentId} />

        <label style={{ display: 'block', fontSize: '0.75rem' }}>
          Bezeichnung
          <input
            name="art"
            required
            placeholder="z. B. zur Erstattung Vers.RE"
            style={{ display: 'block', minWidth: '14rem', padding: '0.3rem' }}
          />
        </label>

        <label style={{ display: 'block', fontSize: '0.75rem' }}>
          Erwartet
          <select name="ereignis" style={{ display: 'block', padding: '0.3rem' }}>
            <option value="erstattung">Erstattung</option>
            <option value="versicherungszahlung">Zahlung der Versicherung</option>
            <option value="gewaehrleistungsantwort">Antwort zur Gewährleistung</option>
          </select>
        </label>

        <label style={{ display: 'block', fontSize: '0.75rem' }}>
          Betrag
          <input
            name="erwarteterBetrag"
            inputMode="decimal"
            style={{ display: 'block', padding: '0.3rem', textAlign: 'right', width: '7rem' }}
          />
        </label>

        <label style={{ display: 'block', fontSize: '0.75rem' }}>
          Wiedervorlage
          <input
            type="date"
            name="wiedervorlageAm"
            required
            style={{ display: 'block', padding: '0.3rem' }}
          />
        </label>

        <button type="submit" style={{ cursor: 'pointer', padding: '0.35rem 0.8rem' }}>
          Warten beginnen
        </button>
      </form>
    </section>
  )
}
