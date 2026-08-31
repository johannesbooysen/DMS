/**
 * Gemeinsame Darstellungsbausteine.
 *
 * Bewusst schlicht und ohne Gestaltungsrahmen: Die Oberflaeche soll zeigen,
 * dass die Fachlogik traegt. Ein Entwurf gehoert danach, nicht davor.
 */

import type { ReactNode } from 'react'

export const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
export const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

export const AMPELFARBEN: Record<string, string> = {
  gruen: '#2F6F4E',
  orange: '#B5741A',
  rot: '#B3271E',
}

export function Ampel({ wert }: { wert: string | null }) {
  if (wert === null) return null
  return (
    <span
      title={`Ampel ${wert}`}
      aria-label={`Ampel ${wert}`}
      style={{
        background: AMPELFARBEN[wert] ?? '#888',
        borderRadius: '50%',
        display: 'inline-block',
        height: '0.6rem',
        width: '0.6rem',
      }}
    />
  )
}

export function Seitenrahmen({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: '72rem',
        padding: '1.5rem',
      }}
    >
      <nav style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
        <a href="/postfach">Postfächer</a>{' · '}
        <a href="/konfiguration">Abläufe</a>
      </nav>
      <h1 style={{ fontSize: '1.375rem', marginTop: 0 }}>{titel}</h1>
      {children}
    </main>
  )
}
