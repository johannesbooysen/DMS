/**
 * Fehlerkorb.
 *
 * Zwei Listen, weil es zwei Arten gibt, liegen zu bleiben:
 *
 *   * **Aufgegeben** — die Warteschlange hat nach drei Versuchen aufgehört
 *     und gesagt, warum.
 *   * **Hängt** — es gibt gar keinen Auftrag mehr, etwa weil der Worker
 *     mitten in der Aufbereitung gestorben ist. Hier weiß niemand, warum;
 *     man kann es nur noch einmal versuchen.
 *
 * Die zweite Liste ist wichtiger, als sie aussieht: Sie fängt genau die
 * Fälle, die der Korb nicht sieht.
 */

import { fehlerkorbLaden, haengendeLaden } from '@/fehlerkorb'
import {
  fehlerManuellAktion,
  fehlerVerwerfenAktion,
  fehlerWiederholenAktion,
  haengerWiederholenAktion,
} from '@/app/lib/fehlerkorb-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { seit, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const zelle = {
  borderBottom: '1px solid #eee',
  padding: '0.45rem 0.5rem',
  verticalAlign: 'top',
} as const

const knopf = {
  background: 'none',
  border: 0,
  color: '#3B4A80',
  cursor: 'pointer',
  fontSize: '0.85rem',
  padding: 0,
} as const

/** Was von einem unaufbereiteten Beleg lesbar ist, ist wenig. */
function kennung(zeile: {
  dateiname: string | null
  storagePraefix: string | null
  dokumentId: string | null
  stapelId: string | null
}): string {
  if (zeile.dateiname !== null) return zeile.dateiname
  if (zeile.storagePraefix !== null) return zeile.storagePraefix
  return (zeile.dokumentId ?? zeile.stapelId ?? '—').slice(0, 8)
}

export default async function Fehlerkorb({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const { fehler } = await searchParams
  const benutzer = await angemeldeterBenutzer()

  const [korb, haenger] = await Promise.all([
    fehlerkorbLaden(benutzer),
    haengendeLaden(benutzer),
  ])

  return (
    <Seitenrahmen titel="Fehlerkorb">
      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      <p style={{ color: '#555' }}>
        Ein Beleg, dessen Aufbereitung scheitert, ist <strong>nicht verloren</strong> — sein
        Lauf startete beim Eingang, die Aufgabe liegt im Postfach. Was fehlt, sind
        Vorschau, Seitentext und erkannte Felder. Hier steht, warum.
      </p>

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>
        Aufgegeben{korb.length > 0 && ` (${korb.length})`}
      </h2>

      {korb.length === 0 ? (
        <p>Nichts aufgegeben.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Eingang</th>
              <th style={zelle}>Grund</th>
              <th style={zelle}>Seit</th>
              <th style={zelle}>Weiter</th>
            </tr>
          </thead>
          <tbody>
            {korb.map((z) => (
              <tr key={z.id}>
                <td style={zelle}>
                  {z.dokumentId === null ? (
                    <span>{kennung(z)}</span>
                  ) : (
                    <a href={`/beleg/${z.dokumentId}`}>{kennung(z)}</a>
                  )}
                  <div style={{ color: '#666', fontSize: '0.78rem' }}>
                    {z.stapelId === null ? 'Beleg' : 'Stapel'}
                    {z.eingangskanal !== null && ` · ${z.eingangskanal}`}
                    {z.versuche > 0 && ` · ${z.versuche} Versuche`}
                  </div>
                </td>
                <td style={{ ...zelle, color: '#B3271E', maxWidth: '26rem' }}>
                  <div style={{ overflowWrap: 'anywhere' }}>{z.grund}</div>
                  <div style={{ color: '#666', fontSize: '0.78rem' }}>{z.warteschlange}</div>
                </td>
                <td style={{ ...zelle, fontSize: '0.85rem' }}>
                  {seit(z.aufgetretenAm)}
                </td>
                <td style={zelle}>
                  <form action={fehlerWiederholenAktion} style={{ display: 'inline' }}>
                    <input type="hidden" name="fehlerId" value={z.id} />
                    <button type="submit" style={knopf}>
                      wiederholen
                    </button>
                  </form>
                  {z.dokumentId !== null && (
                    <>
                      {' · '}
                      <form action={fehlerManuellAktion} style={{ display: 'inline' }}>
                        <input type="hidden" name="fehlerId" value={z.id} />
                        <button type="submit" style={knopf} title="Ohne Aufbereitung weiter, Erfassung von Hand">
                          von Hand
                        </button>
                      </form>
                    </>
                  )}
                  <form action={fehlerVerwerfenAktion} style={{ marginTop: '0.35rem' }}>
                    <input type="hidden" name="fehlerId" value={z.id} />
                    <input
                      name="grund"
                      placeholder="Grund für den Storno"
                      required
                      style={{ fontSize: '0.8rem', padding: '0.2rem', width: '11rem' }}
                    />{' '}
                    <button type="submit" style={{ ...knopf, color: '#B3271E' }}>
                      verwerfen
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: '1rem', marginTop: '2rem' }}>
        Hängt{haenger.length > 0 && ` (${haenger.length})`}
      </h2>
      <p style={{ color: '#555', fontSize: '0.85rem' }}>
        Seit mehr als einer halben Stunde in Aufbereitung, ohne dass die
        Warteschlange etwas gemeldet hat. Der häufigste Grund ist ein Worker,
        der zwischendurch beendet wurde.
      </p>

      {haenger.length === 0 ? (
        <p>Nichts hängt.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Eingang</th>
              <th style={zelle}>Kanal</th>
              <th style={zelle}>Seit</th>
              <th style={zelle} />
            </tr>
          </thead>
          <tbody>
            {haenger.map((h) => (
              <tr key={h.dokumentId}>
                <td style={zelle}>
                  <a href={`/beleg/${h.dokumentId}`}>{h.storagePraefix}</a>
                </td>
                <td style={zelle}>{h.eingangskanal}</td>
                <td style={{ ...zelle, fontSize: '0.85rem' }}>
                  {seit(h.eingangAm)}
                </td>
                <td style={zelle}>
                  {/* Nur eine Handlung: Warum es haengt, weiss hier niemand --
                      es gibt keinen Grund, den man lesen koennte. Bleibt es
                      auch nach dem Versuch haengen, taucht es mit Grund oben
                      auf. */}
                  <form action={haengerWiederholenAktion}>
                    <input type="hidden" name="dokumentId" value={h.dokumentId} />
                    <button type="submit" style={knopf}>
                      noch einmal einreihen
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seitenrahmen>
  )
}
