/**
 * Posteingang.
 *
 * Die Tür, die bisher fehlte: `dokumentAufnehmen` gab es schon, aber
 * außerhalb eines Demoskripts rief es niemand auf — es gab keinen Weg, einen
 * Beleg ins System zu bringen.
 *
 * Zwei Wege, und die Unterscheidung ist eine Entscheidung des Menschen, nicht
 * eine Erkennung: Ein einzelner Beleg geht direkt in den Lauf. Ein Stapel aus
 * dem Scanner geht zuerst in die Trennung — dort ist noch nichts geschrieben,
 * was zurückgenommen werden müsste (Konzept 24.1).
 */

import { offeneStapel } from '@/stapel'
import { postAufnehmenAktion } from '@/app/lib/posteingang-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { datum, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const zelle = { borderBottom: '1px solid #eee', padding: '0.5rem' } as const

export default async function Posteingang({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const { fehler } = await searchParams
  const stapel = await offeneStapel(await angemeldeterBenutzer())

  return (
    <Seitenrahmen titel="Posteingang">
      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      <form
        action={postAufnehmenAktion}
        style={{
          alignItems: 'flex-end',
          border: '1px solid #ddd',
          borderRadius: '0.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.8rem',
          margin: '1rem 0 1.5rem',
          padding: '1rem',
        }}
      >
        <label style={{ display: 'block', fontSize: '0.8rem' }}>
          Datei
          <input
            type="file"
            name="datei"
            accept="application/pdf,image/*,message/rfc822"
            required
            style={{ display: 'block', marginTop: '0.3rem' }}
          />
        </label>

        <label style={{ fontSize: '0.85rem' }}>
          <input type="checkbox" name="stapel" value="ja" /> Stapelscan — enthält
          mehrere Belege
        </label>

        <button type="submit" style={{ cursor: 'pointer', padding: '0.45rem 1rem' }}>
          Aufnehmen
        </button>
      </form>

      <p style={{ color: '#555', fontSize: '0.85rem' }}>
        Ein einzelner Beleg geht sofort in den Ablauf. Ein Stapelscan wird erst
        getrennt und geprüft — bis zur Übernahme entsteht kein Dokument.
      </p>

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Stapel in Prüfung</h2>

      {stapel.length === 0 ? (
        <p>Kein Stapel wartet auf Prüfung.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Datei</th>
              <th style={zelle}>Eingang</th>
              <th style={zelle}>Seiten</th>
              <th style={zelle}>Erkannte Belege</th>
            </tr>
          </thead>
          <tbody>
            {stapel.map((s) => (
              <tr key={s.stapelId}>
                <td style={zelle}>
                  <a href={`/posteingang/${s.stapelId}`}>{s.dateiname}</a>
                  <span style={{ color: '#666', fontSize: '0.78rem' }}>
                    {' '}
                    · {s.eingangskanal}
                  </span>
                </td>
                <td style={zelle}>{datum.format(new Date(s.eingangAm))}</td>
                <td style={zelle}>{s.seitenzahl}</td>
                <td style={zelle}>{s.belege}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seitenrahmen>
  )
}
