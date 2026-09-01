/**
 * Eingangsquellen.
 *
 * Die Seite beantwortet eine einzige Frage, und sie ist die wichtigste bei
 * einem Kanal, dem niemand zusieht: **Läuft das noch?**
 *
 * Deshalb stehen „zuletzt nachgesehen" und „zuletzt etwas bekommen"
 * nebeneinander. Der Unterschied ist die Auskunft: Eine Quelle, die läuft und
 * nichts findet, ist etwas anderes als eine, die gar nicht mehr läuft.
 */

import { quellenLaden } from '@/eingang'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { seit, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const zelle = {
  borderBottom: '1px solid #eee',
  padding: '0.45rem 0.5rem',
  verticalAlign: 'top',
} as const

const ART: Record<string, string> = {
  ordner: 'Überwachter Ordner',
  mail: 'Mailpostfach',
}

export default async function Eingangsquellen() {
  const quellen = await quellenLaden(await angemeldeterBenutzer())

  return (
    <Seitenrahmen titel="Eingangsquellen">
      <p style={{ color: '#555' }}>
        Woher Belege von selbst hereinkommen. Was hier ankommt, geht durch
        denselben Eingang wie ein Upload — dieselbe Dublettenprüfung, dieselbe
        Aufbereitung.
      </p>

      {quellen.length === 0 ? (
        <p>Es ist keine Quelle eingerichtet. Belege kommen nur über Upload und Scan herein.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Quelle</th>
              <th style={zelle}>Nachgesehen</th>
              <th style={zelle}>Zuletzt etwas bekommen</th>
              <th style={zelle}>Gesamt</th>
              <th style={zelle}>Stand</th>
            </tr>
          </thead>
          <tbody>
            {quellen.map((q) => (
              <tr key={q.id}>
                <td style={zelle}>
                  <strong>{q.bezeichnung}</strong>
                  <div style={{ color: '#666', fontSize: '0.78rem' }}>
                    {ART[q.art] ?? q.art} · alle {Math.round(q.taktSekunden / 60) || 1} min
                  </div>
                </td>
                <td style={{ ...zelle, fontSize: '0.85rem' }}>
                  {q.zuletztGeprueft === null ? 'noch nie' : seit(q.zuletztGeprueft)}
                </td>
                <td style={{ ...zelle, fontSize: '0.85rem' }}>
                  {q.zuletztErfolg === null ? '—' : seit(q.zuletztErfolg)}
                </td>
                <td style={{ ...zelle, fontSize: '0.85rem' }}>{q.aufgenommen}</td>
                <td style={zelle}>
                  {!q.aktiv ? (
                    <span style={{ color: '#666' }}>abgeschaltet</span>
                  ) : q.letzterFehler !== null ? (
                    <span style={{ color: '#B3271E' }}>{q.letzterFehler}</span>
                  ) : (
                    <span style={{ color: '#2F6F4E' }}>läuft</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '1.5rem' }}>
        Quellen werden derzeit in der Datenbank eingerichtet, nicht hier — eine
        Maske dafür fehlt noch. Ein Postfachpasswort steht dabei <strong>nie</strong>{' '}
        in der Datenbank, sondern als Name einer Umgebungsvariablen; das
        Geheimnis selbst liegt auf dem Rechner, auf dem der Worker läuft.
      </p>
    </Seitenrahmen>
  )
}
