/**
 * Archiv: was gelöscht werden darf, und was gelöscht wurde.
 *
 * **Die Kehrseite der Aufbewahrungspflicht.** Wer aufbewahren muss, darf
 * danach nicht weiter aufbewahren — GoBD und DSGVO zeigen hier in dieselbe
 * Richtung. Bis zu dieser Seite konnte das System nur aufbewahren; die
 * Kandidatenliste gab es im Schema, aber niemand sah sie.
 *
 * **Gelöscht wird je Beleg.** Es gibt bewusst keinen Knopf „alle fälligen
 * löschen". Ein solcher wird irgendwann versehentlich gedrückt, und danach
 * gibt es nichts, worauf man zurückgreifen könnte. Das ist unbequem — und
 * das ist der Punkt.
 *
 * Die Liste steht in der Reihenfolge der Dringlichkeit: Löschansprüche
 * zuerst, denn dort wartet jemand auf eine Antwort.
 */

import {
  loeschfaellige,
  loeschprotokoll,
  type Loeschgrund,
} from '@/archiv'
import { loeschenAktion } from '@/app/lib/loeschen-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { rechtelage } from '@/stammdaten'
import { datum, Seitenrahmen } from '@/app/lib/darstellung'
import {
  Fehler,
  Handlung,
  kopfzelle,
  Marke,
  NurLesend,
  tabelle,
  zelle,
} from '@/app/lib/stammdaten-teile'

export const dynamic = 'force-dynamic'

const HIER = '/archiv'

const GRUND: Record<Loeschgrund, { text: string; farbe: string }> = {
  loeschanspruch: { text: 'Löschanspruch', farbe: 'var(--farbe-rot)' },
  fristablauf: { text: 'Frist abgelaufen', farbe: 'var(--farbe-orange)' },
}

export default async function Archiv({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler } = await searchParams

  const [darf, faellige, protokoll] = await Promise.all([
    rechtelage(benutzer),
    loeschfaellige(benutzer),
    loeschprotokoll(benutzer),
  ])

  const ansprueche = faellige.filter((f) => f.grund === 'loeschanspruch').length
  const offeneDateien = protokoll.filter((p) => p.dateiOffen).length

  return (
    <Seitenrahmen titel="Archiv und Löschung">
      <Fehler text={fehler} />
      {!darf.stammdaten && <NurLesend was="die fälligen Belege" />}

      <p className="absatz-leise">
        Belege, deren Aufbewahrungsfrist abgelaufen ist. Sie <em>dürfen</em> nicht länger
        liegen — wer aufbewahren muss, muss danach löschen. Eine Löschsperre hält einen Beleg
        darüber hinaus; solche stehen hier nicht.
      </p>

      <section className="abschnitt">
        <h2>
          Fällig zum Löschen ({faellige.length})
        </h2>
        {ansprueche > 0 && (
          <p style={{ color: 'var(--farbe-rot)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            Davon {ansprueche} mit Löschanspruch — dort wartet jemand auf eine Antwort.
          </p>
        )}

        {faellige.length === 0 ? (
          <p className="leise klein">
            Nichts fällig. Kein Beleg im Archiv hat seine Aufbewahrungsfrist hinter sich.
          </p>
        ) : (
          <>
            <table style={tabelle}>
              <thead>
                <tr>
                  <th style={kopfzelle}>Grund</th>
                  <th style={kopfzelle}>Beleg</th>
                  <th style={kopfzelle}>Objekt</th>
                  <th style={kopfzelle}>Archiviert</th>
                  <th style={kopfzelle}>Frist lief ab</th>
                  <th style={kopfzelle} />
                </tr>
              </thead>
              <tbody>
                {faellige.map((f) => (
                  <tr key={f.dokumentId}>
                    <td style={zelle}>
                      <Marke text={GRUND[f.grund].text} farbe={GRUND[f.grund].farbe} />
                    </td>
                    <td style={zelle}>{f.belegart}</td>
                    <td style={zelle}>{f.objektnummer ?? '—'}</td>
                    <td style={zelle}>
                      {f.archiviertAm === null ? '—' : datum.format(new Date(f.archiviertAm))}
                    </td>
                    <td style={zelle}>{datum.format(new Date(f.aufbewahrungBis))}</td>
                    <td style={zelle}>
                      {darf.stammdaten && (
                        <Handlung
                          aktion={loeschenAktion}
                          zurueck={HIER}
                          felder={{ id: f.dokumentId }}
                          farbe="var(--farbe-rot)"
                        >
                          endgültig löschen
                        </Handlung>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="leise winzig">
              Je Beleg, mit Absicht. Ein Knopf „alle löschen“ wird irgendwann versehentlich
              gedrückt — und danach gibt es nichts, worauf man zurückgreifen könnte. Der
              Belegtext ist hier nicht zu sehen: Wer löschen darf, muss den Inhalt nicht noch
              einmal lesen.
            </p>
          </>
        )}
      </section>

      <section>
        <h2>Gelöscht</h2>
        <p className="absatz-leise">
          Was bleibt, wenn ein Beleg geht: dass es ihn gab, wann seine Frist ablief und dass er
          gelöscht wurde — ohne personenbezogene Daten. Ohne dieses Protokoll wäre eine Lücke im
          Archiv nicht von einem Verlust zu unterscheiden.
        </p>

        {offeneDateien > 0 && (
          <p style={{ color: 'var(--farbe-orange)', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            Bei {offeneDateien} davon liegt die Datei noch im Objektspeicher. Der Worker räumt
            sie ab; bis dahin ist der Beleg gelöscht, die Datei aber noch da.
          </p>
        )}

        {protokoll.length === 0 ? (
          <p className="leise klein">Es wurde noch nichts gelöscht.</p>
        ) : (
          <table style={tabelle}>
            <thead>
              <tr>
                <th style={kopfzelle}>Gelöscht am</th>
                <th style={kopfzelle}>Grund</th>
                <th style={kopfzelle}>Frist lief ab</th>
                <th style={kopfzelle}>Durch</th>
                <th style={kopfzelle}>Datei</th>
              </tr>
            </thead>
            <tbody>
              {protokoll.map((p) => (
                <tr key={p.dokumentId}>
                  <td style={zelle}>{datum.format(new Date(p.geloeschtAm))}</td>
                  <td style={zelle}>
                    <Marke text={GRUND[p.grund].text} farbe={GRUND[p.grund].farbe} />
                  </td>
                  <td style={zelle}>{datum.format(new Date(p.aufbewahrungBis))}</td>
                  <td style={zelle}>{p.geloeschtVon ?? '—'}</td>
                  <td style={zelle}>
                    {p.dateiOffen ? (
                      <span className="orange">liegt noch</span>
                    ) : (
                      <span className="gruen">abgeräumt</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Seitenrahmen>
  )
}
