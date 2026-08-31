/**
 * Belegtrennung prüfen und korrigieren.
 *
 * Die Korrekturoberfläche aus Konzept 24.1. Sie ist kein Zugeständnis an eine
 * schwache Erkennung, sondern Teil des Entwurfs: **Keine automatische
 * Trennung ist fehlerfrei**, und ein falsch getrennter Stapel erzeugt zwanzig
 * falsche Belege auf einmal.
 *
 * Gezeigt werden alle Seiten als Miniaturen, gruppiert nach Beleg. An jeder
 * Seite steht eine Schaltfläche „hier trennen" beziehungsweise „Trennung
 * aufheben" — mehr braucht es nicht, weil sich jede Aufteilung aus den
 * Trennstellen ergibt.
 */

import { notFound } from 'next/navigation'
import { stapelLaden } from '@/stapel'
import {
  stapelUebernehmenAktion,
  stapelVerwerfenAktion,
  trennungAendernAktion,
} from '@/app/lib/posteingang-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { datum, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

export default async function Stapelpruefung({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fehler?: string }>
}) {
  const { id } = await params
  const { fehler } = await searchParams

  const geladen = await stapelLaden(await angemeldeterBenutzer(), id)
  if (geladen === null) return notFound()
  const { kopf, seiten } = geladen

  // Die Gruppierung ergibt sich aus den Seiten -- sie wird hier nur
  // dargestellt, nicht gerechnet. Gerechnet hat sie `app.stapel_gruppieren`.
  const belege = new Map<number, typeof seiten>()
  for (const s of seiten) {
    if (s.belegNr === null) continue
    belege.set(s.belegNr, [...(belege.get(s.belegNr) ?? []), s])
  }

  const uebernommen = kopf.status === 'uebernommen'

  return (
    <Seitenrahmen titel={`Belegtrennung — ${kopf.dateiname}`}>
      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      <p style={{ color: '#555' }}>
        {kopf.seitenzahl} Seiten · {kopf.belege}{' '}
        {kopf.belege === 1 ? 'erkannter Beleg' : 'erkannte Belege'} · Eingang{' '}
        {datum.format(new Date(kopf.eingangAm))}
        {uebernommen && ' · übernommen'}
      </p>

      {kopf.status === 'aufbereitung' ? (
        <p style={{ background: '#FDF3E3', color: '#6B4A15', padding: '0.75rem' }}>
          Der Stapel wird gerade gelesen und gerendert — das übernimmt der
          Worker, nicht diese Seite. Bitte in einem Moment neu laden.
        </p>
      ) : uebernommen ? (
        <p style={{ background: '#EEF3EE', color: '#2F6F4E', padding: '0.75rem' }}>
          Dieser Stapel ist übernommen. Die Belege stehen unter{' '}
          <a href="/belege">Belege</a>; Änderungen laufen ab hier über den
          einzelnen Beleg.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: '0.8rem', margin: '1rem 0' }}>
          <form action={stapelUebernehmenAktion}>
            <input type="hidden" name="stapelId" value={id} />
            <button
              type="submit"
              style={{
                background: '#2F6F4E',
                border: 0,
                borderRadius: '0.25rem',
                color: '#fff',
                cursor: 'pointer',
                padding: '0.5rem 1rem',
              }}
            >
              {kopf.belege === 1
                ? 'Als einen Beleg übernehmen'
                : `${kopf.belege} Belege übernehmen`}
            </button>
          </form>

          <form action={stapelVerwerfenAktion} style={{ display: 'flex', gap: '0.4rem' }}>
            <input type="hidden" name="stapelId" value={id} />
            <input
              name="grund"
              placeholder="Grund für das Verwerfen"
              required
              style={{ padding: '0.4rem', width: '16rem' }}
            />
            <button type="submit" style={{ cursor: 'pointer', padding: '0.45rem 0.8rem' }}>
              verwerfen
            </button>
          </form>
        </div>
      )}

      {[...belege.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([nr, gruppe]) => (
          <section key={nr} style={{ margin: '1.2rem 0' }}>
            <h2 style={{ fontSize: '0.95rem' }}>
              Beleg {nr}{' '}
              <span style={{ color: '#666', fontWeight: 400 }}>
                — Seite{gruppe.length === 1 ? '' : 'n'}{' '}
                {gruppe.map((s) => s.seite).join(', ')}
              </span>
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
              {gruppe.map((s) => (
                <Seitenkachel key={s.seite} stapelId={id} seite={s} gesperrt={uebernommen} />
              ))}
            </div>
          </section>
        ))}

      {seiten.some((s) => s.trenner) && (
        <section style={{ margin: '1.2rem 0' }}>
          <h2 style={{ fontSize: '0.95rem', color: '#666' }}>Trennblätter</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
            {seiten
              .filter((s) => s.trenner)
              .map((s) => (
                <Seitenkachel key={s.seite} stapelId={id} seite={s} gesperrt={uebernommen} />
              ))}
          </div>
        </section>
      )}
    </Seitenrahmen>
  )
}

function Seitenkachel({
  stapelId,
  seite,
  gesperrt,
}: {
  stapelId: string
  seite: { seite: number; trenner: boolean; quelle: string; auszug: string }
  gesperrt: boolean
}) {
  return (
    <figure style={{ margin: 0, width: '150px' }}>
      <img
        src={`/api/stapel/${stapelId}/seite/${seite.seite}`}
        alt={`Seite ${seite.seite}`}
        style={{
          border: seite.trenner ? '2px solid #B5741A' : '1px solid #ddd',
          width: '100%',
        }}
      />
      <figcaption style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
        Seite {seite.seite}
        {seite.quelle === 'mensch' && (
          <span style={{ color: '#666' }}> · von Hand</span>
        )}
        {!gesperrt && (
          <form action={trennungAendernAktion}>
            <input type="hidden" name="stapelId" value={stapelId} />
            <input type="hidden" name="seite" value={seite.seite} />
            <input type="hidden" name="trenner" value={seite.trenner ? 'nein' : 'ja'} />
            <button
              type="submit"
              style={{
                background: 'none',
                border: 0,
                color: seite.trenner ? '#B3271E' : '#3B4A80',
                cursor: 'pointer',
                padding: '0.15rem 0',
              }}
            >
              {seite.trenner ? 'Trennung aufheben' : 'hier trennen'}
            </button>
          </form>
        )}
      </figcaption>
    </figure>
  )
}
