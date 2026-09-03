/**
 * Belegansicht.
 *
 * Die erste Seite kommt als fertiges Bild aus der Ablage. Kein Rendern beim
 * Oeffnen, kein PDF im Hintergrund -- das PDF holt der Browser erst, wenn
 * jemand es ausdruecklich anfordert (Konzept 23).
 */

import { notFound } from 'next/navigation'
import { befundeLaden, belegkopfLaden, seitentextLaden } from '@/app/lib/belege'
import { Layerformular, Layerschicht, Notizliste } from '@/app/lib/layerschicht'
import { layerLaden } from '@/layer'
import { Befunde, belegBezeichnung, Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'
import { archivstandLaden } from '@/archiv'
import { gewaehrleistungOffen, wartenZumBeleg } from '@/nebenlauf'
import { Warten } from '@/app/lib/wartenmaske'

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
  const layer = await layerLaden(benutzer, id)
  const befunde = await befundeLaden(benutzer, id)
  const archiv = await alsBenutzer(benutzer, (c) => archivstandLaden(c, id))
  const warten = await alsBenutzer(benutzer, (c) => wartenZumBeleg(c, id))
  // Der Vorschlag bei einer Reparatur: Welche Bauteile standen zum
  // Belegdatum noch unter Gewaehrleistung? (Konzept 10.2)
  const gewaehrleistung =
    kopf.objektnummer === null || kopf.objektId === null
      ? []
      : await gewaehrleistungOffen(benutzer, kopf.objektId)
  const seitenzahl = kopf.seitenzahl ?? seiten.length

  // Ueber den gemeinsamen Helfer: Ein Schriftstueck hat keinen Kreditor und
  // keine Rechnungsnummer, aber einen Korrespondenten und einen Betreff.
  const titel = belegBezeichnung(kopf)

  return (
    /*
     * Mit Rahmen, also mit Navigation und Abmelden.
     *
     * Vorher stand hier ein eigenes `main` -- die Belegansicht war damit eine
     * Sackgasse: Wer sie oeffnete, kam nur mit dem Zurueck-Knopf des Browsers
     * wieder weg. Aufgefallen ist es, als ein Test sich von hier abmelden
     * wollte und die Schaltflaeche nicht fand.
     */
    <Seitenrahmen titel={titel}>
      <header style={{ marginBottom: '1.5rem' }}>
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

      {gewaehrleistung.length > 0 && (
        <section
          style={{
            background: '#FDF3E3',
            borderLeft: '3px solid #B5741A',
            color: '#6B4A15',
            margin: '1rem 0',
            padding: '0.6rem 0.9rem',
          }}
        >
          <strong>Gewährleistung offen</strong> — an diesem Objekt stehen{' '}
          {gewaehrleistung.length === 1 ? 'ein Bauteil' : `${gewaehrleistung.length} Bauteile`}{' '}
          noch unter Gewährleistung:{' '}
          {gewaehrleistung
            .map((b) => `${b.bezeichnung} (bis ${b.gewaehrleistungBis})`)
            .join(', ')}
          . Bei einer Reparaturrechnung ist zu prüfen, ob sie zulasten des
          Lieferanten geht.
        </section>
      )}

      <Warten container={warten} dokumentId={id} />

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
            {Array.from({ length: seitenzahl }, (_, i) => i + 1).map((nr) => {
              const masse = seiten.find((s) => s.seite === nr)
              const aufSeite = layer.filter((l) => l.seite === nr)
              return (
                <figure key={nr} id={`seite-${nr}`} style={{ margin: '0 0 1.5rem' }}>
                  {/* Bewusst ein einfaches img: das Bild liegt fertig vor, es
                      gibt nichts zu optimieren, was nicht schon optimiert waere.
                      Die Layer liegen als Überlagerung darüber -- nie im Bild,
                      denn dann müssten sie beim Rendern schon feststehen. */}
                  <div style={{ position: 'relative' }}>
                    <img
                      src={`/api/beleg/${id}/seite/${nr}`}
                      alt={`Seite ${nr}`}
                      loading={nr === 1 ? 'eager' : 'lazy'}
                      style={{ width: '100%', border: '1px solid #ddd', display: 'block' }}
                    />
                    <Layerschicht
                      layer={aufSeite}
                      breite={masse?.breite ?? 0}
                      hoehe={masse?.hoehe ?? 0}
                    />
                  </div>
                  <figcaption>
                    <Notizliste layer={aufSeite} dokumentId={id} />
                  </figcaption>
                </figure>
              )
            })}

            {/* Stempel, für die auf Seite 1 kein Platz mehr war. Im Export
                stehen sie auf einer angehängten Leerseite (Konzept 16); in
                der Ansicht hier als Liste, weil es keine solche Seite gibt. */}
            {layer.some((l) => l.seite === 0) && (
              <aside style={{ border: '1px dashed #B5741A', padding: '0.75rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>Ohne Platz auf der Seite</strong>
                <ul style={{ fontSize: '0.85rem', margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                  {layer
                    .filter((l) => l.seite === 0)
                    .map((l) => (
                      <li key={l.id}>{l.text}</li>
                    ))}
                </ul>
              </aside>
            )}
          </div>
        </div>
      )}

      {seitenzahl > 0 && (
        <Layerformular
          dokumentId={id}
          seiten={Array.from({ length: seitenzahl }, (_, i) => i + 1)}
        />
      )}

      <footer style={{ borderTop: '1px solid #ddd', marginTop: '1rem', paddingTop: '1rem' }}>
        <a href={`/api/beleg/${id}/pdf`}>Original-PDF öffnen</a>

        {/* Die vier Varianten aus Konzept 16. Das Archivoriginal steht schon
            oben als „Original-PDF" -- hier die drei, die Layer tragen. */}
        <p style={{ color: '#555', fontSize: '0.85rem', margin: '0.6rem 0 0' }}>
          Ausgeben als{' '}
          {(
            [
              ['stempel', 'Beleg mit Stempeln'],
              ['extern', 'Belegeinsicht'],
              ['intern', 'interne Akte'],
            ] as const
          ).map(([variante, name], i) => (
            <span key={variante}>
              {i > 0 && ' · '}
              <a href={`/api/beleg/${id}/export?variante=${variante}`}>{name}</a>
            </span>
          ))}
        </p>

        <p style={{ color: '#666', fontSize: '0.78rem', margin: '0.3rem 0 0' }}>
          Ist der Beleg geschwärzt, entstehen diese Ausgaben aus den
          Seitenbildern — dann ist das Geschwärzte wirklich weg, dafür der Text
          nicht mehr durchsuchbar. Das Archivoriginal bleibt in jedem Fall
          unverändert.
        </p>
      </footer>
    </Seitenrahmen>
  )
}
