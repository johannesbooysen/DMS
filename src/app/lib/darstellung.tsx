/**
 * Gemeinsame Darstellungsbausteine.
 *
 * Bewusst schlicht und ohne Gestaltungsrahmen: Die Oberflaeche soll zeigen,
 * dass die Fachlogik traegt. Ein Entwurf gehoert danach, nicht davor.
 */

import type { ReactNode } from 'react'

import { abmeldenAktion } from '@/app/lib/anmelde-aktionen'

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
      <nav
        style={{
          alignItems: 'baseline',
          display: 'flex',
          fontSize: '0.875rem',
          justifyContent: 'space-between',
          marginBottom: '1rem',
        }}
      >
        <span>
          <a href="/postfach">Postfächer</a>{' · '}
          <a href="/belege">Belege</a>{' · '}
          <a href="/konfiguration">Abläufe</a>{' · '}
          <a href="/vertretung">Vertretung</a>
        </span>
        {/* Abmelden ist ein Formular, kein Link: Es ändert etwas auf dem
            Server. Ein Link dorthin könnte von fremder Seite ausgelöst
            werden -- lästig, nicht gefährlich, aber unnötig. */}
        <form action={abmeldenAktion}>
          <button
            type="submit"
            style={{
              background: 'none',
              border: 0,
              color: '#3B4A80',
              cursor: 'pointer',
              font: 'inherit',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Abmelden
          </button>
        </form>
      </nav>
      <h1 style={{ fontSize: '1.375rem', marginTop: 0 }}>{titel}</h1>
      {children}
    </main>
  )
}

/**
 * Die Plausibilitaetsbefunde als Liste.
 *
 * Harte Befunde stehen oben und sind als Anhalten gekennzeichnet -- sie
 * faerben nicht nur, sie stoppen die Bearbeitung (Konzept 14).
 */
export function Befunde({
  befunde,
}: {
  befunde: Array<{ pruefung: string; schwere: string; hinweis: string }>
}) {
  if (befunde.length === 0) return null

  return (
    <section
      style={{
        background: '#FAFAF8',
        border: '1px solid #ddd',
        borderRadius: '0.25rem',
        margin: '1rem 0',
        padding: '0.75rem 1rem',
      }}
    >
      <h2 style={{ fontSize: '0.95rem', marginTop: 0 }}>Prüfhinweise</h2>
      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {befunde.map((b) => (
          <li key={b.pruefung} style={{ marginBottom: '0.4rem' }}>
            <strong style={{ color: b.schwere === 'hart' ? '#B3271E' : '#B5741A' }}>
              {b.schwere === 'hart' ? 'Bearbeitung angehalten' : 'Zu prüfen'}
            </strong>{' '}
            — {b.hinweis}
          </li>
        ))}
      </ul>
    </section>
  )
}
