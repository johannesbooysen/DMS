/**
 * Der Beleg in der Mitte des Arbeitsplatzes: alle Seiten, alle Stempel.
 *
 * Serverseitig, wie die Belegansicht -- die Seitenbilder liegen fertig in
 * der Ablage, die Layer kommen aus der Datenbank, und beides gehoert nicht
 * in den Browser gerechnet. Nur der Zoom ist Zustand, und der sitzt im
 * `Zoomrahmen` drumherum.
 *
 * Nur lesen: keine beweglichen Stempel, kein Notizformular. Wer einen
 * Stempel verschieben oder eine Notiz setzen will, geht in die Belegansicht
 * -- am Arbeitsplatz wird entschieden, nicht gestaltet.
 */

import Link from 'next/link'
import { seitentextLaden } from '@/app/lib/belege'
import { Layerschicht } from '@/app/lib/layerschicht'
import { Zoomrahmen } from '@/app/lib/zoomrahmen'
import { layerLaden } from '@/layer'

export async function Belegbetrachter({
  benutzer,
  dokumentId,
  seitenzahl,
}: {
  benutzer: string
  dokumentId: string
  seitenzahl: number
}) {
  const [seiten, layer] = await Promise.all([
    seitentextLaden(benutzer, dokumentId),
    layerLaden(benutzer, dokumentId),
  ])
  const anzahl = seitenzahl > 0 ? seitenzahl : seiten.length

  if (anzahl === 0) {
    return (
      <div className="betrachter">
        <p style={{ color: 'var(--farbe-text-leise)', textAlign: 'center' }}>
          Für diesen Beleg liegt noch keine Ansicht vor — die Aufbereitung läuft.
        </p>
      </div>
    )
  }

  const ohnePlatz = layer.filter((l) => l.seite === 0)

  return (
    <Zoomrahmen
      rechts={
        <Link href={`/beleg/${dokumentId}`}>
          {anzahl} Seite{anzahl === 1 ? '' : 'n'} · Belegansicht
        </Link>
      }
    >
      {Array.from({ length: anzahl }, (_, i) => i + 1).map((nr) => {
        const masse = seiten.find((s) => s.seite === nr)
        return (
          <figure key={nr} className="betrachter-seite" id={`seite-${nr}`} style={{ margin: '0 0 1rem' }}>
            {/* Das fertige Bild, nichts zu optimieren; die Layer liegen als
                Ueberlagerung darueber -- nie im Bild. */}
            <img
              src={`/api/beleg/${dokumentId}/seite/${nr}`}
              alt={`Seite ${nr}`}
              loading={nr === 1 ? 'eager' : 'lazy'}
            />
            <Layerschicht
              layer={layer.filter((l) => l.seite === nr)}
              breite={masse?.breite ?? 0}
              hoehe={masse?.hoehe ?? 0}
            />
            {anzahl > 1 && (
              <figcaption className="betrachter-seitenzahl" style={{ margin: 0, padding: '0.3rem 0' }}>
                Seite {nr} von {anzahl}
              </figcaption>
            )}
          </figure>
        )
      })}
      {ohnePlatz.length > 0 && (
        <aside
          style={{
            background: 'var(--farbe-orange-hell)',
            borderRadius: 'var(--radius)',
            fontSize: '0.85rem',
            padding: '0.6rem 0.9rem',
          }}
        >
          <strong>Ohne Platz auf der Seite:</strong>{' '}
          {ohnePlatz.map((l) => l.text).join(' · ')}
        </aside>
      )}
    </Zoomrahmen>
  )
}
