/**
 * Die Zahlungsansicht an der Bankübergabe.
 *
 * Der Stempel an dieser Stufe ist keine Bestätigung, sondern eine Handlung:
 * Er weist Geld an. Deshalb steht hier vor der Schaltfläche, **was** passieren
 * wird — Weg, Empfänger, Betrag — und nicht erst danach im Protokoll.
 *
 * Und wenn nichts passieren kann, steht hier der Grund. Eine Schaltfläche,
 * die ohne Erklärung nicht funktioniert, ist schlimmer als keine.
 */

import { datum, euro } from '@/app/lib/darstellung'
import type { Zahlungsansicht } from '@/app/lib/zahlung-daten'

const WEGTEXT: Record<string, string> = {
  mail: 'Versand per Mail',
  datei_export: 'Dateiexport',
  extern: 'Übergabe an ein Fremdsystem',
  lastschrift: 'Lastschrift',
}

const zelle = { borderBottom: '1px solid var(--farbe-linie)', padding: '0.4rem 0.5rem' } as const

export function Zahlung({ ansicht }: { ansicht: Zahlungsansicht }) {
  const { weg, zahlungen } = ansicht

  return (
    <section style={{ margin: '1rem 0' }}>
      <h2>Zahlung</h2>

      {ansicht.verfallen > 0 && (
        <p role="alert" className="meldung-fehler">
          {ansicht.verfallen === 1 ? 'Eine Freigabe ist' : `${ansicht.verfallen} Freigaben sind`}{' '}
          verfallen, weil sich die Rechnungsdaten danach geändert haben. Der Beleg
          ist auf die betroffene Stufe zurückgesprungen.
        </p>
      )}

      {ansicht.lastschrift ? (
        <p className="meldung-hinweis">
          <strong>Lastschrift.</strong> Der Kreditor zieht selbst ein — es wird
          nichts übergeben. Vermerkt wird nur die Fälligkeit
          {ansicht.faelligAm !== null && ` zum ${datum.format(new Date(ansicht.faelligAm))}`}.
        </p>
      ) : (
        <dl
          style={{
            display: 'grid',
            gap: '0.25rem 1rem',
            gridTemplateColumns: 'max-content 1fr',
            margin: '0 0 1rem',
          }}
        >
          <dt className="leise">Weg</dt>
          <dd style={{ margin: 0 }}>
            {weg === null ? (
              <span className="rot">am Objekt nicht hinterlegt</span>
            ) : (
              <>
                {weg.name} — {WEGTEXT[weg.art] ?? weg.art}
                {weg.ziel !== null && ` an ${weg.ziel}`}
              </>
            )}
          </dd>

          <dt className="leise">Empfänger</dt>
          <dd style={{ margin: 0 }}>
            {ansicht.empfaenger ?? '—'}
            {ansicht.iban !== null && (
              <span className="leise"> · IBAN {ansicht.iban}</span>
            )}
          </dd>

          <dt className="leise">Betrag</dt>
          <dd style={{ margin: 0 }}>
            {ansicht.betrag === null ? '—' : euro.format(ansicht.betrag)}
            {ansicht.faelligAm !== null && (
              <span className="leise"> · fällig {datum.format(new Date(ansicht.faelligAm))}</span>
            )}
          </dd>
        </dl>
      )}

      {ansicht.versandfehlt !== null && (
        <p style={{ background: 'var(--farbe-orange-hell)', color: 'var(--farbe-orange-text)', padding: '0.7rem 0.9rem' }}>
          {ansicht.versandfehlt}
        </p>
      )}

      {!ansicht.moeglich && ansicht.hindernis !== null && (
        <p
          role="alert"
          style={{ background: 'var(--farbe-rot-hell)', color: 'var(--farbe-rot-text)', padding: '0.75rem' }}
        >
          <strong>Übergabe gesperrt.</strong> {ansicht.hindernis}
        </p>
      )}

      {zahlungen.length > 0 && (
        <table style={{ borderCollapse: 'collapse', marginTop: '1rem', width: '100%' }}>
          <thead>
            <tr>
              <th style={zelle}>Art</th>
              <th style={zelle}>Betrag</th>
              <th style={zelle}>Stand</th>
              <th style={zelle}>Vermerk</th>
            </tr>
          </thead>
          <tbody>
            {zahlungen.map((z) => (
              <tr key={z.id}>
                <td style={zelle}>{z.art}</td>
                <td style={zelle}>{euro.format(z.betrag)}</td>
                <td style={zelle}>{z.status}</td>
                <td style={{ ...zelle, color: 'var(--farbe-text-leise)' }}>{z.protokoll ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
