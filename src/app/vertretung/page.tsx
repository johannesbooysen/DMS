/**
 * Vertretung einrichten und widerrufen.
 *
 * Der Satz oben auf der Seite ist der wichtigste: Die Aufgabe wandert, die
 * Rechte bleiben. Wer vertritt, sieht die Belege des anderen im Postfach —
 * entscheiden darf er nur, was seine eigenen Rollen hergeben.
 */

import { vertretungAnlegenAktion, vertretungWiderrufenAktion } from '@/app/lib/vertretung-aktionen'
import { datum, Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { benutzerListe, meineVertretungen, type Vertretung } from '@/workflow/vertretung'

export const dynamic = 'force-dynamic'

const STUFENARTEN = [
  'zuordnung',
  'sachlich',
  'rechnerisch',
  'kontierung',
  'freigabe',
  'zahlung',
]

function Umfang({ v }: { v: Vertretung }) {
  const teile = [
    v.objekt === null ? null : `Objekt ${v.objekt}`,
    v.ordnungsgruppe,
    v.stufentyp,
  ].filter(Boolean)
  return <>{teile.length === 0 ? 'alles' : teile.join(' · ')}</>
}

function Zeitraum({ v }: { v: Vertretung }) {
  return (
    <>
      {datum.format(new Date(v.gueltigVon))}
      {v.gueltigBis === null ? ' — offen' : ` — ${datum.format(new Date(v.gueltigBis))}`}
    </>
  )
}

export default async function Vertretungen({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const { fehler } = await searchParams
  const benutzer = await angemeldeterBenutzer()
  const [{ abgegeben, uebernommen }, kollegen] = await Promise.all([
    meineVertretungen(benutzer),
    benutzerListe(benutzer),
  ])

  return (
    <Seitenrahmen titel="Vertretung">
      <p style={{ color: '#555', maxWidth: '46rem' }}>
        Eine Vertretung lenkt <strong>neue Aufgaben</strong> um. Sie überträgt keine
        Rechte: Wer vertritt, darf nur, was seine eigenen Rollen hergeben — sonst
        wäre später nicht mehr feststellbar, wer wann was entscheiden durfte.
        Bereits zugewiesene Aufgaben bleiben, wo sie sind.
      </p>

      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Neue Vertretung</h2>
        <form action={vertretungAnlegenAktion} style={{ display: 'grid', gap: '0.6rem', maxWidth: '32rem' }}>
          <label>
            Meine Aufgaben übernimmt{' '}
            <select name="anBenutzer" required>
              <option value="">bitte wählen</option>
              {kollegen.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Nur für Stufenart{' '}
            <select name="stufentyp">
              <option value="">alle</option>
              {STUFENARTEN.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            Von <input name="gueltigVon" type="date" />
          </label>
          <label>
            Bis <input name="gueltigBis" type="date" /> (leer = bis auf Widerruf)
          </label>
          <label>
            Grund <input name="grund" type="text" placeholder="Urlaub, Krankheit …" />
          </label>

          <div>
            <button type="submit">Vertretung einrichten</button>
          </div>
        </form>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Von mir abgegeben ({abgegeben.length})</h2>
        {abgegeben.length === 0 ? (
          <p style={{ color: '#666' }}>Keine Vertretung eingerichtet.</p>
        ) : (
          <ul>
            {abgegeben.map((v) => (
              <li key={v.id} style={{ marginBottom: '0.5rem' }}>
                <strong>{v.anName}</strong> · <Umfang v={v} /> · <Zeitraum v={v} />
                {v.grund !== null && ` · ${v.grund}`}
                {v.widerrufenAm !== null ? (
                  <span style={{ color: '#666' }}> · widerrufen</span>
                ) : (
                  <>
                    {!v.gilt && <span style={{ color: '#666' }}> · noch nicht aktiv</span>}
                    <form action={vertretungWiderrufenAktion} style={{ display: 'inline' }}>
                      <input type="hidden" name="vertretungId" value={v.id} />
                      <button type="submit" style={{ marginLeft: '0.5rem' }}>
                        widerrufen
                      </button>
                    </form>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: '1rem' }}>Für andere übernommen ({uebernommen.length})</h2>
        {uebernommen.length === 0 ? (
          <p style={{ color: '#666' }}>Sie vertreten derzeit niemanden.</p>
        ) : (
          <ul>
            {uebernommen.map((v) => (
              <li key={v.id}>
                <strong>{v.vonName}</strong> · <Umfang v={v} /> · <Zeitraum v={v} />
                {v.widerrufenAm !== null && <span style={{ color: '#666' }}> · widerrufen</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Seitenrahmen>
  )
}
