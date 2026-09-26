/**
 * Eine Aufgabe am Arbeitsplatz: der Beleg in der Mitte, die Entscheidung
 * rechts. Die Liste links kommt aus dem Layout.
 *
 * Fachlich dasselbe wie /aufgabe/[id] -- dieselben Lader, dieselben
 * Aktionen, dieselbe Regel: Der Stempel traegt die Entscheidung, nicht das
 * Ziel (Konzept 8). Was sich unterscheidet, ist die Anordnung und wohin es
 * nach dem Stempel geht: zur naechsten Aufgabe, nicht ins Postfach.
 */

import { notFound } from 'next/navigation'
import { stempelnAktion } from '@/app/lib/aktionen'
import { Belegbetrachter } from '@/app/lib/belegbetrachter'
import { befundeLaden } from '@/app/lib/belege'
import { belegkopfLaden } from '@/app/lib/belege'
import { Ampel, Befunde, belegBezeichnung, datum, euro } from '@/app/lib/darstellung'
import { kontierungsmaskeLaden } from '@/app/lib/kontierung-daten'
import { Kontierung } from '@/app/lib/kontierungsmaske'
import { aufgabeLaden } from '@/app/lib/postfach'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Nachtragsformular } from '@/app/lib/nachtragsformular'
import { KreditorVorschlagKarte } from '@/app/lib/kreditor-vorschlag'
import { vorschlagZumBeleg } from '@/stammdaten/kreditor-vorschlag'
import { rechtelage } from '@/stammdaten'
import { fehlendePflichtfelder, nachtragNoetig, nachtragsauswahl } from '@/belege/nachtragen'
import { extraktionEingerichtet } from '@/extraktion/einstellung'
import { pflichtfelderLaden } from '@/stammdaten/pflichtfeld'
import { rechnungsdatenLaden } from '@/belege/rechnungsdaten'
import { Rechnungsdaten } from '@/app/lib/rechnungsdaten'
import { zahlungsansichtLaden } from '@/app/lib/zahlung-daten'
import { Zahlung } from '@/app/lib/zahlungsansicht'

export const dynamic = 'force-dynamic'

export default async function Aufgabe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fehler?: string; hinweis?: string }>
}) {
  const { id } = await params
  const { fehler, hinweis } = await searchParams
  const benutzer = await angemeldeterBenutzer()

  const geladen = await aufgabeLaden(benutzer, id)
  if (geladen === null) return notFound()
  const { zeile, stempel } = geladen

  const [kopf, befunde, maske, zahlung, rechnungsdaten] = await Promise.all([
    belegkopfLaden(benutzer, zeile.dokumentId),
    befundeLaden(benutzer, zeile.dokumentId),
    zeile.stufentyp === 'kontierung' ? kontierungsmaskeLaden(benutzer, zeile.dokumentId) : null,
    zeile.stufentyp === 'zahlung' ? zahlungsansichtLaden(benutzer, zeile.dokumentId) : null,
    rechnungsdatenLaden(benutzer, zeile.dokumentId),
  ])
  const vorschlag = await vorschlagZumBeleg(benutzer, zeile.dokumentId)

  // Dieselbe Aufteilung wie auf der Aufgabenseite: An der Kontierungsstufe
  // steht der abschliessende Stempel in der Maske, rechts bleiben die
  // Ausweichwege.
  const abschluss =
    maske === null ? null : (stempel.find((s) => s.entscheidung === 'freigabe') ?? null)
  const knoepfe = abschluss === null ? stempel : stempel.filter((s) => s !== abschluss)
  const brauchtKlaerungsfelder = knoepfe.some((s) => s.entscheidung === 'klaerung')
  const brauchtKommentar = knoepfe.some((s) => s.kommentarPflicht)

  return (
    <>
      <section className="arbeitsplatz-beleg" aria-label="Beleg">
        <Belegbetrachter
          benutzer={benutzer}
          dokumentId={zeile.dokumentId}
          seitenzahl={kopf?.seitenzahl ?? 0}
        />
      </section>

      <aside className="arbeitsplatz-entscheidung" aria-label="Entscheidung">
        <h2>{zeile.stufe}</h2>
        <div className="belegkopf">
          <Ampel wert={zeile.ampel} /> {belegBezeichnung(zeile)}
          <dl>
            {zeile.objektnummer !== null && (
              <>
                <dt>Objekt</dt>
                <dd>{zeile.objektnummer}</dd>
              </>
            )}
            {zeile.ordnungsgruppe !== null && (
              <>
                <dt>Gruppe</dt>
                <dd>{zeile.ordnungsgruppe}</dd>
              </>
            )}
            {zeile.brutto !== null && (
              <>
                <dt>Betrag</dt>
                <dd>{euro.format(zeile.brutto)}</dd>
              </>
            )}
            {zeile.faelligAm !== null && (
              <>
                <dt>Fällig</dt>
                <dd>{datum.format(new Date(zeile.faelligAm))}</dd>
              </>
            )}
            {kopf !== null && (
              <>
                <dt>Eingang</dt>
                <dd>{datum.format(new Date(kopf.eingangAm))}</dd>
              </>
            )}
          </dl>
          <p style={{ margin: '0.5rem 0 0' }}>
            <a href={`/beleg/${zeile.dokumentId}#warum`}>Warum bei mir?</a>
          </p>
        </div>

        {fehler !== undefined && (
          <p role="alert" className="meldung-fehler">
            {fehler}
          </p>
        )}
        {hinweis !== undefined && (
          <p role="status" className="meldung-hinweis">
            {hinweis}
          </p>
        )}

        {/* Die manuelle Zuordnung (Konzept 13): Fehlt Objekt oder Kreditor,
            steht das Formular vor der Entscheidung -- ohne Objekt hat die
            Aufgabe niemanden, und ohne Kreditor gibt es keine Freigabe. */}
        {/* Ein Rechnungssteller, den es als Kreditor nicht gibt: vorschlagen,
            nicht anlegen -- die Freigabe ist die Handlung eines Menschen. */}
        {vorschlag !== null && (
          <KreditorVorschlagKarte
            vorschlag={vorschlag}
            kreditoren={(await nachtragsauswahl(benutzer)).kreditoren}
            darf={(await rechtelage(benutzer)).stammdaten}
            zurueck={`/arbeitsplatz/${zeile.aufgabeId}`}
          />
        )}

        {nachtragNoetig({ objektnummer: zeile.objektnummer, kreditor: zeile.kreditor, belegart: kopf?.belegart ?? null }) && (
          <Nachtragsformular
            dokumentId={zeile.dokumentId}
            aufgabeId={zeile.aufgabeId}
            auswahl={await nachtragsauswahl(benutzer)}
            belegart={kopf?.belegart ?? 'rechnung'}
            ohneObjekt={zeile.objektnummer === null}
            pflicht={await pflichtfelderLaden(benutzer, kopf?.belegart ?? 'rechnung')}
            fehlt={await fehlendePflichtfelder(benutzer, zeile.dokumentId)}
            extraktion={extraktionEingerichtet()}
          />
        )}

        {/* Was erkannt wurde, mit Vertrauen -- die Grundlage der sachlichen Pruefung. */}
        {rechnungsdaten !== null && <Rechnungsdaten daten={rechnungsdaten} kompakt />}

        <Befunde befunde={befunde} />

        {maske !== null && (
          <Kontierung
            maske={maske}
            dokumentId={zeile.dokumentId}
            aufgabeId={zeile.aufgabeId}
            abschluss={abschluss}
            herkunft="arbeitsplatz"
          />
        )}

        {zahlung !== null && <Zahlung ansicht={zahlung} />}

        <h3>Entscheidung</h3>
        {knoepfe.length === 0 ? (
          <p className="leise klein">
            {abschluss === null
              ? 'An dieser Stufe stehen Ihnen keine Stempel zu. Die Aufgabe bleibt offen.'
              : 'Der Stempel steht oben bei der Kontierung.'}
          </p>
        ) : (
          <form action={stempelnAktion}>
            <input type="hidden" name="aufgabeId" value={zeile.aufgabeId} />
            <input type="hidden" name="herkunft" value="arbeitsplatz" />

            {(brauchtKommentar || brauchtKlaerungsfelder) && (
              <label className="entscheidung-feld">
                Kommentar
                <textarea name="kommentar" rows={3} />
              </label>
            )}

            {brauchtKlaerungsfelder && (
              <label className="entscheidung-feld">
                Wiedervorlage (nur bei Klärung, dann Pflicht)
                <input name="wiedervorlageAm" type="date" />
              </label>
            )}

            <div className="stempelknoepfe">
              {knoepfe.map((s) => (
                <button
                  key={s.stempeltypId}
                  type="submit"
                  name="stempeltypId"
                  value={s.stempeltypId}
                  style={{ background: s.farbe ?? '#333' }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </form>
        )}
      </aside>
    </>
  )
}
