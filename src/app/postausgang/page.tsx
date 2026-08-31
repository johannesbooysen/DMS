/**
 * Ausgangsbuch und Vorlagen.
 *
 * Das Ausgangsbuch ist der Grund, warum der Versand aus dem Stempel heraus
 * durfte: Ein gescheiterter Versand steht hier sichtbar, mit Grund und Anzahl
 * der Versuche — statt still verloren zu gehen.
 *
 * Wiederholt wird auf Ansage, nicht von selbst. Ein Mailserver, der ablehnt,
 * lehnt in der nächsten Sekunde wieder ab; ein Zähler, den niemand ansieht,
 * ist keine Lösung.
 */

import { ausgangsbuchLaden, versandEingerichtet, vorlagenLaden, PLATZHALTER } from '@/postausgang'
import {
  postWiederholenAktion,
  vorlageSpeichernAktion,
} from '@/app/lib/postausgang-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { datum, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const zelle = { borderBottom: '1px solid #eee', padding: '0.45rem 0.5rem', verticalAlign: 'top' } as const

const FARBE: Record<string, string> = {
  offen: '#B5741A',
  gesendet: '#2F6F4E',
  fehlgeschlagen: '#B3271E',
}

export default async function Postausgang({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; vorlage?: string }>
}) {
  const { fehler, vorlage: offeneVorlage } = await searchParams
  const benutzer = await angemeldeterBenutzer()

  const [eintraege, vorlagen] = await Promise.all([
    ausgangsbuchLaden(benutzer),
    vorlagenLaden(benutzer),
  ])

  const offen = eintraege.filter((e) => e.status !== 'gesendet')
  const bearbeitet = vorlagen.find((v) => v.id === offeneVorlage)

  return (
    <Seitenrahmen titel="Postausgang">
      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      {!versandEingerichtet() && (
        <p style={{ background: '#FDF3E3', color: '#6B4A15', padding: '0.75rem' }}>
          <strong>Kein Mailversand eingerichtet.</strong> Was hier steht, bleibt
          liegen, bis <code>SMTP_URL</code> und <code>DMS_ABSENDER</code> gesetzt
          sind. Nichts geht verloren — es geht nur nichts hinaus.
        </p>
      )}

      <p style={{ color: '#555' }}>
        {eintraege.length === 0
          ? 'Das Ausgangsbuch ist leer.'
          : `${eintraege.length} Einträge, davon ${offen.length} noch nicht hinaus.`}
      </p>

      {eintraege.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Empfänger</th>
              <th style={zelle}>Betreff</th>
              <th style={zelle}>Anlass</th>
              <th style={zelle}>Stand</th>
              <th style={zelle} />
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e) => (
              <tr key={e.ausgangId}>
                <td style={zelle}>{e.empfaenger}</td>
                <td style={zelle}>
                  {e.dokumentId === null ? (
                    e.betreff
                  ) : (
                    <a href={`/beleg/${e.dokumentId}`}>{e.betreff}</a>
                  )}
                </td>
                <td style={zelle}>{e.anlass}</td>
                <td style={{ ...zelle, color: FARBE[e.status] ?? '#333' }}>
                  {e.status}
                  {e.versuche > 0 && (
                    <span style={{ color: '#666', fontSize: '0.78rem' }}>
                      {' '}
                      · {e.versuche} Versuch{e.versuche === 1 ? '' : 'e'}
                    </span>
                  )}
                  {e.gesendetAm !== null && (
                    <div style={{ color: '#666', fontSize: '0.78rem' }}>
                      {datum.format(new Date(e.gesendetAm))}
                    </div>
                  )}
                  {e.fehler !== null && (
                    <div style={{ fontSize: '0.78rem' }}>{e.fehler}</div>
                  )}
                </td>
                <td style={zelle}>
                  {e.status === 'fehlgeschlagen' && (
                    <form action={postWiederholenAktion}>
                      <input type="hidden" name="ausgangId" value={e.ausgangId} />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 0,
                          color: '#3B4A80',
                          cursor: 'pointer',
                        }}
                      >
                        erneut versuchen
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: '1rem', marginTop: '2rem' }}>Vorlagen</h2>
      <p style={{ color: '#555', fontSize: '0.85rem' }}>
        Platzhalter in doppelten geschweiften Klammern. Verfügbar sind:{' '}
        {Object.keys(PLATZHALTER)
          .map((k) => `{{${k}}}`)
          .join(', ')}
        . Ein Name, der nicht dabeisteht, bleibt im Text stehen — so fällt ein
        Tippfehler auf, bevor die Mail hinausgeht.
      </p>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {vorlagen.map((v) => (
            <tr key={v.id}>
              <td style={zelle}>
                <strong>{v.name}</strong>
                <div style={{ color: '#666', fontSize: '0.78rem' }}>{v.schluessel}</div>
              </td>
              <td style={zelle}>
                {bearbeitet?.id === v.id ? (
                  <form action={vorlageSpeichernAktion}>
                    <input type="hidden" name="vorlageId" value={v.id} />
                    <input
                      name="betreff"
                      defaultValue={v.betreff}
                      style={{ display: 'block', padding: '0.3rem', width: '100%' }}
                    />
                    <textarea
                      name="text"
                      defaultValue={v.text}
                      rows={8}
                      style={{ display: 'block', marginTop: '0.4rem', width: '100%' }}
                    />
                    <button
                      type="submit"
                      style={{ cursor: 'pointer', marginTop: '0.4rem', padding: '0.35rem 0.9rem' }}
                    >
                      Speichern
                    </button>{' '}
                    <a href="/postausgang" style={{ fontSize: '0.85rem' }}>
                      abbrechen
                    </a>
                  </form>
                ) : (
                  <>
                    <div>{v.betreff}</div>
                    <pre
                      style={{
                        color: '#555',
                        fontFamily: 'inherit',
                        fontSize: '0.82rem',
                        margin: '0.3rem 0 0',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {v.text}
                    </pre>
                    <a href={`/postausgang?vorlage=${v.id}`} style={{ fontSize: '0.85rem' }}>
                      ändern
                    </a>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Seitenrahmen>
  )
}
