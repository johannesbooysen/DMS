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
    <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', width: '100%' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
          <th style={{ padding: '0.4rem 0.5rem' }}></th>
          <th style={{ padding: '0.4rem 0.5rem' }}>Beleg</th>
          <th style={{ padding: '0.4rem 0.5rem' }}>Objekt</th>
          <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Betrag</th>
          <th style={{ padding: '0.4rem 0.5rem' }}>Fällig</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => {
          const ueberfaellig = z.faelligAm !== null && new Date(z.faelligAm) < new Date()
          return (
            <tr key={z.aufgabeId} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.4rem 0.5rem' }}>
                <Ampel wert={z.ampel} />
              </td>
              <td style={{ padding: '0.4rem 0.5rem' }}>
                <a href={`/aufgabe/${z.aufgabeId}`}>{belegBezeichnung(z)}</a>
              </td>
              <td style={{ padding: '0.4rem 0.5rem' }}>{z.objektnummer ?? '—'}</td>
              <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                {z.brutto === null ? '—' : euro.format(z.brutto)}
              </td>
              <td style={{ color: ueberfaellig ? '#A33' : undefined, padding: '0.4rem 0.5rem' }}>
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
      <p style={{ color: '#444', margin: '0 0 1.25rem' }}>
        {gesamt === 0
          ? 'Kein Beleg ist gerade unterwegs.'
          : `${gesamt} Belege unterwegs` +
            (ueberfaellig > 0 ? `, davon ${ueberfaellig} überfällig.` : '.')}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
        {/* Die Stufen -- der „Ordnerbaum". */}
        <nav aria-label="Stufen" style={{ flex: '1 1 18rem', minWidth: 0 }}>
          {belegarten.map((art) => (
            <section key={art} style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.4rem' }}>
                {BELEGART[art] ?? art}
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {zaehler
                  .filter((z) => z.belegart === art)
                  .map((z) => {
                    const aktiv = gewaehlt?.belegart === art && gewaehlt.stufe === z.stufe
                    return (
                      <li key={z.stufe} style={{ marginBottom: '0.15rem' }}>
                        <Link
                          href={`/stufen?belegart=${encodeURIComponent(art)}&stufe=${encodeURIComponent(z.stufe)}`}
                          aria-current={aktiv ? 'page' : undefined}
                          style={{
                            alignItems: 'baseline',
                            background: aktiv ? '#EEF1F8' : undefined,
                            borderRadius: '0.2rem',
                            color: 'inherit',
                            display: 'flex',
                            gap: '0.5rem',
                            justifyContent: 'space-between',
                            padding: '0.3rem 0.5rem',
                            textDecoration: 'none',
                          }}
                        >
                          <span>{z.stufe}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            <strong>{z.offen}</strong>
                            {z.ueberfaellig > 0 && (
                              <span style={{ color: '#A33', marginLeft: '0.4rem' }}>
                                {z.ueberfaellig} überfällig
                              </span>
                            )}
                          </span>
                        </Link>
                        {z.aeltesteFaelligkeit !== null && z.ueberfaellig > 0 && (
                          <div style={{ color: '#6F6F6F', fontSize: '0.75rem', padding: '0 0.5rem' }}>
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
        <section style={{ flex: '3 1 28rem', minWidth: 0 }}>
          {gewaehlt === undefined ? (
            <p style={{ color: '#6F6F6F' }}>
              {gesamt === 0 ? '' : 'Eine Stufe links wählen, um ihre Belege zu sehen.'}
            </p>
          ) : (
            <>
              <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
                {gewaehlt.stufe}{' '}
                <span style={{ color: '#6F6F6F', fontWeight: 'normal' }}>
                  · {BELEGART[gewaehlt.belegart] ?? gewaehlt.belegart}
                </span>
              </h2>
              {zeilen.length === 0 ? (
                <p style={{ color: '#6F6F6F' }}>Keine Belege in dieser Stufe.</p>
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
