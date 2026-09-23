/**
 * Der Beleg als Seitenstapel: alle Seiten, alle Layer -- am Arbeitsplatz
 * und in der Belegansicht dasselbe Bauteil.
 *
 * Serverseitig, wie die Belegansicht immer war -- die Seitenbilder liegen
 * fertig in der Ablage, die Layer kommen aus der Datenbank, und beides
 * gehoert nicht in den Browser gerechnet. Nur der Zoom ist Zustand, und der
 * sitzt im `Zoomrahmen` drumherum; die Seitentasten (Pfeil links/rechts)
 * springen ueber Anker, nicht ueber Zustand.
 *
 * Zwei Betriebsarten:
 *   - **nur lesen** (Arbeitsplatz): keine beweglichen Stempel, keine
 *     Notizliste. Dort wird entschieden, nicht gestaltet.
 *   - **bearbeitbar** (Belegansicht): der eigene, noch nicht festgelegte
 *     Stempel laesst sich verschieben (ADR 0008), Notizen stehen unter der
 *     Seite und lassen sich ausblenden.
 */

import Link from 'next/link'
import { seitentextLaden } from '@/app/lib/belege'
import { stempelVerschiebenAktion } from '@/app/lib/layer-aktionen'
import { Layerschicht, Notizliste } from '@/app/lib/layerschicht'
import { Seitentasten } from '@/app/lib/seitentasten'
import { Zoomrahmen } from '@/app/lib/zoomrahmen'
import { layerLaden, textkaestenLaden, verschiebbareStempel } from '@/layer'
import type { Kasten } from '@/layer/platzierung'

export async function Belegbetrachter({
  benutzer,
  dokumentId,
  seitenzahl,
  bearbeitbar = false,
  treffer = [],
  verweis = true,
}: {
  benutzer: string
  dokumentId: string
  seitenzahl: number
  /** Eigene Stempel verschieben, Notizen ausblenden -- die Belegansicht. */
  bearbeitbar?: boolean
  /** Seiten mit Suchtreffern -- sie bekommen eine Marke. */
  treffer?: number[]
  /** Verweis in die Belegansicht rechts in der Leiste (am Arbeitsplatz). */
  verweis?: boolean
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

  // Welche Stempel der Betrachter jetzt anfassen darf, und wo auf jeder
  // Seite Text steht -- beides nur Rueckmeldung; die Grenze zieht der
  // Trigger (ADR 0008). Nur laden, wenn es gebraucht wird.
  const beweglich = bearbeitbar ? [...(await verschiebbareStempel(benutzer, dokumentId))] : []
  const textkaesten: Map<number, Kasten[]> = bearbeitbar
    ? await textkaestenLaden(benutzer, dokumentId)
    : new Map()

  const ohnePlatz = layer.filter((l) => l.seite === 0)

  return (
    <Zoomrahmen
      rechts={
        <>
          <Seitentasten anzahl={anzahl} />
          {verweis && (
            <Link href={`/beleg/${dokumentId}`}>
              {anzahl} Seite{anzahl === 1 ? '' : 'n'} · Belegansicht
            </Link>
          )}
        </>
      }
    >
      {Array.from({ length: anzahl }, (_, i) => i + 1).map((nr) => {
        const masse = seiten.find((s) => s.seite === nr)
        const aufSeite = layer.filter((l) => l.seite === nr)
        return (
          <figure key={nr} className="betrachter-seite" id={`seite-${nr}`} style={{ margin: '0 0 1rem' }}>
            {/* Das fertige Bild, nichts zu optimieren; die Layer liegen als
                Ueberlagerung darueber -- nie im Bild. */}
            <div style={{ position: 'relative' }}>
              <img
                src={`/api/beleg/${dokumentId}/seite/${nr}`}
                alt={`Seite ${nr}`}
                loading={nr === 1 ? 'eager' : 'lazy'}
              />
              <Layerschicht
                layer={aufSeite}
                breite={masse?.breite ?? 0}
                hoehe={masse?.hoehe ?? 0}
                beweglich={beweglich}
                textkaesten={textkaesten.get(nr) ?? []}
                seitenzahl={anzahl}
                dokumentId={dokumentId}
              />
              {treffer.includes(nr) && <span className="betrachter-treffer">Treffer</span>}
            </div>
            <figcaption className="betrachter-fuss">
              {anzahl > 1 && (
                <span className="betrachter-seitenzahl">
                  Seite {nr} von {anzahl}
                </span>
              )}
              {bearbeitbar && <Notizliste layer={aufSeite} dokumentId={dokumentId} />}
            </figcaption>
          </figure>
        )
      })}

      {/* Stempel, für die auf Seite 1 kein Platz mehr war. Im Export stehen
          sie auf einer angehängten Leerseite (Konzept 16); hier als Liste,
          weil es keine solche Seite gibt. */}
      {ohnePlatz.length > 0 && (
        <aside className="betrachter-ohne-platz">
          <strong>Ohne Platz auf der Seite</strong>
          <ul>
            {ohnePlatz.map((l) => (
              <li key={l.id}>
                {l.text}
                {/* Der eigene, noch nicht festgelegte Stempel darf von der
                    Leerseite auf eine echte Seite -- oben links; der Trigger
                    weist ab, wenn dort Text steht, und dann sagt die Meldung
                    das. Feinschliff danach auf der Seite selbst. */}
                {bearbeitbar && beweglich.includes(l.id) && (
                  <form action={stempelVerschiebenAktion} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                    <input type="hidden" name="dokumentId" value={dokumentId} />
                    <input type="hidden" name="layerId" value={l.id} />
                    <input type="hidden" name="seite" value={1} />
                    <input type="hidden" name="x" value={40} />
                    <input type="hidden" name="y" value={40} />
                    <input type="hidden" name="breite" value={l.breite} />
                    <input type="hidden" name="hoehe" value={l.hoehe} />
                    <button type="submit">Auf Seite 1 legen</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </Zoomrahmen>
  )
}
