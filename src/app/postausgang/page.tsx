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

const zelle = { borderBottom: '1px solid var(--farbe-linie)', padding: '0.45rem 0.5rem', verticalAlign: 'top' } as const

const FARBE: Record<string, string> = {
  offen: 'var(--farbe-orange)',
  gesendet: 'var(--farbe-gruen)',
  fehlgeschlagen: 'var(--farbe-rot)',
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
        <p role="alert" className="meldung-fehler">
          {fehler}
        </p>
      )}

      {!versandEingerichtet() && (
        <p className="meldung-hinweis">
          <strong>Kein Mailversand eingerichtet.</strong> Was hier steht, bleibt
          liegen, bis <code>SMTP_URL</code> und <code>DMS_ABSENDER</code> gesetzt
          sind. Nichts geht verloren — es geht nur nichts hinaus.
        </p>
      )}

      <p className="leise">
        {eintraege.length === 0
          ? 'Das Ausgangsbuch ist leer.'
          : `${eintraege.length} Einträge, davon ${offen.length} noch nicht hinaus.`}
      </p>

      {eintraege.length > 0 && (
        <table>
          <thead>
            <tr>
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
                <td style={{ ...zelle, color: FARBE[e.status] ?? 'var(--farbe-text)' }}>
                  {e.status}
                  {e.versuche > 0 && (
                    <span className="leise winzig">
                      {' '}
                      · {e.versuche} Versuch{e.versuche === 1 ? '' : 'e'}
                    </span>
                  )}
                  {e.gesendetAm !== null && (
                    <div className="leise winzig">
                      {datum.format(new Date(e.gesendetAm))}
                    </div>
                  )}
                  {e.fehler !== null && (
                    <div className="winzig">{e.fehler}</div>
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
                          color: 'var(--farbe-akzent)',
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

      <h2>Vorlagen</h2>
      <p className="leise klein">
        Platzhalter in doppelten geschweiften Klammern. Verfügbar sind:{' '}
        {Object.keys(PLATZHALTER)
          .map((k) => `{{${k}}}`)
          .join(', ')}
        . Ein Name, der nicht dabeisteht, bleibt im Text stehen — so fällt ein
        Tippfehler auf, bevor die Mail hinausgeht.
      </p>

      <table>
        <tbody>
          {vorlagen.map((v) => (
            <tr key={v.id}>
              <td style={zelle}>
                <strong>{v.name}</strong>
                <div className="leise winzig">{v.schluessel}</div>
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
                    <a href="/postausgang" className="klein">
                      abbrechen
                    </a>
                  </form>
                ) : (
                  <>
                    <div>{v.betreff}</div>
                    <pre
                      style={{
                        color: 'var(--farbe-text-leise)',
                        fontFamily: 'inherit',
                        fontSize: '0.82rem',
                        margin: '0.3rem 0 0',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {v.text}
                    </pre>
                    <a href={`/postausgang?vorlage=${v.id}`} className="klein">
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
