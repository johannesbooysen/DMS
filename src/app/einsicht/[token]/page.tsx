/**
 * Belegliste für einen externen Empfänger.
 *
 * Erreichbar **ohne Anmeldung**, allein über den Token in der Adresse. Alles,
 * was hier gezeigt wird, hat `app.einsicht_belege` gerechnet — es gibt keine
 * Liste freigegebener Belege, die hier nachgeschlagen würde.
 *
 * Die Seite sagt bewusst nicht, warum ein Token nicht gilt. „Abgelaufen"
 * wäre bereits die Auskunft, dass es diesen Zugang gab.
 */

import { notFound } from 'next/navigation'
import { einsichtAufloesen, einsichtBelege, einsichtProtokollieren } from '@/einsicht'

export const dynamic = 'force-dynamic'

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

const EMPFAENGER: Record<string, string> = {
  eigentuemer: 'Eigentümer',
  beirat: 'Beirat',
  mieter: 'Mieter',
}

const zelle = { borderBottom: '1px solid #ddd', padding: '0.5rem 0.6rem' } as const

export default async function Einsichtsliste({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const gewaehrung = await einsichtAufloesen(token)
  if (gewaehrung === null) return notFound()

  const belege = await einsichtBelege(gewaehrung.gewaehrungId)
  await einsichtProtokollieren(gewaehrung.gewaehrungId, null, 'liste')

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: '52rem',
        padding: '2rem 1.5rem',
      }}
    >
      <h1 style={{ fontSize: '1.25rem', margin: 0 }}>
        Belegeinsicht — {gewaehrung.objektnummer} {gewaehrung.objektName}
      </h1>
      <p style={{ color: '#555', marginTop: '0.35rem' }}>
        Für {gewaehrung.personName} ({EMPFAENGER[gewaehrung.empfaengerTyp] ?? gewaehrung.empfaengerTyp}).
        Gültig bis {datum.format(new Date(gewaehrung.gueltigBis))}.
      </p>

      {gewaehrung.empfaengerTyp === 'mieter' && (
        <p style={{ background: '#F3F5F9', color: '#33405C', padding: '0.7rem 0.9rem' }}>
          Gezeigt werden die Belege mit umlagefähigen Kosten aus Ihrer Mietzeit.
          Die Auswahl wird berechnet — sie ändert sich mit den Daten, nicht durch
          eine Freigabe.
        </p>
      )}

      {belege.length === 0 ? (
        <p>Für diesen Zugang liegen derzeit keine Belege vor.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', marginTop: '1rem', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.8rem', textAlign: 'left' }}>
              <th style={zelle}>Beleg</th>
              <th style={zelle}>Leistungszeitraum</th>
              <th style={{ ...zelle, textAlign: 'right' }}>Betrag</th>
            </tr>
          </thead>
          <tbody>
            {belege.map((b) => (
              <tr key={b.dokumentId}>
                <td style={zelle}>
                  <a href={`/einsicht/${token}/${b.dokumentId}`}>
                    {b.kreditor ?? 'Ohne Kreditor'}
                    {b.rechnungsnummer !== null && ` · ${b.rechnungsnummer}`}
                  </a>
                </td>
                <td style={zelle}>
                  {b.leistungVon === null
                    ? '—'
                    : `${datum.format(new Date(b.leistungVon))}${
                        b.leistungBis === null
                          ? ''
                          : ` – ${datum.format(new Date(b.leistungBis))}`
                      }`}
                </td>
                <td style={{ ...zelle, textAlign: 'right' }}>
                  {b.brutto === null ? '—' : euro.format(b.brutto)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer
        style={{
          borderTop: '1px solid #ddd',
          color: '#666',
          fontSize: '0.8rem',
          marginTop: '2rem',
          paddingTop: '0.8rem',
        }}
      >
        Jeder Aufruf wird protokolliert. Der Zugang endet am{' '}
        {datum.format(new Date(gewaehrung.gueltigBis))} und lässt sich nicht
        verlängern, indem er benutzt wird.
      </footer>
    </main>
  )
}
