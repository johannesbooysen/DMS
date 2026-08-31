/**
 * Der Baukasten: eine Fassung ansehen und bearbeiten.
 *
 * Bewusst eine verschachtelte Liste und keine Zeichenfläche (ADR 0002):
 * weniger Code, mit der Tastatur bedienbar, auf dem Tablet nutzbar — und
 * zeilenweise vergleichbar, sodass „was ändert sich" lesbar bleibt.
 *
 * Ziehen und Ablegen mit der Maus fehlt noch; die Schaltflächen hoch, runter
 * und entfernen tun dasselbe und sind die barrierefreie Grundlage, auf der
 * das Ziehen später aufsetzt.
 */

import { notFound } from 'next/navigation'
import {
  aktivierenAktion,
  bausteinEinfuegenAktion,
  bausteinEntfernenAktion,
  bausteinVerschiebenAktion,
} from '@/app/lib/konfig-aktionen'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import type { Knoten } from '@/workflow/baum'
import {
  baumFuerAnzeige,
  definitionenLaden,
  entwurfPruefung,
  fassungSimulieren,
} from '@/workflow/konfiguration'

export const dynamic = 'force-dynamic'

const BESCHRIFTUNG: Record<string, string> = {
  nacheinander: 'Nacheinander',
  gleichzeitig: 'Gleichzeitig',
  verzweigung: 'Wenn / Sonst',
  stufe: 'Stufe',
}

function Baustein({
  knoten,
  definitionId,
  bearbeitbar,
}: {
  knoten: Knoten
  definitionId: string
  bearbeitbar: boolean
}) {
  const istWurzel = knoten.eltern === null

  return (
    <li style={{ listStyle: 'none', marginTop: '0.35rem' }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span
          style={{
            background: knoten.knotentyp === 'stufe' ? '#E1E5F2' : '#ECECEA',
            borderRadius: '0.25rem',
            fontSize: '0.85rem',
            padding: '0.25rem 0.5rem',
          }}
        >
          {knoten.knotentyp === 'stufe'
            ? (knoten.stufe?.bezeichnung ?? 'Stufe ohne Bezeichnung')
            : BESCHRIFTUNG[knoten.knotentyp]}
        </span>

        {knoten.knotentyp === 'stufe' && knoten.stufe !== null && (
          <span style={{ color: '#666', fontSize: '0.8rem' }}>
            {[
              knoten.stufe.zustaendigkeitTyp,
              knoten.stufe.betragVon !== null && `ab ${knoten.stufe.betragVon} EUR`,
              knoten.stufe.pflicht ? 'Pflicht' : 'freiwillig',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}

        {bearbeitbar && !istWurzel && (
          <span style={{ display: 'flex', gap: '0.25rem' }}>
            {(['hoch', 'runter'] as const).map((richtung) => (
              <form key={richtung} action={bausteinVerschiebenAktion}>
                <input type="hidden" name="definitionId" value={definitionId} />
                <input type="hidden" name="knotenId" value={knoten.id} />
                <input type="hidden" name="richtung" value={richtung} />
                <button type="submit" aria-label={`Baustein nach ${richtung}`}>
                  {richtung === 'hoch' ? 'hoch' : 'runter'}
                </button>
              </form>
            ))}
            <form action={bausteinEntfernenAktion}>
              <input type="hidden" name="definitionId" value={definitionId} />
              <input type="hidden" name="knotenId" value={knoten.id} />
              <button type="submit" aria-label="Baustein entfernen">
                entfernen
              </button>
            </form>
          </span>
        )}

        {bearbeitbar && knoten.knotentyp !== 'stufe' && (
          <form action={bausteinEinfuegenAktion} style={{ display: 'flex', gap: '0.25rem' }}>
            <input type="hidden" name="definitionId" value={definitionId} />
            <input type="hidden" name="elternId" value={knoten.id} />
            <select name="knotentyp" aria-label="Art des Bausteins">
              <option value="nacheinander">Nacheinander</option>
              <option value="gleichzeitig">Gleichzeitig</option>
            </select>
            <button type="submit">einfügen</button>
          </form>
        )}
      </div>

      {knoten.kinder.length > 0 && (
        <ul style={{ borderLeft: '2px solid #ddd', margin: 0, paddingLeft: '1rem' }}>
          {knoten.kinder.map((kind) => (
            <Baustein
              key={kind.id}
              knoten={kind}
              definitionId={definitionId}
              bearbeitbar={bearbeitbar}
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
  const benutzer = angemeldeterBenutzer()

  const fassungen = await definitionenLaden(benutzer)
  const fassung = fassungen.find((f) => f.id === id)
  if (fassung === undefined) return notFound()

  const wurzel = await baumFuerAnzeige(benutzer, id)
  const befunde = await entwurfPruefung(benutzer, id)
  const bearbeitbar = fassung.status === 'entwurf'

  const probebetrag = Number(brutto ?? 3000)
  const schritte = await fassungSimulieren(benutzer, id, {
    brutto: probebetrag,
    belegart: fassung.belegart,
  })

  return (
    <Seitenrahmen titel={`${fassung.belegart}, Version ${fassung.version}`}>
      <p style={{ color: '#555' }}>
        {fassung.status === 'entwurf'
          ? `Entwurf${fassung.entwurfVonName === null ? '' : ` von ${fassung.entwurfVonName}`}`
          : fassung.status === 'aktiv'
            ? 'Aktive Fassung — zum Ändern einen Entwurf anlegen'
            : 'Abgelöste Fassung'}
        {` · ${fassung.laufendeBelege} laufende Belege`}
      </p>

      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <section style={{ flex: 1, minWidth: '20rem' }}>
          <h2 style={{ fontSize: '1rem' }}>Ablauf</h2>
          {wurzel === null ? (
            <p style={{ color: '#666' }}>Kein Ablauf hinterlegt.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0 }}>
              <Baustein knoten={wurzel} definitionId={id} bearbeitbar={bearbeitbar} />
            </ul>
          )}
        </section>

        <aside style={{ flex: '0 0 22rem' }}>
          <h2 style={{ fontSize: '1rem' }}>Prüfung</h2>
          {befunde.length === 0 ? (
            <p style={{ color: '#2F6F4E' }}>Keine Befunde — der Ablauf ist gültig.</p>
          ) : (
            <ul>
              {befunde.map((b) => (
                <li
                  key={b.befund}
                  style={{ color: b.schwere === 'fehler' ? '#B3271E' : '#B5741A' }}
                >
                  {b.befund}
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ fontSize: '1rem' }}>Simulation</h2>
          <p style={{ color: '#666', fontSize: '0.85rem', marginTop: 0 }}>
            Die Kette, die sich für einen gedachten Beleg ergibt.
          </p>
          <form method="get" style={{ marginBottom: '0.5rem' }}>
            <label htmlFor="brutto">Rechnung über </label>
            <input id="brutto" name="brutto" type="number" defaultValue={probebetrag} step="100" />
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
                style={{
                  background: '#2F6F4E',
                  border: 0,
                  borderRadius: '0.25rem',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '0.6rem 1rem',
                }}
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
