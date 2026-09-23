/**
 * Uebersicht der Ablaeufe.
 *
 * Zeigt je Belegart und Ordnungsgruppe die Fassungen mit ihrem Zustand --
 * und wie viele Belege noch in einer alten Fassung unterwegs sind. Das ist
 * der Grund fuer die Versionierung: Eine abgeloeste Fassung ist nicht
 * ungueltig, sie laeuft nur aus (Konzept 8.8).
 */

import { entwurfAnlegenAktion } from '@/app/lib/konfig-aktionen'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { definitionenLaden, type Definitionszeile } from '@/workflow/konfiguration'

export const dynamic = 'force-dynamic'

const ZUSTAND: Record<string, string> = {
  entwurf: 'Entwurf',
  aktiv: 'aktiv',
  abgeloest: 'abgelöst',
}

function Fassungstabelle({ zeilen }: { zeilen: Definitionszeile[] }) {
  if (zeilen.length === 0) return <p className="leise">Nichts vorhanden.</p>

  return (
    <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', width: '100%' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--farbe-linie-stark)', textAlign: 'left' }}>
          <th>Belegart</th>
          <th>Ordnungsgruppe</th>
          <th>Fassung</th>
          <th>Zustand</th>
          <th className="rechts">laufende Belege</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((f) => (
          <tr key={f.id} style={{ borderBottom: '1px solid var(--farbe-linie)' }}>
            <td>{f.belegart}</td>
            <td>{f.ordnungsgruppe ?? 'alle'}</td>
            <td>
              <a href={`/konfiguration/${f.id}`}>Version {f.version}</a>
            </td>
            <td>
              {ZUSTAND[f.status] ?? f.status}
              {f.entwurfVonName !== null && ` · ${f.entwurfVonName}`}
            </td>
            <td className="rechts">{f.laufendeBelege}</td>
            <td>
              {f.status === 'aktiv' && (
                <form action={entwurfAnlegenAktion}>
                  <input type="hidden" name="vorlageId" value={f.id} />
                  <button type="submit">Entwurf anlegen</button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default async function Konfiguration({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const { fehler } = await searchParams
  const fassungen = await definitionenLaden(await angemeldeterBenutzer())
  const laufend = fassungen.filter((f) => f.status !== 'abgeloest')
  const abgeloest = fassungen.filter((f) => f.status === 'abgeloest')

  return (
    <Seitenrahmen titel="Abläufe">
      {fehler !== undefined && (
        <p role="alert" className="meldung-fehler">
          {fehler}
        </p>
      )}

      {fassungen.length === 0 ? (
        <p className="leise">Keine Prozessdefinition vorhanden.</p>
      ) : (
        <>
          <Fassungstabelle zeilen={laufend} />

          {/*
            Abgeloeste Fassungen werden nie geloescht -- sie erklaeren, warum
            ein Beleg seinen Weg genommen hat. Sichtbar bleiben muessen sie
            trotzdem nicht: Nach einigen Aenderungen waere die Liste sonst
            unlesbar, und die interessante Zeile ist immer die aktive.
          */}
          {abgeloest.length > 0 && (
            <details style={{ marginTop: '1.5rem' }}>
              <summary style={{ cursor: 'pointer' }}>
                {abgeloest.length} abgelöste Fassung{abgeloest.length === 1 ? '' : 'en'}
              </summary>
              <div style={{ marginTop: '0.75rem' }}>
                <Fassungstabelle zeilen={abgeloest} />
              </div>
            </details>
          )}
        </>
      )}

      <p style={{ color: 'var(--farbe-text-leise)', marginTop: '1.5rem' }}>
        Eine Fassung wird nie überschrieben. Wer etwas ändert, legt einen Entwurf an;
        laufende Belege behalten ihre Fassung bis zum Abschluss.
      </p>
    </Seitenrahmen>
  )
}
