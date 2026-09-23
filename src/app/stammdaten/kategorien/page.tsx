/**
 * Kategorien und ihre Steuerung — die Seite, auf der der Ablauf festgelegt wird.
 *
 * **Warum eine eigene Seite.** Die uebrigen Stammdaten stehen bewusst
 * beieinander, weil man sie bei der Ersteinrichtung zusammen braucht. Hier
 * gilt dieselbe Begruendung wie bei „Benutzer und Rollen": Eine der
 * Einstellungen verlangt ein **anderes Recht**. Wer bestimmt, welcher Ablauf
 * fuer eine Kategorie gilt, bestimmt mittelbar, wer entscheiden darf.
 *
 * **Warum Karten und keine Tabelle.** Vier Einstellungen je Kategorie, davon
 * zwei Auswahlfelder und eine Wortliste — als Tabelle waere die Zeile
 * breiter als jeder Bildschirm, und die eine Angabe, auf die es ankommt
 * („wer bearbeitet das"), stuende ganz rechts aussen.
 */

import Link from 'next/link'
import {
  auswahlenLaden,
  kategorienLaden,
  kreditorenMitStandard,
  rechtelageKategorien,
} from '@/stammdaten/kategorien'
import {
  kategorieAblaufAktion,
  kategorieZuordnungAktion,
  kreditorStandardAktion,
} from '@/app/lib/stammdaten-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Seitenrahmen } from '@/app/lib/darstellung'
import {
  Anlegen,
  Auswahl,
  Eingabe,
  Fehler,
  kopfzelle,
  NurLesend,
  tabelle,
  zelle,
} from '@/app/lib/stammdaten-teile'

export const dynamic = 'force-dynamic'

const HIER = '/stammdaten/kategorien'

export default async function Kategorien({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler } = await searchParams

  const [darf, kategorien, auswahlen, kreditoren] = await Promise.all([
    rechtelageKategorien(benutzer),
    kategorienLaden(benutzer),
    auswahlenLaden(benutzer),
    kreditorenMitStandard(benutzer),
  ])

  return (
    <Seitenrahmen titel="Kategorien und ihre Steuerung">
      <Fehler text={fehler} />

      <p className="einleitung">
        Eine Kategorie sagt an <strong>einer</strong> Stelle, was mit ihren Belegen
        geschieht: wer sie bearbeitet, welchen Ablauf sie nehmen und worauf sie
        gebucht werden. Es gibt keine Filter, die man nebeneinanderlegen muss, um
        das herauszufinden.
      </p>
      <p className="einleitung">
        Bedingungen wie <em>„ab 5.000 € zusätzlich die Geschäftsleitung“</em> gehören
        nicht hierher, sondern als Verzweigung in den{' '}
        <Link href="/konfiguration">Ablauf</Link> selbst — dort stehen sie an einer
        Stelle und lassen sich vor dem Aktivieren durchspielen.
      </p>

      {kategorien.length === 0 && (
        <p className="leise">
          Noch keine Kategorien. Sie werden unter{' '}
          <Link href="/stammdaten">Stammdaten</Link> angelegt.
        </p>
      )}

      {kategorien.map((k) => (
        <section
          key={k.id}
          style={{
            border: '1px solid var(--farbe-linie)',
            borderRadius: '0.3rem',
            marginBottom: '1.25rem',
            opacity: k.aktiv ? 1 : 0.6,
            padding: '1rem',
          }}
        >
          <h2>
            {k.name}{' '}
            <span className="leise winzig normal">
              {k.kurzcode}
              {k.aktiv ? '' : ' · deaktiviert'}
            </span>
          </h2>

          {/*
            Die Auskunft, für die man diese Seite öffnet, steht oben und nicht
            in einer Spalte: Wer bekommt diese Belege? Ohne Zuständigkeit
            landen sie bei niemandem — und das fällt sonst erst auf, wenn
            jemand eine Mahnung bekommt.
          */}
          <p style={{ fontSize: '0.875rem', margin: '0 0 0.9rem' }}>
            {k.bearbeiter.length > 0 ? (
              <>
                Bearbeitet von <strong>{k.bearbeiter.join(', ')}</strong>
              </>
            ) : k.spezialgebiet === null ? (
              <span className="leise">
                Kein Spezialgebiet — die Zuständigkeit ergibt sich aus dem Objekt.
              </span>
            ) : (
              <span className="rot">
                Für „{k.spezialgebiet}“ ist niemand zuständig — Belege dieser
                Kategorie erreichen kein Postfach.
              </span>
            )}
          </p>

          {darf.stammdaten ? (
            <Anlegen aktion={kategorieZuordnungAktion} zurueck={HIER} beschriftung="Speichern">
              <input type="hidden" name="id" value={k.id} />
              <Auswahl
                name="spezialgebiet"
                label="Wer bearbeitet (Spezialgebiet)"
                optionen={auswahlen.spezialgebiete}
                wert={k.spezialgebietId}
                leer="— aus dem Objekt —"
                breite="15rem"
              />
              <Auswahl
                name="konto"
                label="Kontovorschlag"
                optionen={auswahlen.konten}
                wert={k.kontoId}
                leer="— keiner —"
                breite="15rem"
              />
              <Eingabe
                name="schluesselwoerter"
                label="Schlüsselworte (durch Komma getrennt)"
                wert={k.schluesselwoerter.join(', ')}
                breite="20rem"
              />
            </Anlegen>
          ) : (
            <NurLesend was="die Zuordnung dieser Kategorie zu ändern" />
          )}

          {darf.prozess ? (
            <Anlegen
              aktion={kategorieAblaufAktion}
              zurueck={HIER}
              beschriftung="Ablauf festlegen"
            >
              <input type="hidden" name="id" value={k.id} />
              <Auswahl
                name="ablauf"
                label="Welcher Ablauf gilt"
                optionen={auswahlen.ablaeufe}
                wert={k.ablaufId}
                leer="— nach Belegart wie bisher —"
                breite="22rem"
              />
            </Anlegen>
          ) : (
            <p style={{ color: 'var(--farbe-text-leise)', fontSize: '0.8rem', marginTop: '0.75rem' }}>
              Ablauf: {k.ablauf ?? 'nach Belegart wie bisher'} — änderbar nur mit dem
              Recht, Abläufe zu konfigurieren.
            </p>
          )}
        </section>
      ))}

      <section style={{ marginTop: '2.5rem' }}>
        <h2>
          Übliche Kategorie je Lieferant
        </h2>
        <p style={{ color: 'var(--farbe-text-leise)', fontSize: '0.85rem', margin: '0 0 0.75rem', maxWidth: '46rem' }}>
          Die stärkste Quelle der automatischen Zuordnung: Was hier steht, schlägt
          jede Ableitung — es ist die Angabe eines Menschen. Ein Vorschlag bleibt
          es trotzdem; ein Versorger schickt auch einmal eine Reparaturrechnung,
          und die Kategorie am Beleg ist danach änderbar.
        </p>
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Lieferant</th>
              <th style={kopfzelle}>Übliche Kategorie</th>
              <th style={kopfzelle} />
            </tr>
          </thead>
          <tbody>
            {kreditoren.length === 0 && (
              <tr>
                <td style={zelle} colSpan={3}>
                  Noch keine Lieferanten erfasst.
                </td>
              </tr>
            )}
            {kreditoren.map((kr) => (
              <tr key={kr.id}>
                <td style={zelle}>{kr.name}</td>
                <td style={zelle}>{kr.standard ?? '—'}</td>
                <td style={zelle}>
                  {darf.stammdaten && (
                    <form action={kreditorStandardAktion} className="reihe">
                      <input type="hidden" name="zurueck" value={HIER} />
                      <input type="hidden" name="id" value={kr.id} />
                      <Auswahl
                        name="kategorie"
                        label={`Übliche Kategorie für ${kr.name}`}
                        labelVerbergen
                        optionen={auswahlen.kategorien}
                        wert={kr.standardId}
                        leer="— keine —"
                        breite="13rem"
                      />
                      <button
                        type="submit"
                        // Zwanzig Knöpfe mit dem Namen „setzen" sind für ein
                        // Vorleseprogramm zwanzigmal dasselbe.
                        aria-label={`Übliche Kategorie für ${kr.name} setzen`}
                        style={{
                          alignSelf: 'flex-end',
                          background: 'var(--farbe-flaeche)',
                          border: '1px solid var(--farbe-linie-stark)',
                          borderRadius: '0.2rem',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          padding: '0.3rem 0.6rem',
                        }}
                      >
                        setzen
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p style={{ fontSize: '0.85rem', marginTop: '2rem' }}>
        <Link href="/stammdaten">Zurück zu den Stammdaten</Link>
      </p>
    </Seitenrahmen>
  )
}
