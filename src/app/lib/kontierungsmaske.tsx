/**
 * Die Kontierungsmaske.
 *
 * Konzept 6: Zeilen aus Konto, Betrag und Steuersatz, je Zeile Umlagefähigkeit
 * und Rücklagenentnahme. Was der Bildschirm dauerhaft zeigen muss, ist der
 * offene Rest — er ist der Grund, warum jemand hier überhaupt nachrechnet.
 *
 * Die Schaltfläche „Rest übernehmen" ist kein Komfort, sondern
 * Fehlervermeidung: Der häufigste Fall ist eine Rechnung auf ein Konto, und
 * das Abtippen des Betrags ist die Stelle, an der Zahlendreher entstehen.
 */

import {
  umlageUmschaltenAktion,
  zeileEntfernenAktion,
  zeileHinzufuegenAktion,
} from '@/app/lib/kontierung-aktionen'
import { euro } from '@/app/lib/darstellung'
import type { Kontierungsmaske } from '@/app/lib/kontierung-daten'

const STEUERSAETZE = [19, 7, 0]

const zelle = {
  borderBottom: '1px solid #eee',
  padding: '0.4rem 0.5rem',
  textAlign: 'left',
} as const
const rechts = { ...zelle, textAlign: 'right' } as const

export function Kontierung({
  maske,
  dokumentId,
  aufgabeId,
}: {
  maske: Kontierungsmaske
  dokumentId: string
  aufgabeId: string
}) {
  const { stand, konten, umlageschluessel } = maske

  if (konten.length === 0) {
    return (
      <section style={{ margin: '1rem 0' }}>
        <h2 style={{ fontSize: '1rem' }}>Kontierung</h2>
        <p style={{ color: '#B3271E' }}>
          Für dieses Objekt ist kein Kontenrahmen hinterlegt — ohne ihn lässt sich nicht
          kontieren. Das ist eine Frage der Stammdaten, nicht des Belegs.
        </p>
      </section>
    )
  }

  const verstecktesZiel = (
    <>
      <input type="hidden" name="dokumentId" value={dokumentId} />
      <input type="hidden" name="aufgabeId" value={aufgabeId} />
    </>
  )

  return (
    <section style={{ margin: '1rem 0' }}>
      <h2 style={{ fontSize: '1rem' }}>Kontierung</h2>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ color: '#555', fontSize: '0.8rem' }}>
            <th style={zelle}>Konto</th>
            <th style={rechts}>Steuer</th>
            <th style={rechts}>Netto</th>
            <th style={rechts}>Brutto</th>
            <th style={zelle}>Umlage</th>
            <th style={zelle} />
          </tr>
        </thead>
        <tbody>
          {stand.zeilen.map((z) => (
            <tr key={z.id}>
              <td style={zelle}>
                {z.kontonummer} {z.kontobezeichnung}
                {z.ruecklageEntnahme && (
                  <span style={{ color: '#B5741A', fontSize: '0.8rem' }}> · aus Rücklage</span>
                )}
              </td>
              <td style={rechts}>{z.steuersatz.toFixed(0)} %</td>
              <td style={rechts}>{euro.format(z.betragNetto)}</td>
              <td style={rechts}>{euro.format(z.betragBrutto)}</td>
              <td style={zelle}>
                <form action={umlageUmschaltenAktion} style={{ display: 'inline' }}>
                  {verstecktesZiel}
                  <input type="hidden" name="zeileId" value={z.id} />
                  <input type="hidden" name="umlagefaehig" value={z.umlagefaehig ? 'nein' : 'ja'} />
                  <button
                    type="submit"
                    title="Umlagefähigkeit umschalten"
                    style={{
                      background: 'none',
                      border: 0,
                      color: z.umlagefaehig ? '#2F6F4E' : '#888',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {z.umlagefaehig ? 'umlagefähig' : 'nicht umlagefähig'}
                    {z.umlagefaehig && z.umlageschluessel !== null && ` (${z.umlageschluessel})`}
                  </button>
                </form>
                {/* Umlagefähig ohne Schlüssel lässt sich später nicht
                    verteilen. Das fällt erst bei der Abrechnung auf --
                    deshalb steht es hier. */}
                {z.umlagefaehig && z.umlageschluessel === null && (
                  <div style={{ color: '#B5741A', fontSize: '0.75rem' }}>ohne Schlüssel</div>
                )}
              </td>
              <td style={rechts}>
                <form action={zeileEntfernenAktion} style={{ display: 'inline' }}>
                  {verstecktesZiel}
                  <input type="hidden" name="zeileId" value={z.id} />
                  <button
                    type="submit"
                    style={{ background: 'none', border: 0, color: '#B3271E', cursor: 'pointer' }}
                  >
                    entfernen
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600 }}>
            <td style={zelle} colSpan={3}>
              Verteilt
            </td>
            <td style={rechts}>{euro.format(stand.summe)}</td>
            <td style={zelle} colSpan={2} />
          </tr>
          <tr style={{ color: stand.stimmt ? '#2F6F4E' : '#B3271E', fontWeight: 600 }}>
            <td style={zelle} colSpan={3}>
              {stand.rechnungsbetrag === null
                ? 'Am Beleg fehlt der Rechnungsbetrag'
                : stand.stimmt
                  ? 'Stimmt mit dem Rechnungsbetrag überein'
                  : 'Offen'}
            </td>
            <td style={rechts}>
              {stand.rechnungsbetrag === null ? '—' : euro.format(stand.offen)}
            </td>
            <td style={zelle} colSpan={2} />
          </tr>
        </tfoot>
      </table>

      <form
        action={zeileHinzufuegenAktion}
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginTop: '1rem',
        }}
      >
        {verstecktesZiel}

        <label style={{ display: 'block', fontSize: '0.8rem' }}>
          Konto
          <select
            name="kontoId"
            required
            style={{ display: 'block', minWidth: '18rem', padding: '0.35rem' }}
          >
            {konten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.kontonummer} {k.bezeichnung}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', fontSize: '0.8rem' }}>
          Steuersatz
          <select name="steuersatz" style={{ display: 'block', padding: '0.35rem' }}>
            {STEUERSAETZE.map((s) => (
              <option key={s} value={s}>
                {s} %
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', fontSize: '0.8rem' }}>
          Umlageschlüssel
          <select name="umlageschluesselId" style={{ display: 'block', padding: '0.35rem' }}>
            {/* Leer heißt: den Vorschlag des Kontos nehmen. Das ist der
                Normalfall und soll keine Entscheidung erzwingen. */}
            <option value="">wie im Konto hinterlegt</option>
            {umlageschluessel.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', fontSize: '0.8rem' }}>
          Brutto
          <input
            name="betragBrutto"
            inputMode="decimal"
            placeholder={stand.offen !== 0 ? stand.offen.toFixed(2) : '0,00'}
            style={{ display: 'block', padding: '0.35rem', textAlign: 'right', width: '8rem' }}
          />
        </label>

        <label style={{ fontSize: '0.8rem' }}>
          <input type="checkbox" name="ruecklageEntnahme" value="ja" /> aus Rücklage
        </label>

        <button type="submit" style={{ cursor: 'pointer', padding: '0.45rem 0.9rem' }}>
          Zeile hinzufügen
        </button>

        {stand.rechnungsbetrag !== null && !stand.stimmt && (
          <button
            type="submit"
            name="rest"
            value="ja"
            style={{ cursor: 'pointer', padding: '0.45rem 0.9rem' }}
          >
            Rest übernehmen ({euro.format(stand.offen)})
          </button>
        )}
      </form>
    </section>
  )
}
