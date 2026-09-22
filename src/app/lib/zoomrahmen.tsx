'use client'

/**
 * Zoom um serverseitig gerenderte Seiten herum.
 *
 * Die Seiten selbst -- Bilder, Layer, Stempel -- kommen vom Server als
 * `children`; hier steht nur der eine Zustand, den der Server nicht haben
 * kann: wie gross der Betrachter sie gerade sehen will. Derselbe Grund und
 * dieselben Grenzen wie in `belegvorschau.tsx`: Knoepfe statt Schieberegler,
 * weil `lib` ohne `DOM` gesetzt ist.
 *
 * Die Breite wirkt auf den Stapel, nicht auf das Bild: Die Layer liegen in
 * Prozent ueber dem Bild und wandern deshalb mit.
 */

import { useState, type ReactNode } from 'react'

const KLEINSTE = 50
const GROESSTE = 250
const SCHRITT = 25

export function Zoomrahmen({ children, rechts }: { children: ReactNode; rechts?: ReactNode }) {
  const [zoom, setZoom] = useState(100)

  return (
    <>
      <div className="zoomleiste" role="toolbar" aria-label="Ansicht">
        <button type="button" aria-label="Kleiner" onClick={() => setZoom((z) => Math.max(KLEINSTE, z - SCHRITT))}>
          −
        </button>
        <button type="button" aria-label="Größer" onClick={() => setZoom((z) => Math.min(GROESSTE, z + SCHRITT))}>
          +
        </button>
        <span>{zoom} %</span>
        <button type="button" onClick={() => setZoom(100)}>
          Seitenbreite
        </button>
        {rechts !== undefined && <span className="zoomleiste-rechts">{rechts}</span>}
      </div>
      <div className="betrachter">
        <div style={{ margin: '0 auto', width: `${zoom}%`, minWidth: `${zoom}%` }}>{children}</div>
      </div>
    </>
  )
}
