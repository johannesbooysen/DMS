/**
 * Belegeinsicht verwalten.
 *
 * Zeigt die Gewährungen samt Zugriffszahl — das Protokoll ist der Nachweis,
 * dass Einsicht bestand, und es gehört dorthin, wo die Gewährung steht.
 *
 * Der Token erscheint **einmal**, direkt nach dem Anlegen. Danach steht in
 * der Datenbank nur sein Hash; ein zweites Anzeigen wäre nur möglich, wenn
 * wir ihn im Klartext aufbewahrten — und dann wäre ein Datenbankauszug ein
 * Generalschlüssel.
 */

import { alsBenutzer } from '@/db'
import { gewaehrungenLaden } from '@/einsicht'
import {
  einsichtGewaehrenAktion,
  einsichtWiderrufenAktion,
} from '@/app/lib/einsicht-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { datum, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const zelle = { borderBottom: '1px solid #eee', padding: '0.45rem 0.5rem' } as const

export default async function Einsichtsverwaltung({
  searchParams,
}: {
  searchParams: Promise<{ neu?: string; fehler?: string }>
}) {
  const { neu, fehler } = await searchParams
  const benutzer = await angemeldeterBenutzer()

  const gewaehrungen = await gewaehrungenLaden(benutzer)

  const stammdaten = await alsBenutzer(benutzer, async (c) => {
    const { rows: objekte } = await c.query<{ id: string; objektnummer: string }>(
      'select id, objektnummer from objekt order by objektnummer',
    )
    const { rows: personen } = await c.query<{ id: string; name: string; art: string }>(
      'select id, name, art from person order by name',
    )
    return { objekte, personen }
  })

  const feld = { display: 'block', fontSize: '0.75rem' } as const
  const eingabe = { display: 'block', padding: '0.3rem' } as const

  return (
    <Seitenrahmen titel="Belegeinsicht">
      {fehler !== undefined && (
        <p role="alert" style={{ background: '#F6DCD9', color: '#6B1D15', padding: '0.75rem' }}>
          {fehler}
        </p>
      )}

      {neu !== undefined && (
        <section
          style={{
            background: '#EEF3EE',
            border: '1px solid #2F6F4E',
            borderRadius: '0.25rem',
            margin: '1rem 0',
            padding: '0.9rem',
          }}
        >
          <h2 style={{ fontSize: '0.95rem', marginTop: 0 }}>Zugang angelegt</h2>
          <p style={{ margin: '0 0 0.5rem' }}>
            Diesen Link an den Empfänger geben. <strong>Er wird nur jetzt
            angezeigt</strong> — gespeichert ist nur seine Prüfsumme.
          </p>
          <code
            style={{
              background: '#fff',
              border: '1px solid #ccc',
              display: 'block',
              overflowWrap: 'anywhere',
              padding: '0.5rem',
            }}
          >
            /einsicht/{neu}
          </code>
        </section>
      )}

      <form
        action={einsichtGewaehrenAktion}
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.6rem',
          margin: '1rem 0 1.5rem',
        }}
      >
        <label style={feld}>
          Objekt
          <select name="objektId" required style={eingabe}>
            {stammdaten.objekte.map((o) => (
              <option key={o.id} value={o.id}>
                {o.objektnummer}
              </option>
            ))}
          </select>
        </label>

        <label style={feld}>
          Person
          <select name="personId" required style={{ ...eingabe, minWidth: '12rem' }}>
            {stammdaten.personen.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.art})
              </option>
            ))}
          </select>
        </label>

        <label style={feld}>
          Empfänger
          <select name="empfaengerTyp" style={eingabe} defaultValue="mieter">
            <option value="mieter">Mieter</option>
            <option value="eigentuemer">Eigentümer</option>
            <option value="beirat">Beirat</option>
          </select>
        </label>

        <label style={feld}>
          Umfang
          <select name="umfang" style={eingabe} defaultValue="belegliste">
            <option value="belegliste">Belegliste</option>
            <option value="wirtschaftsjahr">Wirtschaftsjahr</option>
            <option value="vorgang">Vorgang</option>
          </select>
        </label>

        <label style={feld}>
          Wirtschaftsjahr
          <input name="wirtschaftsjahr" inputMode="numeric" style={{ ...eingabe, width: '6rem' }} />
        </label>

        <label style={feld}>
          Gültig (Tage)
          <input
            name="tage"
            type="number"
            min={1}
            max={365}
            defaultValue={7}
            style={{ ...eingabe, width: '5rem' }}
          />
        </label>

        <label style={{ fontSize: '0.8rem' }}>
          <input type="checkbox" name="download" value="ja" /> Download erlauben
        </label>

        <button type="submit" style={{ cursor: 'pointer', padding: '0.4rem 0.9rem' }}>
          Zugang anlegen
        </button>
      </form>

      {gewaehrungen.length === 0 ? (
        <p>Es besteht keine Einsicht.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Empfänger</th>
              <th style={zelle}>Objekt</th>
              <th style={zelle}>Umfang</th>
              <th style={zelle}>Gültig bis</th>
              <th style={zelle}>Zugriffe</th>
              <th style={zelle}>Stand</th>
              <th style={zelle} />
            </tr>
          </thead>
          <tbody>
            {gewaehrungen.map((g) => (
              <tr key={g.id}>
                <td style={zelle}>
                  {g.personName}{' '}
                  <span style={{ color: '#666', fontSize: '0.8rem' }}>· {g.empfaengerTyp}</span>
                </td>
                <td style={zelle}>{g.objektnummer}</td>
                <td style={zelle}>
                  {g.umfang}
                  {g.rechte.includes('download') && (
                    <span style={{ color: '#B5741A', fontSize: '0.78rem' }}> · Download</span>
                  )}
                </td>
                <td style={zelle}>{datum.format(new Date(g.gueltigBis))}</td>
                <td style={zelle}>
                  {g.zugriffe}
                  {g.letzterZugriff !== null && (
                    <span style={{ color: '#666', fontSize: '0.78rem' }}>
                      {' '}
                      · zuletzt {datum.format(new Date(g.letzterZugriff))}
                    </span>
                  )}
                </td>
                <td style={zelle}>
                  {g.widerrufen ? (
                    <span style={{ color: '#B3271E' }}>widerrufen</span>
                  ) : g.abgelaufen ? (
                    <span style={{ color: '#666' }}>abgelaufen</span>
                  ) : (
                    <span style={{ color: '#2F6F4E' }}>gültig</span>
                  )}
                </td>
                <td style={zelle}>
                  {!g.widerrufen && !g.abgelaufen && (
                    <form action={einsichtWiderrufenAktion}>
                      <input type="hidden" name="gewaehrungId" value={g.id} />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 0,
                          color: '#B3271E',
                          cursor: 'pointer',
                        }}
                      >
                        widerrufen
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seitenrahmen>
  )
}
