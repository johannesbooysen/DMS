/**
 * Belegansicht: Seitenleiste, Beleg, Angaben -- nebeneinander.
 *
 * Die erste Seite kommt als fertiges Bild aus der Ablage. Kein Rendern beim
 * Oeffnen, kein PDF im Hintergrund -- das PDF holt der Browser erst, wenn
 * jemand es ausdruecklich anfordert (Konzept 23).
 *
 * Dieselbe Dreiteilung wie am Arbeitsplatz, nur mit anderem Inhalt: links
 * die Seiten als Miniaturen zum Anspringen, in der Mitte der Beleg mit
 * allen Layern (hier auch anfassbar, ADR 0008), rechts alles, was man ueber
 * den Beleg wissen will -- Kopf, Archivstand, Pruefhinweise, warum er hier
 * ist, Suche im Text, Notizen, Ausgabe.
 */

import { notFound } from 'next/navigation'
import { Belegbetrachter } from '@/app/lib/belegbetrachter'
import { befundeLaden, belegkopfLaden, seitentextLaden } from '@/app/lib/belege'
import { Befunde, belegBezeichnung, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'
import { Layerformular } from '@/app/lib/layerschicht'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Warten } from '@/app/lib/wartenmaske'
import { archivstandLaden } from '@/archiv'
import { belegwegLaden } from '@/belege/belegweg'
import { Belegweg } from '@/app/lib/belegweg'
import { zuordnungErklaeren } from '@/belege/erklaerung'
import { alsBenutzer } from '@/db'
import { gewaehrleistungOffen, wartenZumBeleg } from '@/nebenlauf'

export const dynamic = 'force-dynamic'

/**
 * Suche im Seitentext -- je Seite die Fundstellen mit einem Auszug.
 *
 * Gesucht wird im Text, den die Aufbereitung aus dem PDF gewonnen hat; die
 * Ansicht selbst ist ein Bild. Markiert wird deshalb die **Seite**, nicht
 * die Stelle im Bild: Der Worker speichert Zeilenkaesten ohne ihren Text
 * (rund ein Zehntel der Groesse, siehe `textkaesten`), also weiss niemand,
 * in welcher Zeile das Wort steht. Der Auszug rechts und die Marke an der
 * Seite sagen, wo man hinsehen muss -- und das ist die Frage, die jemand
 * mit einem Suchwort stellt.
 */
function suchen(
  seiten: Array<{ seite: number; text: string }>,
  begriff: string,
): Array<{ seite: number; anzahl: number; vorher: string; wort: string; nachher: string }> {
  const gesucht = begriff.trim().toLowerCase()
  if (gesucht.length < 2) return []
  const treffer: Array<{ seite: number; anzahl: number; vorher: string; wort: string; nachher: string }> = []
  for (const s of seiten) {
    const text = s.text.replace(/\s+/g, ' ')
    const klein = text.toLowerCase()
    let anzahl = 0
    let stelle = klein.indexOf(gesucht)
    const erste = stelle
    while (stelle >= 0) {
      anzahl += 1
      stelle = klein.indexOf(gesucht, stelle + gesucht.length)
    }
    if (anzahl === 0) continue
    const von = Math.max(0, erste - 60)
    const bis = Math.min(text.length, erste + gesucht.length + 60)
    treffer.push({
      seite: s.seite,
      anzahl,
      vorher: `${von > 0 ? '…' : ''}${text.slice(von, erste)}`,
      wort: text.slice(erste, erste + gesucht.length),
      nachher: `${text.slice(erste + gesucht.length, bis)}${bis < text.length ? '…' : ''}`,
    })
  }
  return treffer
}

export default async function Belegansicht({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ suche?: string }>
}) {
  const { id } = await params
  const { suche = '' } = await searchParams
  const benutzer = await angemeldeterBenutzer()

  const kopf = await belegkopfLaden(benutzer, id)
  // return, damit der Typ danach eng ist: notFound() wird ueber
  // next/navigation nicht als "never" weitergereicht.
  if (kopf === null) return notFound()

  const [seiten, befunde, archiv, erklaerung, warten, weg] = await Promise.all([
    seitentextLaden(benutzer, id),
    befundeLaden(benutzer, id),
    alsBenutzer(benutzer, (c) => archivstandLaden(c, id)),
    zuordnungErklaeren(benutzer, id),
    alsBenutzer(benutzer, (c) => wartenZumBeleg(c, id)),
    belegwegLaden(benutzer, id),
  ])
  // Der Vorschlag bei einer Reparatur: Welche Bauteile standen zum
  // Belegdatum noch unter Gewaehrleistung? (Konzept 10.2)
  const gewaehrleistung =
    kopf.objektnummer === null || kopf.objektId === null
      ? []
      : await gewaehrleistungOffen(benutzer, kopf.objektId)
  const seitenzahl = kopf.seitenzahl ?? seiten.length
  const treffer = suchen(seiten, suche)
  const trefferSeiten = treffer.map((t) => t.seite)

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
    <Seitenrahmen titel={titel} breit>
      <div className="belegansicht">
        {/* Die Seiten als Miniaturen. Dasselbe Bild wie im Stapel, nur
            klein: Es ist ohnehin geladen, eine zweite Datei je Seite waere
            Speicher fuer nichts. `alt=""`, damit nur der Stapel "Seite 1"
            heisst -- ein Vorleseprogramm soll jede Seite einmal hoeren. */}
        <nav aria-label="Seiten" className="seitenrail">
          {seitenzahl === 0 ? (
            <p style={{ fontSize: '0.75rem', textAlign: 'center' }}>keine Seiten</p>
          ) : (
            Array.from({ length: seitenzahl }, (_, i) => i + 1).map((nr) => (
              <a key={nr} href={`#seite-${nr}`} aria-label={`Zu Seite ${nr}`}>
                <img src={`/api/beleg/${id}/seite/${nr}`} alt="" loading="lazy" />
                {nr}
                {trefferSeiten.includes(nr) && <span className="seitenrail-marke">{treffer.find((t) => t.seite === nr)?.anzahl}</span>}
              </a>
            ))
          )}
        </nav>

        <section className="spalte-beleg" aria-label="Beleg">
          <Belegbetrachter
            benutzer={benutzer}
            dokumentId={id}
            seitenzahl={seitenzahl}
            bearbeitbar
            treffer={trefferSeiten}
            verweis={false}
          />
        </section>

        <aside className="spalte-angaben" aria-label="Angaben zum Beleg">
          <h2>Beleg</h2>
          <dl>
            {kopf.objektnummer !== null && (
              <>
                <dt>Objekt</dt>
                <dd>{kopf.objektnummer}</dd>
              </>
            )}
            {kopf.ordnungsgruppe !== null && (
              <>
                <dt>Gruppe</dt>
                <dd>{kopf.ordnungsgruppe}</dd>
              </>
            )}
            {kopf.brutto !== null && (
              <>
                <dt>Betrag</dt>
                <dd>{euro.format(kopf.brutto)}</dd>
              </>
            )}
            <dt>Eingang</dt>
            <dd>{datum.format(new Date(kopf.eingangAm))}</dd>
            <dt>Umfang</dt>
            <dd>
              {seitenzahl} Seite{seitenzahl === 1 ? '' : 'n'}
            </dd>
          </dl>

          {archiv !== null && (
            <p className="hinweis">
              <strong>Archiviert</strong>
              {archiv.archiviertAm !== null && ` am ${datum.format(new Date(archiv.archiviertAm))}`}
              . Aufbewahrung bis{' '}
              {archiv.aufbewahrungBis === null ? '—' : datum.format(new Date(archiv.aufbewahrungBis))}
              {archiv.aufbewahrungsgrund !== null && ` (${archiv.aufbewahrungsgrund})`}. Änderungen
              laufen ab hier über Storno und Neuerfassung.
              {archiv.loeschsperre && ' Eine Löschsperre steht.'}
            </p>
          )}

          <Befunde befunde={befunde} />

          {/* Der Weg dieses Belegs als Grafik -- Stufen, Zustaende, Stempel. */}
          {weg !== null && <Belegweg weg={weg} />}

          {/*
            Warum ist dieser Beleg hier? Vier Saetze mit Grund -- die Auskunft,
            fuer die man im abzuloesenden System alle Magneten gleichzeitig
            lesen muss. Objekt und Kategorie stehen mit dem Grund, der im
            Moment der Zuordnung aufgeschrieben wurde; Ablauf und Bearbeiter
            mit dem, der heute gilt.
          */}
          {erklaerung !== null && (
            <section id="warum" aria-labelledby="warum-titel">
              <h2 id="warum-titel">Warum hier</h2>
              <dl>
                {(
                  [
                    ['Belegart', erklaerung.belegart],
                    ['Objekt', erklaerung.objekt],
                    ['Kategorie', erklaerung.kategorie],
                    ['Ablauf', erklaerung.ablauf],
                    ['Stufe', erklaerung.stufe],
                  ] as const
                ).map(([name, zeile]) => (
                  <div key={name} style={{ display: 'contents' }}>
                    <dt>{name}</dt>
                    <dd>
                      {zeile === null ? (
                        <span className="leise">—</span>
                      ) : (
                        <>
                          <strong>{zeile.was}</strong>
                          <span className="leise"> — {zeile.warum}</span>
                          {'personen' in zeile && zeile.personen.length > 0 && (
                            <span className="leise">
                              {' '}
                              Das können: {zeile.personen.join(', ')}.
                            </span>
                          )}
                          {'personen' in zeile && zeile.personen.length === 0 && (
                            <span className="rot"> Niemand kann das derzeit.</span>
                          )}
                        </>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {gewaehrleistung.length > 0 && (
            <section className="hinweis hinweis--warnung">
              <strong>Gewährleistung offen</strong> — an diesem Objekt stehen{' '}
              {gewaehrleistung.length === 1 ? 'ein Bauteil' : `${gewaehrleistung.length} Bauteile`}{' '}
              noch unter Gewährleistung:{' '}
              {gewaehrleistung.map((b) => `${b.bezeichnung} (bis ${b.gewaehrleistungBis})`).join(', ')}.
              Bei einer Reparaturrechnung ist zu prüfen, ob sie zulasten des Lieferanten geht.
            </section>
          )}

          <Warten container={warten} dokumentId={id} />

          {seitenzahl > 0 && (
            <section aria-labelledby="suche-titel">
              <h2 id="suche-titel">Im Beleg suchen</h2>
              {/* Ein GET-Formular: Das Suchwort steht in der Adresse, die
                  Seite rendert die Treffer -- kein Zustand im Browser, und
                  ein Verweis auf die Suche laesst sich weitergeben. */}
              <form method="get" className="suchfeld">
                <input
                  type="search"
                  name="suche"
                  defaultValue={suche}
                  placeholder="Wort im Belegtext"
                  aria-label="Suchwort"
                />
                <button type="submit">Suchen</button>
              </form>
              {suche.trim().length >= 2 && (
                <ul className="suchtreffer" aria-label="Treffer">
                  {treffer.length === 0 ? (
                    <li className="leise">Nichts gefunden.</li>
                  ) : (
                    treffer.map((t) => (
                      <li key={t.seite}>
                        <a href={`#seite-${t.seite}`}>
                          Seite {t.seite}
                          {t.anzahl > 1 && ` (${t.anzahl}×)`}
                        </a>
                        <div style={{ color: 'var(--farbe-text-leise)', fontSize: '0.82rem' }}>
                          {t.vorher}
                          <mark>{t.wort}</mark>
                          {t.nachher}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>
          )}

          {seitenzahl > 0 && (
            <section>
              <h2>Notizen und Schwärzungen</h2>
              <p style={{ color: 'var(--farbe-text-leise)', fontSize: '0.82rem', margin: '0 0 0.5rem' }}>
                Vorhandene Notizen stehen unter der jeweiligen Seite.
              </p>
              <Layerformular dokumentId={id} seiten={Array.from({ length: seitenzahl }, (_, i) => i + 1)} />
            </section>
          )}

          <section className="ausgabe">
            <h2>Ausgabe</h2>
            <a href={`/api/beleg/${id}/pdf`}>Original-PDF öffnen</a>
            {/* Die vier Varianten aus Konzept 16. Das Archivoriginal steht
                schon oben -- hier die drei, die Layer tragen. */}
            {(
              [
                ['stempel', 'Beleg mit Stempeln'],
                ['extern', 'Belegeinsicht'],
                ['intern', 'interne Akte'],
              ] as const
            ).map(([variante, name]) => (
              <a key={variante} href={`/api/beleg/${id}/export?variante=${variante}`}>
                {name}
              </a>
            ))}
            <p style={{ color: 'var(--farbe-text-leise)', fontSize: '0.78rem', margin: '0.5rem 0 0' }}>
              Ist der Beleg geschwärzt, entstehen diese Ausgaben aus den Seitenbildern — dann ist das
              Geschwärzte wirklich weg, dafür der Text nicht mehr durchsuchbar. Das Archivoriginal
              bleibt in jedem Fall unverändert.
            </p>
          </section>
        </aside>
      </div>
    </Seitenrahmen>
  )
}
