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
import { Belegvorschau } from '@/app/lib/belegvorschau'
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

  /*
   * An der Kontierungsstufe wandert der abschliessende Stempel in die Maske,
   * direkt unter die Summe -- Eingabe und Stempel in einem Blick. Rechts
   * neben dem Beleg bleiben nur die Ausweichwege (Klaerung, Rueckgabe).
   * Zweimal derselbe Knopf waere eine Frage mehr ("welchen?"), nicht ein
   * Weg weniger.
   */
  const abschluss =
    maske === null ? null : (stempel.find((s) => s.entscheidung === 'freigabe') ?? null)
  const rechts = abschluss === null ? stempel : stempel.filter((s) => s !== abschluss)

  const brauchtKlaerungsfelder = rechts.some((s) => s.entscheidung === 'klaerung')
  const brauchtKommentar = rechts.some((s) => s.kommentarPflicht)

  return (
    <Seitenrahmen titel={zeile.stufe}>
      {fehler !== undefined && (
        <p role="alert" className="meldung-fehler">
          {fehler}
        </p>
      )}

      <p style={{ color: 'var(--farbe-text-leise)' }}>
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
        {' · '}
        {/* Die vier Saetze mit Grund stehen am Beleg, nicht hier: Wer
            entscheidet, braucht den Beleg -- wer sich wundert, warum er
            ihn bekommen hat, braucht die Erklaerung. */}
        <a href={`/beleg/${zeile.dokumentId}#warum`}>Warum bei mir?</a>
      </p>

      <Befunde befunde={befunde} />

      {maske !== null && (
        <Kontierung
          maske={maske}
          dokumentId={zeile.dokumentId}
          aufgabeId={zeile.aufgabeId}
          abschluss={abschluss}
        />
      )}

      {zahlung !== null && <Zahlung ansicht={zahlung} />}

      {/*
        **Der Beleg bekommt den Platz, die Entscheidung den Rest.**

        Vorher stand hier eine Miniatur von 240 Pixeln neben einer fast
        leeren Fläche -- auf dem Bildschirm, auf dem entschieden wird, ob
        eine Rechnung sachlich richtig ist. Wer sie nicht lesen kann, klickt
        entweder blind oder wechselt jedes Mal in die Belegansicht und
        zurück.

        `flexWrap` statt fester Spalten: Auf einem schmalen Bildschirm
        rutscht die Entscheidung unter den Beleg, statt beide zu quetschen.
      */}
      <div
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1.5rem',
        }}
      >
        <div style={{ flex: '3 1 24rem', minWidth: 0 }}>
          <Belegvorschau dokumentId={zeile.dokumentId} />
        </div>

        <div style={{ flex: '2 1 20rem', minWidth: 0 }}>
          {rechts.length === 0 ? (
            <p style={{ color: 'var(--farbe-text-leise)' }}>
              {abschluss === null
                ? 'An dieser Stufe stehen Ihnen keine Stempel zu. Die Aufgabe bleibt offen.'
                : 'Der Stempel steht oben bei der Kontierung.'}
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
                {rechts.map((s) => (
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
