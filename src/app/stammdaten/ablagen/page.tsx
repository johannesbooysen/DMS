/**
 * Ablagen -- wo ein Beleg liegt und wer ihn sieht (Migration 20261006150000).
 *
 * Beim Bedienen gefragt: "Derzeit hat das DMS nur eine Ablage. Aehnlich wie
 * Amagno soll es mehrere haben, z. B. Lieferantenrechnungen und
 * Schriftverkehr, erweiterbar, mit unterschiedlichen Rechten je Ablage."
 *
 * Zwei Abschnitte, zwei Rechte: Die Ablagen selbst pflegt, wer Stammdaten
 * pflegt; welche Rolle in welcher Ablage was darf, vergibt, wer Benutzer
 * verwaltet -- dasselbe Recht wie fuer jedes andere Rollenrecht, weil es
 * dasselbe ist (`rolle_recht.ablage_id`).
 */

import Link from 'next/link'
import {
  ablageAendernAktion,
  ablageAnlegenAktion,
  ablagerechteSetzenAktion,
  ablageStandardAktion,
  ablageUmschaltenAktion,
} from '@/app/lib/stammdaten-aktionen'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Anlegen, Eingabe, Fehler, Handlung, kopfzelle, NurLesend, tabelle, zelle } from '@/app/lib/stammdaten-teile'
import { entwurfFuerAblageAktion } from '@/app/lib/konfig-aktionen'
import { rechtelage, rollenLaden } from '@/stammdaten'
import { ablagenablaeufe } from '@/workflow/konfiguration'
import { ABLAGE_RECHTE, ablagenLaden, ablagerechteLaden, BELEGARTEN, type Ablagerecht } from '@/stammdaten/ablagen'

export const dynamic = 'force-dynamic'

const HIER = '/stammdaten/ablagen'

const BELEGART: Record<string, string> = {
  rechnung: 'Rechnung',
  gutschrift: 'Gutschrift',
  mahnung: 'Mahnung',
  kundenrechnung: 'Kundenrechnung',
  schriftverkehr: 'Schriftverkehr',
  sonstiges: 'Sonstiges',
}

const RECHT: Record<Ablagerecht, string> = {
  ansehen: 'ansehen',
  bearbeiten: 'bearbeiten (in die Ablage legen)',
}

function Belegartenwahl({ gewaehlt }: { gewaehlt: string[] }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <legend className="leise" style={{ fontSize: '0.75rem' }}>
        Belegarten, die hier landen
      </legend>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', fontSize: '0.8rem' }}>
        {BELEGARTEN.map((b) => (
          <label key={b} style={{ whiteSpace: 'nowrap' }}>
            <input type="checkbox" name="belegart" value={b} defaultChecked={gewaehlt.includes(b)} /> {BELEGART[b] ?? b}
          </label>
        ))}
      </span>
    </fieldset>
  )
}

export default async function Ablagen({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const ich = await angemeldeterBenutzer()
  const { fehler } = await searchParams
  const [darf, ablagen, rollen, rechte, ablaeufe] = await Promise.all([
    rechtelage(ich),
    ablagenLaden(ich),
    rollenLaden(ich),
    ablagerechteLaden(ich),
    ablagenablaeufe(ich),
  ])
  const aktive = ablagen.filter((a) => a.aktiv)

  // Welche Belegart in welche Ablage faellt -- und welche in keine (dann
  // nimmt die Standard-Ablage sie auf). Steht eine in zweien, gewinnt die
  // Sortierung; das wird hier gesagt, nicht stillschweigend entschieden.
  const standard = aktive.find((a) => a.istStandard) ?? null
  const ohneAblage = BELEGARTEN.filter((b) => !aktive.some((a) => a.belegarten.includes(b)))
  const doppelt = BELEGARTEN.filter((b) => aktive.filter((a) => a.belegarten.includes(b)).length > 1)

  return (
    <Seitenrahmen titel="Ablagen">
      <Fehler text={fehler} />
      {!darf.stammdaten && !darf.benutzer && <NurLesend was="die Ablagen" />}

      <p className="einleitung">
        Eine <strong>Ablage</strong> sagt, wo ein Beleg liegt, wer ihn sieht — und welchen{' '}
        <strong>Ablauf</strong> er nimmt: Je Ablage und Belegart kann ein eigener Ablauf gelten; ohne
        eigenen gilt der Hausstandard der Belegart. Wie die Ablagen in Amagno. Die Belegart sagt, <em>was</em> ein Beleg ist und welchen Ablauf er nimmt; jede Ablage
        nennt die Belegarten, deren Belege beim Eingang von selbst in ihr landen. Eine Ablage ist der{' '}
        <strong>Standard</strong> und nimmt alles auf, was sonst keine findet. Wer beim Hochladen oder
        in der Belegansicht eine Ablage wählt, legt sie fest; die Erkennung stellt dann nichts mehr um.
      </p>

      <section className="abschnitt">
        <h2>Ablagen des Hauses</h2>
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Ablage</th>
              <th style={kopfzelle}>Kurzcode</th>
              <th style={kopfzelle}>Belegarten</th>
              <th style={kopfzelle}>Abläufe</th>
              <th style={kopfzelle}>Belege</th>
              <th style={kopfzelle}>Stand</th>
              {darf.stammdaten && <th style={kopfzelle}>Handlung</th>}
            </tr>
          </thead>
          <tbody>
            {ablagen.map((a) => (
              <tr key={a.id} style={a.aktiv ? undefined : { color: 'var(--farbe-text-leise)' }}>
                <td style={zelle}>
                  <strong>{a.name}</strong>
                  {a.istStandard && <span className="leise klein"> · Standard</span>}
                  {a.beschreibung !== null && (
                    <>
                      <br />
                      <span className="leise klein">{a.beschreibung}</span>
                    </>
                  )}
                </td>
                <td style={zelle}>{a.kurzcode}</td>
                <td style={zelle}>
                  {darf.stammdaten && a.aktiv ? (
                    <form action={ablageAendernAktion} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      <input type="hidden" name="zurueck" value={HIER} />
                      <input type="hidden" name="id" value={a.id} />
                      <Belegartenwahl gewaehlt={a.belegarten} />
                      <Eingabe name="beschreibung" label="Beschreibung" breite="16rem" wert={a.beschreibung ?? ''} />
                      <span>
                        <button type="submit" className="klein">
                          Übernehmen
                        </button>
                      </span>
                    </form>
                  ) : a.belegarten.length === 0 ? (
                    <span className="leise">keine</span>
                  ) : (
                    a.belegarten.map((b) => BELEGART[b] ?? b).join(', ')
                  )}
                </td>
                <td style={zelle}>
                  {/*
                    Je Belegart der Ablage: eigener Ablauf (aktiv), Entwurf oder
                    Hausstandard. Der Knopf legt eine Kopie des Standards als
                    Entwurf an -- Konfiguration -> Ablaeufe aktiviert ihn.
                  */}
                  {ablaeufe
                    .filter((l) => l.ablageId === a.id)
                    .map((l) => (
                      <div key={l.belegart} className="klein" style={{ whiteSpace: 'nowrap' }}>
                        <span className="leise">{BELEGART[l.belegart] ?? l.belegart}: </span>
                        {l.eigener !== null ? (
                          <Link href={`/konfiguration/${l.eigener.id}`}>eigener Ablauf, Fassung {l.eigener.version}</Link>
                        ) : l.standard !== null ? (
                          <Link href={`/konfiguration/${l.standard.id}`}>Hausstandard</Link>
                        ) : (
                          <span className="orange">kein Ablauf</span>
                        )}
                        {l.entwurf !== null && (
                          <>
                            {' · '}
                            <Link href={`/konfiguration/${l.entwurf.id}`}>Entwurf {l.entwurf.version}</Link>
                          </>
                        )}
                        {l.eigener === null && l.entwurf === null && l.standard !== null && darf.prozess && (
                          <form action={entwurfFuerAblageAktion} className="inline">
                            <input type="hidden" name="ablageId" value={a.id} />
                            <input type="hidden" name="belegart" value={l.belegart} />
                            {' · '}
                            <button type="submit" className="knopf-link klein">
                              eigenen Ablauf anlegen
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                </td>
                <td style={zelle}>
                  {a.belege === 0 ? (
                    <span className="leise">keine</span>
                  ) : (
                    <Link href={`/belege?ablage=${a.id}`}>{a.belege}</Link>
                  )}
                </td>
                <td style={zelle}>{a.aktiv ? 'aktiv' : 'deaktiviert'}</td>
                {darf.stammdaten && (
                  <td style={{ ...zelle, whiteSpace: 'nowrap' }}>
                    {a.aktiv && !a.istStandard && (
                      <Handlung aktion={ablageStandardAktion} zurueck={HIER} felder={{ id: a.id }}>
                        zum Standard machen
                      </Handlung>
                    )}{' '}
                    {!a.istStandard && (
                      <Handlung
                        aktion={ablageUmschaltenAktion}
                        zurueck={HIER}
                        felder={{ id: a.id }}
                        farbe={a.aktiv ? 'var(--farbe-rot)' : undefined}
                      >
                        {a.aktiv ? 'deaktivieren' : 'aktivieren'}
                      </Handlung>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {(ohneAblage.length > 0 || doppelt.length > 0 || standard === null) && (
          <p className="klein" style={{ marginTop: '0.5rem' }}>
            {standard === null && (
              <span className="orange">
                Keine Standard-Ablage — ein Beleg, dessen Belegart in keiner Ablage steht, landet in der ersten
                aktiven Ablage nach Sortierung.{' '}
              </span>
            )}
            {ohneAblage.length > 0 && standard !== null && (
              <>
                Ohne eigene Ablage, landen im Standard „{standard.name}“:{' '}
                {ohneAblage.map((b) => BELEGART[b] ?? b).join(', ')}.{' '}
              </>
            )}
            {doppelt.length > 0 && (
              <span className="orange">
                In mehreren Ablagen (die niedrigere Sortierung gewinnt): {doppelt.map((b) => BELEGART[b] ?? b).join(', ')}.
              </span>
            )}
          </p>
        )}
        <p className="leise winzig">
          Eine Ablage wird nie gelöscht, nur deaktiviert: An ihr hängt die Sichtbarkeit ihrer Belege. Die
          Standard-Ablage lässt sich nicht deaktivieren — erst eine andere zum Standard machen.
        </p>

        {darf.stammdaten && (
          <Anlegen aktion={ablageAnlegenAktion} zurueck={HIER}>
            <Eingabe name="name" label="Name" pflicht breite="14rem" />
            <Eingabe name="kurzcode" label="Kurzcode" pflicht breite="5rem" />
            <Eingabe name="beschreibung" label="Beschreibung" breite="16rem" />
            <Belegartenwahl gewaehlt={[]} />
            <label style={{ fontSize: '0.75rem', alignSelf: 'flex-end' }}>
              <input type="checkbox" name="standard" value="ja" /> als Standard
            </label>
          </Anlegen>
        )}
      </section>

      <section className="abschnitt">
        <h2>Rechte je Ablage</h2>
        <p className="absatz-leise">
          Zwei Rechte gelten je Ablage: <strong>ansehen</strong> und <strong>bearbeiten</strong>. Ein Haken
          bei „alle Ablagen“ gilt überall; Haken bei einzelnen Ablagen begrenzen das Recht auf diese. Wer
          eine Ablage nicht ansehen darf, sieht ihre Belege nirgends: nicht in der Suche, nicht im Postfach,
          nicht in einer Summe. Wer in einer Ablage nicht bearbeiten darf, kann keinen Beleg dorthin legen.
          Alle übrigen Rechte einer Rolle (kontieren, stempeln, exportieren, Verwaltung) gelten unabhängig von
          der Ablage und werden unter <Link href="/stammdaten/benutzer">Benutzer und Rollen</Link> vergeben.
        </p>
        {!darf.benutzer && <p className="meldung-hinweis klein">Rechte vergeben darf, wer Benutzer verwaltet.</p>}

        {rollen
          .filter((r) => r.aktiv)
          .map((r) => {
            const meine = rechte.find((e) => e.rolleId === r.id)?.eintraege ?? []
            const hat = (aktion: Ablagerecht, ablageId: string | null): boolean =>
              meine.some((e) => e.aktion === aktion && e.ablageId === ablageId)
            return (
              <form key={r.id} action={ablagerechteSetzenAktion} className="karte" style={{ marginTop: '0.75rem' }}>
                <input type="hidden" name="zurueck" value={HIER} />
                <input type="hidden" name="rolleId" value={r.id} />
                <h3 style={{ margin: '0 0 0.4rem' }}>
                  {r.name} <span className="leise">{r.kurzcode}</span>
                </h3>
                <fieldset disabled={!darf.benutzer} style={{ border: 0, padding: 0, margin: 0 }}>
                  <table style={tabelle}>
                    <thead>
                      <tr>
                        <th style={kopfzelle}>Recht</th>
                        <th style={kopfzelle}>alle Ablagen</th>
                        {aktive.map((a) => (
                          <th key={a.id} style={kopfzelle}>
                            {a.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ABLAGE_RECHTE.map((aktion) => (
                        <tr key={aktion}>
                          <td style={zelle}>{RECHT[aktion]}</td>
                          <td style={{ ...zelle, textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              name="recht"
                              value={`${aktion}|alle`}
                              defaultChecked={hat(aktion, null)}
                              aria-label={`${RECHT[aktion]} in allen Ablagen`}
                            />
                          </td>
                          {aktive.map((a) => (
                            <td key={a.id} style={{ ...zelle, textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                name="recht"
                                value={`${aktion}|${a.id}`}
                                defaultChecked={hat(aktion, a.id)}
                                aria-label={`${RECHT[aktion]} in ${a.name}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {darf.benutzer && (
                    <button type="submit" className="klein" style={{ marginTop: '0.4rem' }}>
                      Rechte der Rolle „{r.name}“ speichern
                    </button>
                  )}
                </fieldset>
              </form>
            )
          })}
        <p className="leise winzig" style={{ marginTop: '0.5rem' }}>
          Gespeichert wird die Tabelle als Ganzes. Rechte mit Geltung je Belegart oder Ordnungsgruppe (aus
          einem Preset) bleiben davon unberührt. Einer Rolle, die ansehen darf, lässt sich das Sichtrecht hier
          nicht ganz nehmen — nur einschränken; ohne Sichtrecht aus einer Rolle gälten alle Ablagen, und wer
          heute nur über eine Objektzuständigkeit sieht, sieht weiter, was er sah.
        </p>
      </section>
    </Seitenrahmen>
  )
}
