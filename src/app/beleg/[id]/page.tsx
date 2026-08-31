/**
 * Belegansicht.
 *
 * Die erste Seite kommt als fertiges Bild aus der Ablage. Kein Rendern beim
 * Oeffnen, kein PDF im Hintergrund -- das PDF holt der Browser erst, wenn
 * jemand es ausdruecklich anfordert (Konzept 23).
 */

import { notFound } from 'next/navigation'
import { befundeLaden, belegkopfLaden, seitentextLaden } from '@/app/lib/belege'
import { Befunde } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'
import { archivstandLaden } from '@/archiv'

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

export default async function Belegansicht({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const benutzer = await angemeldeterBenutzer()

  const kopf = await belegkopfLaden(benutzer, id)
  // return, damit der Typ danach eng ist: notFound() wird ueber
  // next/navigation nicht als "never" weitergereicht.
  if (kopf === null) return notFound()

  const seiten = await seitentextLaden(benutzer, id)
  const befunde = await befundeLaden(benutzer, id)
  const archiv = await alsBenutzer(benutzer, (c) => archivstandLaden(c, id))
  const seitenzahl = kopf.seitenzahl ?? seiten.length

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '0 auto', maxWidth: '72rem', padding: '1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>
          {kopf.kreditor ?? 'Ohne Kreditor'}
          {kopf.rechnungsnummer !== null && ` · ${kopf.rechnungsnummer}`}
        </h1>
        <p style={{ color: '#555', margin: '0.25rem 0 0' }}>
          {[
            kopf.objektnummer !== null && `Objekt ${kopf.objektnummer}`,
            kopf.ordnungsgruppe,
            kopf.brutto !== null && euro.format(kopf.brutto),
            `Eingang ${datum.format(new Date(kopf.eingangAm))}`,
            `${seitenzahl} Seite${seitenzahl === 1 ? '' : 'n'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      {archiv !== null && (
        <p
          style={{
            background: '#EEF1F6',
            borderLeft: '3px solid #3B4A80',
            color: '#33405C',
            margin: '1rem 0',
            padding: '0.6rem 0.9rem',
          }}
        >
          <strong>Archiviert</strong>
          {archiv.archiviertAm !== null &&
            ` am ${datum.format(new Date(archiv.archiviertAm))}`}
          . Aufbewahrung bis{' '}
          {archiv.aufbewahrungBis === null
            ? '—'
            : datum.format(new Date(archiv.aufbewahrungBis))}
          {archiv.aufbewahrungsgrund !== null && ` (${archiv.aufbewahrungsgrund})`}.
          {' '}Änderungen laufen ab hier über Storno und Neuerfassung.
          {archiv.loeschsperre && ' Eine Löschsperre steht.'}
        </p>
      )}

      <Befunde befunde={befunde} />

      {seitenzahl === 0 ? (
        <p>Für diesen Beleg liegt noch keine Ansicht vor — die Aufbereitung läuft.</p>
      ) : (
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
          <nav aria-label="Seiten" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {Array.from({ length: seitenzahl }, (_, i) => i + 1).map((nr) => (
              <a key={nr} href={`#seite-${nr}`} style={{ fontSize: '0.875rem' }}>
                Seite {nr}
              </a>
            ))}
          </nav>

          <div style={{ flex: 1 }}>
            {Array.from({ length: seitenzahl }, (_, i) => i + 1).map((nr) => (
              <figure key={nr} id={`seite-${nr}`} style={{ margin: '0 0 1.5rem' }}>
                {/* Bewusst ein einfaches img: das Bild liegt fertig vor, es
                    gibt nichts zu optimieren, was nicht schon optimiert waere. */}
                <img
                  src={`/api/beleg/${id}/seite/${nr}`}
                  alt={`Seite ${nr}`}
                  loading={nr === 1 ? 'eager' : 'lazy'}
                  style={{ width: '100%', border: '1px solid #ddd' }}
                />
              </figure>
            ))}
          </div>
        </div>
      )}

      <footer style={{ borderTop: '1px solid #ddd', marginTop: '1rem', paddingTop: '1rem' }}>
        <a href={`/api/beleg/${id}/pdf`}>Original-PDF öffnen</a>
      </footer>
    </main>
  )
}
