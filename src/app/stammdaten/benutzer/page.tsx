/**
 * Benutzer, Rollen und Zuständigkeiten.
 *
 * **Getrennt von den übrigen Stammdaten, weil es ein anderes Recht ist.**
 * Einen Kreditor anzulegen ist Tagesgeschäft der Buchhaltung. Rollen zu
 * vergeben ist es nicht: Wer das darf, kann sich jedes andere Recht selbst
 * geben — es ist das Recht, aus dem alle anderen folgen.
 *
 * Bis zur Migration `20260903100000` durfte das **jeder** Benutzer. Anna,
 * eine Objektbearbeiterin mit Zuständigkeit für ein einziges Objekt, konnte
 * sich die Geschäftsleitung zuweisen; nachgestellt und behoben.
 *
 * Angelegt wird hier nur die *Kennung*. Ob jemand hereinkommt, entscheidet
 * die Anmeldung über Entra ID — `auth_id` entsteht bei der ersten Anmeldung
 * (ADR 0004). Ein Benutzer ohne Anmeldung ist ein Platzhalter, kein Zugang.
 */

import Link from 'next/link'
import {
  benutzerLaden,
  objekteLaden,
  rechtelage,
  rollenLaden,
} from '@/stammdaten'
import {
  benutzerAnlegenAktion,
  benutzerUmschaltenAktion,
  rolleEntziehenAktion,
  rolleZuweisenAktion,
  zustaendigkeitBeendenAktion,
  zustaendigkeitSetzenAktion,
  presetAnwendenAktion,
} from '@/app/lib/stammdaten-aktionen'
import { PRESETS } from '@/stammdaten/presets'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Seitenrahmen } from '@/app/lib/darstellung'
import {
  Anlegen,
  Auswahl,
  Eingabe,
  Fehler,
  Handlung,
  kopfzelle,
  Marke,
  NurLesend,
  tabelle,
  zelle,
} from '@/app/lib/stammdaten-teile'

export const dynamic = 'force-dynamic'

const HIER = '/stammdaten/benutzer'

/** Was ein Recht im Klartext bedeutet. */
const RECHT: Record<string, string> = {
  ansehen: 'ansehen',
  bearbeiten: 'bearbeiten',
  kontieren: 'kontieren',
  stempeln: 'stempeln',
  exportieren: 'exportieren',
  freigeben_einsicht: 'Einsicht gewähren',
  prozess_konfigurieren: 'Abläufe ändern',
  delegieren: 'delegieren',
  stammdaten_pflegen: 'Stammdaten pflegen',
  benutzer_verwalten: 'Benutzer verwalten',
}

/** Die beiden Rechte, aus denen weitere folgen — sie werden hervorgehoben. */
const WEITREICHEND = new Set(['benutzer_verwalten', 'prozess_konfigurieren'])

export default async function BenutzerUndRollen({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; hinweis?: string }>
}) {
  const ich = await angemeldeterBenutzer()
  const { fehler, hinweis } = await searchParams

  const [darf, benutzer, rollen, objekte] = await Promise.all([
    rechtelage(ich),
    benutzerLaden(ich),
    rollenLaden(ich),
    objekteLaden(ich),
  ])

  return (
    <Seitenrahmen titel="Benutzer und Rollen">
      <Fehler text={fehler} />
      {!darf.benutzer && <NurLesend was="Benutzer und Rollen" />}

      <p style={{ color: '#555', fontSize: '0.85rem', marginTop: 0 }}>
        Die übrigen Stammdaten stehen unter <Link href="/stammdaten">Stammdaten</Link>. Wer
        hier ändern darf, kann sich jedes andere Recht selbst geben — deshalb ist es ein
        eigenes.
      </p>

      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Benutzer</h2>
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Name</th>
              <th style={kopfzelle}>Kennung</th>
              <th style={kopfzelle}>Rollen</th>
              <th style={kopfzelle}>Objekte</th>
              <th style={kopfzelle} />
            </tr>
          </thead>
          <tbody>
            {benutzer.map((b) => (
              <tr key={b.id} style={b.aktiv ? undefined : { color: '#999' }}>
                <td style={zelle}>
                  {b.name}
                  {!b.aktiv && (
                    <>
                      {' '}
                      <Marke text="gesperrt" farbe="#B3271E" />
                    </>
                  )}
                </td>
                <td style={zelle}>{b.email}</td>
                <td style={zelle}>
                  {b.rollen.length === 0 ? (
                    <span style={{ color: '#B3271E' }}>keine</span>
                  ) : (
                    b.rollen.join(', ')
                  )}
                </td>
                <td style={zelle}>
                  {b.mandantenweit
                    ? 'alle (mandantenweit)'
                    : b.objekte.length === 0
                      ? '—'
                      : b.objekte.join(', ')}
                </td>
                <td style={zelle}>
                  {darf.benutzer && b.id !== ich && (
                    <Handlung
                      aktion={benutzerUmschaltenAktion}
                      zurueck={HIER}
                      felder={{ id: b.id }}
                      farbe={b.aktiv ? '#B3271E' : undefined}
                    >
                      {b.aktiv ? 'sperren' : 'entsperren'}
                    </Handlung>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {darf.benutzer && (
          <Anlegen aktion={benutzerAnlegenAktion} zurueck={HIER} beschriftung="Benutzer anlegen">
            <Eingabe name="name" label="Name" breite="14rem" pflicht />
            <Eingabe name="email" label="Kennung (E-Mail)" breite="18rem" pflicht typ="email" />
          </Anlegen>
        )}
        <p style={{ color: '#555', fontSize: '0.8rem' }}>
          Angelegt wird die Kennung, nicht der Zugang: Ob jemand hereinkommt, entscheidet die
          Anmeldung über Entra ID. Ein Benutzer ohne Rolle sieht nichts — das ist die richtige
          Vorgabe, aber sie fällt sonst erst beim ersten Anmelden auf.
        </p>
      </section>

      {hinweis !== undefined && (
        <p role="status" style={{ color: '#1B5E20' }}>
          {hinweis}
        </p>
      )}

      {darf.benutzer && (
        <section style={{ marginBottom: '2.5rem' }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.25rem' }}>Berechtigungs-Presets</h2>
          <p style={{ color: '#555', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            Ein Startwert für die Ersteinrichtung, keine Bindung: Angewendet entstehen
            gewöhnliche Rollen und Rechte, und nichts verweist zurück. Ein Preset{' '}
            <strong>ergänzt und nimmt nichts weg</strong> — eine vorhandene Rolle mit
            demselben Kurzcode bleibt, wie sie ist. Zweimal anwenden ist wie einmal.
          </p>
          <table style={tabelle}>
            <tbody>
              {PRESETS.map((preset) => (
                <tr key={preset.id} style={{ borderTop: '1px solid #ddd' }}>
                  <td style={{ padding: '0.4rem 0.5rem', verticalAlign: 'top' }}>
                    <strong>{preset.name}</strong>
                    <div style={{ color: '#555', fontSize: '0.85rem' }}>{preset.beschreibung}</div>
                    <div style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                      {preset.rollen.map((r) => `${r.kurzcode} ${r.name}`).join(' · ')}
                    </div>
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', verticalAlign: 'top' }}>
                    <form action={presetAnwendenAktion}>
                      <input type="hidden" name="preset" value={preset.id} />
                      <button type="submit">Anwenden</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.25rem' }}>Rollen und ihre Rechte</h2>
        <p style={{ color: '#555', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
          Rechte sind additiv: Eine zweite Rolle kann ein Recht nur hinzufügen, nie entziehen.
          Deshalb ist &bdquo;warum durfte er das nicht&ldquo; immer an einer Stelle zu beantworten.
        </p>
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Rolle</th>
              <th style={kopfzelle}>Rechte</th>
              <th style={kopfzelle}>Träger</th>
            </tr>
          </thead>
          <tbody>
            {rollen.map((r) => (
              <tr key={r.id} style={r.aktiv ? undefined : { color: '#999' }}>
                <td style={{ ...zelle, whiteSpace: 'nowrap' }}>
                  {r.name} <span style={{ color: '#777' }}>{r.kurzcode}</span>
                </td>
                <td style={zelle}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {r.rechte.map((a) => (
                      <Marke
                        key={a}
                        text={RECHT[a] ?? a}
                        farbe={WEITREICHEND.has(a) ? '#B3271E' : '#3B4A80'}
                      />
                    ))}
                  </span>
                </td>
                <td style={zelle}>
                  {r.traeger === 0 ? (
                    <span style={{ color: '#8A6D1F' }}>niemand</span>
                  ) : (
                    r.traeger
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: '#555', fontSize: '0.8rem' }}>
          Rot markiert sind die beiden weitreichenden Rechte: Wer Benutzer verwalten darf, kann
          sich jedes andere geben; wer Abläufe ändern darf, bestimmt, wer freigeben muss. Eine
          Rolle mit null Trägern ist kein Fehler, aber ein Recht, das niemand mehr hat, fällt
          sonst erst auf, wenn es gebraucht wird.
        </p>
      </section>

      {darf.benutzer && (
        <section style={{ marginBottom: '2.5rem' }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.25rem' }}>Rolle zuweisen</h2>
          <p style={{ color: '#555', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            Ohne Objekt gilt die Rolle mandantenweit. Entzogen wird sie nicht gelöscht, sondern
            beendet — wer wann welche Rolle trug, ist die Antwort auf &bdquo;wer durfte das damals&ldquo;.
          </p>
          <Anlegen aktion={rolleZuweisenAktion} zurueck={HIER} beschriftung="Zuweisen">
            <Auswahl
              name="benutzerId"
              label="Benutzer"
              breite="14rem"
              optionen={benutzer.map((b) => ({ wert: b.id, text: b.name }))}
            />
            <Auswahl
              name="rolleId"
              label="Rolle"
              breite="14rem"
              optionen={rollen.map((r) => ({ wert: r.id, text: r.name }))}
            />
            <Auswahl
              name="objektId"
              label="Objekt"
              breite="12rem"
              leer="alle (mandantenweit)"
              optionen={objekte.map((o) => ({
                wert: o.id,
                text: `${o.objektnummer} · ${o.bezeichnung}`,
              }))}
            />
          </Anlegen>

          <Anlegen aktion={rolleEntziehenAktion} zurueck={HIER} beschriftung="Entziehen">
            <Auswahl
              name="benutzerId"
              label="Benutzer"
              breite="14rem"
              optionen={benutzer.map((b) => ({ wert: b.id, text: b.name }))}
            />
            <Auswahl
              name="rolleId"
              label="Rolle"
              breite="14rem"
              optionen={rollen.map((r) => ({ wert: r.id, text: r.name }))}
            />
          </Anlegen>
        </section>
      )}

      {darf.benutzer && (
        <section>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.25rem' }}>Objektzuständigkeit</h2>
          <p style={{ color: '#555', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            Die zweite, unabhängige Quelle der Sichtbarkeit neben der Rolle. Wer für ein Objekt
            zuständig ist, sieht dessen Belege — auch ohne mandantenweite Rolle.
          </p>
          <Anlegen aktion={zustaendigkeitSetzenAktion} zurueck={HIER} beschriftung="Übertragen">
            <Auswahl
              name="benutzerId"
              label="Benutzer"
              breite="14rem"
              optionen={benutzer.map((b) => ({ wert: b.id, text: b.name }))}
            />
            <Auswahl
              name="objektId"
              label="Objekt"
              breite="16rem"
              optionen={objekte.map((o) => ({
                wert: o.id,
                text: `${o.objektnummer} · ${o.bezeichnung}`,
              }))}
            />
          </Anlegen>

          <Anlegen aktion={zustaendigkeitBeendenAktion} zurueck={HIER} beschriftung="Beenden">
            <Auswahl
              name="benutzerId"
              label="Benutzer"
              breite="14rem"
              optionen={benutzer.map((b) => ({ wert: b.id, text: b.name }))}
            />
            <Auswahl
              name="objektId"
              label="Objekt"
              breite="16rem"
              optionen={objekte.map((o) => ({
                wert: o.id,
                text: `${o.objektnummer} · ${o.bezeichnung}`,
              }))}
            />
          </Anlegen>
        </section>
      )}
    </Seitenrahmen>
  )
}
