/**
 * Der Baukasten: eine Fassung ansehen und bearbeiten.
 *
 * Bewusst eine verschachtelte Liste und keine Zeichenfläche (ADR 0002):
 * weniger Code, mit der Tastatur bedienbar, auf dem Tablet nutzbar — und
 * zeilenweise vergleichbar, sodass „was ändert sich" lesbar bleibt.
 *
 * **Der Normalfall ist eine Liste von Stufen.** Jede Stufe ist eine Zeile:
 * wer, womit, ab welchem Betrag, mit welcher Frist — aufklappbar zum
 * Ändern, darunter das Formular für eine neue. Die Behälter (Nacheinander,
 * Gleichzeitig) bleiben für die Fälle, in denen die Liste nicht reicht.
 *
 * Ziehen und Ablegen mit der Maus fehlt; die Schaltflächen hoch, runter
 * und entfernen tun dasselbe und sind die barrierefreie Grundlage.
 */

import { notFound } from 'next/navigation'
import {
  aktivierenAktion,
  bausteinEinfuegenAktion,
  bausteinEntfernenAktion,
  bausteinVerschiebenAktion,
  stufeAendernAktion,
  stufeAnlegenAktion,
  stufeEntfernenAktion,
  vierAugenAktion,
} from '@/app/lib/konfig-aktionen'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { rechtelage } from '@/stammdaten'
import { Stufenformular } from '@/app/lib/stufenformular'
import type { Knoten } from '@/workflow/baum'
import {
  baumFuerAnzeige,
  definitionenLaden,
  entwurfPruefung,
  fassungSimulieren,
} from '@/workflow/konfiguration'
import {
  auswahlLaden,
  STUFENTYP_NAMEN,
  stempelJeStufe,
  ZUSTAENDIGKEIT_NAMEN,
  zustaendigkeitsnamen,
  type Auswahl,
  type Stufentyp,
  type Zustaendigkeit,
} from '@/workflow/stufen'

export const dynamic = 'force-dynamic'

const BESCHRIFTUNG: Record<string, string> = {
  nacheinander: 'Nacheinander',
  gleichzeitig: 'Gleichzeitig',
  verzweigung: 'Wenn / Sonst',
  stufe: 'Stufe',
}

/** Alle Behaelter des Baums mit einem lesbaren Namen -- fuer „Einhaengen unter". */
function behaelterSammeln(knoten: Knoten, pfad: string[] = []): Array<{ id: string; name: string }> {
  if (knoten.knotentyp === 'stufe') return []
  const name = pfad.length === 0 ? 'Ablauf (oben)' : [...pfad, BESCHRIFTUNG[knoten.knotentyp] ?? knoten.knotentyp].join(' › ')
  return [
    { id: knoten.id, name },
    ...knoten.kinder.flatMap((k) => behaelterSammeln(k, pfad.length === 0 ? [] : [...pfad, BESCHRIFTUNG[knoten.knotentyp] ?? ''])),
  ]
}

function Baustein({
  knoten,
  definitionId,
  bearbeitbar,
  auswahl,
  stempel,
  namen,
}: {
  knoten: Knoten
  definitionId: string
  bearbeitbar: boolean
  auswahl: Auswahl
  stempel: Map<string, Array<{ id: string; name: string }>>
  namen: Map<string, string>
}) {
  const istWurzel = knoten.eltern === null
  const stufe = knoten.knotentyp === 'stufe' ? knoten.stufe : null
  const eigeneStempel = stufe === null ? [] : (stempel.get(stufe.id) ?? [])

  return (
    <li style={{ listStyle: 'none', marginTop: '0.35rem' }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span
          style={{
            background: stufe !== null ? 'var(--farbe-akzent-hell)' : 'var(--farbe-flaeche-leise)',
            border: '1px solid var(--farbe-linie)',
            borderRadius: 'var(--radius)',
            fontSize: '0.85rem',
            fontWeight: stufe !== null ? 600 : 400,
            padding: '0.25rem 0.5rem',
          }}
        >
          {stufe !== null ? stufe.bezeichnung : BESCHRIFTUNG[knoten.knotentyp]}
        </span>

        {stufe !== null && (
          <span className="leise klein">
            {[
              STUFENTYP_NAMEN[stufe.stufentyp as Stufentyp] ?? stufe.stufentyp,
              `${ZUSTAENDIGKEIT_NAMEN[stufe.zustaendigkeitTyp as Zustaendigkeit] ?? stufe.zustaendigkeitTyp}${
                stufe.zustaendigkeitRef !== null && namen.has(stufe.zustaendigkeitRef)
                  ? ` ${namen.get(stufe.zustaendigkeitRef)}`
                  : ''
              }`,
              stufe.betragVon !== null && `ab ${stufe.betragVon} EUR`,
              stufe.slaStunden !== null && `${stufe.slaStunden} h`,
              stufe.pflicht ? 'Pflicht' : 'freiwillig',
              stufe.vierAugenPflicht && 'Vier Augen',
              stufe.eskalationNachStunden !== null &&
                stufe.eskalationAn !== null &&
                `Eskalation nach ${stufe.eskalationNachStunden} h an ${namen.get(stufe.eskalationAn) ?? 'eine Person'}`,
              stufe.systemaktion !== null &&
                `Vorlage „${stufe.systemaktion.vorlage}“ an ${
                  stufe.systemaktion.empfaenger === 'adresse' ? stufe.systemaktion.adresse : 'Objektverantwortliche'
                }`,
              eigeneStempel.length === 0 ? 'kein Stempel' : `Stempel: ${eigeneStempel.map((s) => s.name).join(', ')}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}

        {/*
          Vier Augen: nicht dieselbe Person wie an der vorherigen Stufe. Eine
          Einstellung des Ablaufs -- je Kategorie --, nicht der Rolle: Rollen
          sagen, wer darf; dieser Schalter sagt, dass es zwei sein muessen.
          Ob es die zwei gibt, meldet die Pruefung unten.
        */}
        {bearbeitbar && stufe !== null && (
          <form action={vierAugenAktion} className="inline">
            <input type="hidden" name="definitionId" value={definitionId} />
            <input type="hidden" name="stufeId" value={stufe.id} />
            <input type="hidden" name="wert" value={stufe.vierAugenPflicht ? 'nein' : 'ja'} />
            <button
              type="submit"
              aria-pressed={stufe.vierAugenPflicht}
              title="Nicht dieselbe Person wie an der vorherigen Stufe"
              className="winzig"
            >
              {stufe.vierAugenPflicht ? 'Vier Augen aus' : 'Vier Augen an'}
            </button>
          </form>
        )}

        {bearbeitbar && !istWurzel && (
          <span style={{ display: 'flex', gap: '0.25rem' }}>
            {(['hoch', 'runter'] as const).map((richtung) => (
              <form key={richtung} action={bausteinVerschiebenAktion}>
                <input type="hidden" name="definitionId" value={definitionId} />
                <input type="hidden" name="knotenId" value={knoten.id} />
                <input type="hidden" name="richtung" value={richtung} />
                <button type="submit" aria-label={`Baustein nach ${richtung}`} className="winzig">
                  {richtung === 'hoch' ? 'hoch' : 'runter'}
                </button>
              </form>
            ))}
            {stufe !== null ? (
              // Eine Stufe wird als Stufe entfernt -- samt Blatt und Stempeln --,
              // nicht als Baustein: Sonst bliebe die Stufe verwaist stehen.
              <form action={stufeEntfernenAktion}>
                <input type="hidden" name="definitionId" value={definitionId} />
                <input type="hidden" name="stufeId" value={stufe.id} />
                <button type="submit" aria-label={`Stufe ${stufe.bezeichnung} entfernen`} className="winzig">
                  entfernen
                </button>
              </form>
            ) : (
              <form action={bausteinEntfernenAktion}>
                <input type="hidden" name="definitionId" value={definitionId} />
                <input type="hidden" name="knotenId" value={knoten.id} />
                <button type="submit" aria-label="Baustein entfernen" className="winzig">
                  entfernen
                </button>
              </form>
            )}
          </span>
        )}

        {bearbeitbar && knoten.knotentyp !== 'stufe' && (
          <form action={bausteinEinfuegenAktion} style={{ display: 'flex', gap: '0.25rem' }}>
            <input type="hidden" name="definitionId" value={definitionId} />
            <input type="hidden" name="elternId" value={knoten.id} />
            <select name="knotentyp" aria-label="Art des Bausteins" style={{ fontSize: '0.75rem', padding: '0.2rem' }}>
              <option value="nacheinander">Nacheinander</option>
              <option value="gleichzeitig">Gleichzeitig</option>
            </select>
            <button type="submit" className="winzig">
              Behälter einfügen
            </button>
          </form>
        )}
      </div>

      {bearbeitbar && stufe !== null && (
        <details style={{ margin: '0.3rem 0 0.5rem' }}>
          <summary className="klein" style={{ color: 'var(--farbe-akzent)', cursor: 'pointer' }}>
            Stufe ändern
          </summary>
          <div className="karte" style={{ margin: '0.4rem 0' }}>
            <Stufenformular
              aktion={stufeAendernAktion}
              definitionId={definitionId}
              auswahl={auswahl}
              stufe={stufe}
              stempel={eigeneStempel.map((s) => s.id)}
              beschriftung="Übernehmen"
            />
          </div>
        </details>
      )}

      {knoten.kinder.length > 0 && (
        <ul style={{ borderLeft: '2px solid var(--farbe-linie)', margin: 0, paddingLeft: '1rem' }}>
          {knoten.kinder.map((kind) => (
            <Baustein
              key={kind.id}
              knoten={kind}
              definitionId={definitionId}
              bearbeitbar={bearbeitbar}
              auswahl={auswahl}
              stempel={stempel}
              namen={namen}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default async function Fassung({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fehler?: string; brutto?: string }>
}) {
  const { id } = await params
  const { fehler, brutto } = await searchParams
  const benutzer = await angemeldeterBenutzer()

  const fassungen = await definitionenLaden(benutzer)
  const fassung = fassungen.find((f) => f.id === id)
  if (fassung === undefined) return notFound()

  const [wurzel, befunde, auswahl, stempel, namen] = await Promise.all([
    baumFuerAnzeige(benutzer, id),
    entwurfPruefung(benutzer, id),
    auswahlLaden(benutzer),
    stempelJeStufe(benutzer, id),
    zustaendigkeitsnamen(benutzer),
  ])
  // Entwurf und Recht -- ohne prozess_konfigurieren ist der Entwurf nur zu lesen.
  const bearbeitbar = fassung.status === 'entwurf' && (await rechtelage(benutzer)).prozess

  const probebetrag = Number(brutto ?? 3000)
  const schritte = await fassungSimulieren(benutzer, id, {
    brutto: probebetrag,
    belegart: fassung.belegart,
  })

  return (
    <Seitenrahmen titel={`${fassung.belegart}, Version ${fassung.version}`}>
      <p className="leise">
        {fassung.status === 'entwurf'
          ? `Entwurf${fassung.entwurfVonName === null ? '' : ` von ${fassung.entwurfVonName}`}`
          : fassung.status === 'aktiv'
            ? 'Aktive Fassung — zum Ändern einen Entwurf anlegen'
            : 'Abgelöste Fassung'}
        {` · ${fassung.laufendeBelege} laufende Belege`}
      </p>

      {fehler !== undefined && (
        <p role="alert" className="meldung-fehler">
          {fehler}
        </p>
      )}

      <div className="zweispaltig">
        <section style={{ flex: '3 1 30rem' }}>
          <h2>Ablauf</h2>
          {wurzel === null ? (
            <p className="leise">Kein Ablauf hinterlegt.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0 }}>
              <Baustein
                knoten={wurzel}
                definitionId={id}
                bearbeitbar={bearbeitbar}
                auswahl={auswahl}
                stempel={stempel}
                namen={namen}
              />
            </ul>
          )}

          {bearbeitbar && wurzel !== null && (
            <section className="karte" aria-labelledby="neue-stufe">
              <h2 id="neue-stufe" style={{ marginTop: 0 }}>
                Stufe hinzufügen
              </h2>
              <p className="leise klein" style={{ margin: '0 0 0.75rem' }}>
                Wer entscheidet, womit, ab welchem Betrag. Wohin der Beleg danach geht, ergibt sich
                aus der Reihenfolge — ein Zielfeld gibt es nicht.
              </p>
              <Stufenformular
                aktion={stufeAnlegenAktion}
                definitionId={id}
                auswahl={auswahl}
                behaelter={behaelterSammeln(wurzel)}
                beschriftung="Stufe anlegen"
              />
            </section>
          )}
        </section>

        <aside style={{ flex: '1 1 20rem' }}>
          <h2>Prüfung</h2>
          {befunde.length === 0 ? (
            <p className="gruen">Keine Befunde — der Ablauf ist gültig.</p>
          ) : (
            <ul>
              {befunde.map((b) => (
                <li
                  key={b.befund}
                  style={{ color: b.schwere === 'fehler' ? 'var(--farbe-rot)' : 'var(--farbe-orange)' }}
                >
                  {/* Das Wort steht dabei, nicht nur die Farbe: Ein Fehler
                      verhindert das Aktivieren, eine Warnung nicht -- wer das
                      nur an Rot gegen Ocker erkennen soll, erkennt es nicht
                      (dieselbe Regel wie bei der Ampel). */}
                  <strong>{b.schwere === 'fehler' ? 'Fehler' : 'Warnung'}:</strong> {b.befund}
                </li>
              ))}
            </ul>
          )}

          <h2>Simulation</h2>
          <p className="leise klein" style={{ marginTop: 0 }}>
            Die Kette, die sich für einen gedachten Beleg ergibt.
          </p>
          <form method="get" className="filterzeile">
            <label className="feld" htmlFor="brutto">
              Rechnung über
              <input id="brutto" name="brutto" type="number" defaultValue={probebetrag} step="100" style={{ width: '8rem' }} />
            </label>
            <button type="submit">zeigen</button>
          </form>
          <ol>
            {schritte.map((schritt) => (
              <li key={schritt.stufen.map((s) => s.id).join('-')}>
                {schritt.stufen.map((s) => s.bezeichnung).join(' + ')}
                {schritt.stufen.length > 1 && ' (gleichzeitig)'}
              </li>
            ))}
          </ol>

          {bearbeitbar && (
            <form action={aktivierenAktion} style={{ marginTop: '1rem' }}>
              <input type="hidden" name="definitionId" value={id} />
              <button
                type="submit"
                className="knopf-primaer"
                style={{ background: 'var(--farbe-gruen)', borderColor: 'var(--farbe-gruen)' }}
              >
                Fassung aktivieren
              </button>
            </form>
          )}
        </aside>
      </div>
    </Seitenrahmen>
  )
}
