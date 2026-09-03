/**
 * Eine Aufgabe bearbeiten.
 *
 * Das ist der Bildschirm aus Konzept 8.7: Beleg links, zwei oder drei
 * Schaltflaechen darunter. Keine Stempelgalerie, kein Zielfeld, keine
 * Moeglichkeit, den Beleg an die falsche Station zu schicken -- wohin er
 * geht, leitet die Engine ab.
 */

import { notFound } from 'next/navigation'
import { stempelnAktion } from '@/app/lib/aktionen'
import { befundeLaden } from '@/app/lib/belege'
import { kontierungsmaskeLaden } from '@/app/lib/kontierung-daten'
import { Kontierung } from '@/app/lib/kontierungsmaske'
import { aufgabeLaden } from '@/app/lib/postfach'
import { zahlungsansichtLaden } from '@/app/lib/zahlung-daten'
import { Zahlung } from '@/app/lib/zahlungsansicht'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Ampel, Befunde, belegBezeichnung, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

export default async function Aufgabenansicht({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fehler?: string }>
}) {
  const { id } = await params
  const { fehler } = await searchParams

  const geladen = await aufgabeLaden(await angemeldeterBenutzer(), id)
  if (geladen === null) return notFound()
  const { zeile, stempel } = geladen
  const befunde = await befundeLaden(await angemeldeterBenutzer(), zeile.dokumentId)

  // Die Maske erscheint nur an der Kontierungsstufe. Anderswo waere sie kein
  // Angebot, sondern eine Ablenkung -- wer freigibt, kontiert nicht.
  const maske =
    zeile.stufentyp === 'kontierung'
      ? await kontierungsmaskeLaden(await angemeldeterBenutzer(), zeile.dokumentId)
      : null

  // Dasselbe fuer die Zahlungsstufe: Der Stempel dort weist Geld an, also
  // steht vorher auf dem Bildschirm, was passieren wird.
  const zahlung =
    zeile.stufentyp === 'zahlung'
      ? await zahlungsansichtLaden(await angemeldeterBenutzer(), zeile.dokumentId)
      : null

  const brauchtKlaerungsfelder = stempel.some((s) => s.entscheidung === 'klaerung')
  const brauchtKommentar = stempel.some((s) => s.kommentarPflicht)

  return (
    <Seitenrahmen titel={zeile.stufe}>
      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      <p style={{ color: '#555' }}>
        <Ampel wert={zeile.ampel} />{' '}
        {[
          // Ueber den gemeinsamen Helfer -- die fuenfte Anzeigestelle. Ein
          // Schriftstueck hat weder Kreditor noch Rechnungsnummer, und
          // "Ohne Kreditor" waere hier die letzte Auskunft vor dem Stempeln.
          belegBezeichnung(zeile),
          zeile.objektnummer !== null && `Objekt ${zeile.objektnummer}`,
          zeile.ordnungsgruppe,
          zeile.brutto !== null && euro.format(zeile.brutto),
          zeile.faelligAm !== null && `fällig ${datum.format(new Date(zeile.faelligAm))}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <Befunde befunde={befunde} />

      {maske !== null && (
        <Kontierung maske={maske} dokumentId={zeile.dokumentId} aufgabeId={zeile.aufgabeId} />
      )}

      {zahlung !== null && <Zahlung ansicht={zahlung} />}

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        <a href={`/beleg/${zeile.dokumentId}`} style={{ flexShrink: 0 }}>
          {/* Die Miniatur liegt fertig vor -- sie kostet nichts. */}
          <img
            src={`/api/beleg/${zeile.dokumentId}/seite/1?groesse=miniatur`}
            alt="Erste Seite"
            style={{ border: '1px solid #ddd', width: '240px' }}
          />
        </a>

        <div style={{ flex: 1 }}>
          {stempel.length === 0 ? (
            <p style={{ color: '#666' }}>
              An dieser Stufe stehen Ihnen keine Stempel zu. Die Aufgabe bleibt offen.
            </p>
          ) : (
            <form action={stempelnAktion}>
              <input type="hidden" name="aufgabeId" value={zeile.aufgabeId} />

              {(brauchtKommentar || brauchtKlaerungsfelder) && (
                <p>
                  <label htmlFor="kommentar" style={{ display: 'block' }}>
                    Kommentar
                  </label>
                  <textarea id="kommentar" name="kommentar" rows={3} style={{ width: '100%' }} />
                </p>
              )}

              {brauchtKlaerungsfelder && (
                <p>
                  <label htmlFor="wiedervorlageAm" style={{ display: 'block' }}>
                    Wiedervorlage (nur bei Klärung, dann Pflicht)
                  </label>
                  <input id="wiedervorlageAm" name="wiedervorlageAm" type="date" />
                </p>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                {stempel.map((s) => (
                  <button
                    key={s.stempeltypId}
                    type="submit"
                    name="stempeltypId"
                    value={s.stempeltypId}
                    style={{
                      background: s.farbe ?? '#333',
                      border: 0,
                      borderRadius: '0.25rem',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      padding: '0.6rem 1rem',
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </form>
          )}
        </div>
      </div>
    </Seitenrahmen>
  )
}
