/**
 * Ein Beleg in der externen Ansicht.
 *
 * Der Umfang wird hier **erneut** geprüft, nicht aus der Liste übernommen:
 * Wer die Dokumentkennung kennt, darf sie nicht dadurch abrufen können, dass
 * er die Liste übersprungen hat.
 */

import { notFound } from 'next/navigation'
import {
  einsichtAufloesen,
  einsichtBelege,
  einsichtDarfBeleg,
  einsichtProtokollieren,
} from '@/einsicht'

export const dynamic = 'force-dynamic'

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

export default async function Einsichtsbeleg({
  params,
}: {
  params: Promise<{ token: string; dokument: string }>
}) {
  const { token, dokument } = await params

  const gewaehrung = await einsichtAufloesen(token)
  if (gewaehrung === null) return notFound()

  if (!(await einsichtDarfBeleg(gewaehrung.gewaehrungId, dokument))) {
    // Der Versuch wird festgehalten -- er ist der interessantere Eintrag im
    // Protokoll als ein erfolgreicher Aufruf.
    await einsichtProtokollieren(gewaehrung.gewaehrungId, null, 'abgelehnt')
    return notFound()
  }

  await einsichtProtokollieren(gewaehrung.gewaehrungId, dokument, 'ansicht')

  const belege = await einsichtBelege(gewaehrung.gewaehrungId, { limit: 1000 })
  const beleg = belege.find((b) => b.dokumentId === dokument)
  const seiten = beleg === undefined ? 0 : 1

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: '52rem',
        padding: '2rem 1.5rem',
      }}
    >
      <p style={{ fontSize: '0.85rem' }}>
        <a href={`/einsicht/${token}`}>← Zurück zur Liste</a>
      </p>

      <h1 style={{ fontSize: '1.2rem', margin: '0.5rem 0 0' }}>
        {beleg?.kreditor ?? 'Beleg'}
        {beleg?.rechnungsnummer != null && ` · ${beleg.rechnungsnummer}`}
      </h1>
      <p style={{ color: '#555', marginTop: '0.3rem' }}>
        {[
          beleg?.brutto != null && euro.format(beleg.brutto),
          beleg?.leistungVon != null &&
            `Leistung ab ${datum.format(new Date(beleg.leistungVon))}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {seiten === 0 ? (
        <p>Für diesen Beleg liegt keine Ansicht vor.</p>
      ) : (
        <figure style={{ margin: '1.5rem 0' }}>
          {/* Die Seiten kommen über die Einsichtsroute, nicht über die
              interne Bildroute: Dort gilt die Anmeldung, hier der Token --
              und nur hier wird das Wasserzeichen aufgetragen. */}
          <img
            src={`/api/einsicht/${token}/${dokument}/1`}
            alt="Beleg, Seite 1"
            style={{ border: '1px solid #ddd', width: '100%' }}
          />
        </figure>
      )}

      {gewaehrung.rechte.includes('download') ? (
        <p>
          <a href={`/api/einsicht/${token}/${dokument}/pdf`}>Original als PDF laden</a>
        </p>
      ) : (
        <p style={{ color: '#666', fontSize: '0.85rem' }}>
          Für diesen Zugang ist kein Download vorgesehen.
        </p>
      )}
    </main>
  )
}
