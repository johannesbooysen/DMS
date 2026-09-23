/**
 * Stufenübersicht — wo steht was.
 *
 * Amagnos Ordnerbaum mit Zählern, ohne Ordner: links jede Stufe mit der
 * Zahl der Belege darin, rechts die Belege der angeklickten Stufe. Wer aus
 * Amagno kommt, sucht diesen Blick am ersten Tag; die Postfächer zeigen nur,
 * was mich selbst betrifft.
 *
 * **Überfällig steht rot, und die älteste Fälligkeit steht dabei.** Ein
 * Zähler „12" sagt nichts; „12, davon 3 überfällig, die älteste seit dem
 * 2. September" sagt, wo jemand hinsehen muss.
 *
 * Die Zahlen laufen unter der RLS: Jeder sieht genau die Belege gezählt,
 * die er auch in der Liste öffnen kann (`stufenuebersicht`).
 */

import Link from 'next/link'
import { stufenpostfach, stufenuebersicht, type Postfachzeile } from '@/app/lib/postfach'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Ampel, belegBezeichnung, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const BELEGART: Record<string, string> = {
  rechnung: 'Rechnungen',
  schriftverkehr: 'Schriftverkehr',
}

function Belegliste({ zeilen }: { zeilen: Postfachzeile[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Beleg</th>
          <th>Objekt</th>
          <th style={{ textAlign: 'right' }}>Betrag</th>
          <th>Fällig</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => {
          const ueberfaellig = z.faelligAm !== null && new Date(z.faelligAm) < new Date()
          return (
            <tr key={z.aufgabeId}>
              <td>
                <Ampel wert={z.ampel} />
              </td>
              <td>
                <a href={`/aufgabe/${z.aufgabeId}`}>{belegBezeichnung(z)}</a>
              </td>
              <td>{z.objektnummer ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>{z.brutto === null ? '—' : euro.format(z.brutto)}</td>
              <td style={{ color: ueberfaellig ? 'var(--farbe-rot)' : undefined }}>
                {z.faelligAm === null ? '—' : datum.format(new Date(z.faelligAm))}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default async function Stufen({
  searchParams,
}: {
  searchParams: Promise<{ belegart?: string; stufe?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { belegart, stufe } = await searchParams

  const zaehler = await stufenuebersicht(benutzer)
  const gewaehlt =
    belegart !== undefined && stufe !== undefined
      ? zaehler.find((z) => z.belegart === belegart && z.stufe === stufe)
      : undefined
  const zeilen =
    gewaehlt === undefined ? [] : await stufenpostfach(benutzer, gewaehlt.belegart, gewaehlt.stufe)

  const belegarten = [...new Set(zaehler.map((z) => z.belegart))]
  const gesamt = zaehler.reduce((s, z) => s + z.offen, 0)
  const ueberfaellig = zaehler.reduce((s, z) => s + z.ueberfaellig, 0)

  return (
    <Seitenrahmen titel="Wo steht was">
      <div className="kennzahlen">
        <div className="kennzahl">
          <strong>{gesamt}</strong>
          <span>Belege unterwegs</span>
        </div>
        <div className="kennzahl">
          <strong style={{ color: ueberfaellig > 0 ? 'var(--farbe-rot)' : undefined }}>{ueberfaellig}</strong>
          <span>überfällig</span>
        </div>
      </div>

      <div className="zweispaltig">
        {/* Die Stufen -- der „Ordnerbaum". */}
        <nav aria-label="Stufen" className="stufenbaum">
          {belegarten.map((art) => (
            <section key={art} style={{ marginBottom: '1.5rem' }}>
              <h2>{BELEGART[art] ?? art}</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {zaehler
                  .filter((z) => z.belegart === art)
                  .map((z) => {
                    const aktiv = gewaehlt?.belegart === art && gewaehlt.stufe === z.stufe
                    return (
                      <li key={z.stufe}>
                        <Link
                          href={`/stufen?belegart=${encodeURIComponent(art)}&stufe=${encodeURIComponent(z.stufe)}`}
                          aria-current={aktiv ? 'page' : undefined}
                        >
                          <span>{z.stufe}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            <strong>{z.offen}</strong>
                            {z.ueberfaellig > 0 && (
                              <span style={{ color: 'var(--farbe-rot)', marginLeft: '0.4rem' }}>
                                {z.ueberfaellig} überfällig
                              </span>
                            )}
                          </span>
                        </Link>
                        {z.aeltesteFaelligkeit !== null && z.ueberfaellig > 0 && (
                          <div className="leise" style={{ fontSize: '0.75rem', padding: '0 0.5rem' }}>
                            älteste Fälligkeit {datum.format(new Date(z.aeltesteFaelligkeit))}
                          </div>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </section>
          ))}
        </nav>

        {/* Die Belege der gewählten Stufe -- der Klick auf den „Ordner". */}
        <section>
          {gewaehlt === undefined ? (
            <p className="leise">{gesamt === 0 ? '' : 'Eine Stufe links wählen, um ihre Belege zu sehen.'}</p>
          ) : (
            <>
              <h2>
                {gewaehlt.stufe}{' '}
                <span className="leise" style={{ fontWeight: 'normal' }}>
                  · {BELEGART[gewaehlt.belegart] ?? gewaehlt.belegart}
                </span>
              </h2>
              {zeilen.length === 0 ? (
                <p className="leise">Keine Belege in dieser Stufe.</p>
              ) : (
                <Belegliste zeilen={zeilen} />
              )}
            </>
          )}
        </section>
      </div>
    </Seitenrahmen>
  )
}
