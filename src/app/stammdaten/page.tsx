/**
 * Stammdaten — Objekte, Kreditoren, Konten, Zahlungswege, Gruppen, Fristen.
 *
 * Bis hierher waren das alles nur Tabellen: Sie ließen sich ausschließlich
 * per SQL anlegen. Damit konnte niemand außer einem Entwickler das System
 * einrichten — der größte einzelne Posten zwischen dem Stand und dem ersten
 * Echtbeleg.
 *
 * **Alles auf einer Seite und nicht sechs.** Wer ein Objekt einrichtet,
 * braucht im selben Zug einen Zahlungsweg und eine Ordnungsgruppe; über
 * sechs Unterseiten verteilt wäre das sechsmal Hin und Her. Die Abschnitte
 * stehen in der Reihenfolge, in der man sie bei der Ersteinrichtung braucht.
 *
 * Benutzer und Rollen stehen bewusst **nicht** hier: Sie brauchen ein
 * anderes Recht (`benutzer_verwalten`), weil daraus jedes weitere folgt.
 */

import Link from 'next/link'
import {
  fristenLaden,
  kontenLaden,
  kreditorenLaden,
  objekteLaden,
  ordnungsgruppenLaden,
  rechtelage,
  zahlungswegeLaden,
} from '@/stammdaten'
import {
  bankverbindungAnlegenAktion,
  bankverbindungEntscheidenAktion,
  fristSetzenAktion,
  kontoAnlegenAktion,
  kontoUmschaltenAktion,
  kreditorAnlegenAktion,
  objektAnlegenAktion,
  ordnungsgruppeAnlegenAktion,
  ordnungsgruppeUmschaltenAktion,
  zahlungswegAnlegenAktion,
  zahlungswegUmschaltenAktion,
} from '@/app/lib/stammdaten-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { euro, Seitenrahmen } from '@/app/lib/darstellung'
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

const HIER = '/stammdaten'

const VERWALTUNGSART = [
  { wert: 'weg', text: 'WEG' },
  { wert: 'miet', text: 'Mietverwaltung' },
  { wert: 'se', text: 'Sondereigentum' },
]

const ZAHLUNGSART = [
  { wert: 'mail', text: 'Mail an die Bank' },
  { wert: 'datei_export', text: 'Dateiexport' },
  { wert: 'extern', text: 'Externes System' },
  { wert: 'lastschrift', text: 'Lastschrift' },
]

const BELEGART = [
  { wert: 'rechnung', text: 'Rechnung' },
  { wert: 'gutschrift', text: 'Gutschrift' },
  { wert: 'mahnung', text: 'Mahnung' },
  { wert: 'schriftverkehr', text: 'Schriftverkehr' },
  { wert: 'sonstiges', text: 'Sonstiges' },
]

const IBAN_MARKE: Record<string, string> = {
  verifiziert: '#2F6F4E',
  neu: '#8A6D1F',
  gesperrt: '#B3271E',
}

function Abschnitt({ titel, hinweis, children }: {
  titel: string
  hinweis?: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.25rem' }}>{titel}</h2>
      {hinweis !== undefined && (
        <p style={{ color: '#555', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{hinweis}</p>
      )}
      {children}
    </section>
  )
}

export default async function Stammdaten({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler } = await searchParams

  const [darf, objekte, kreditoren, konten, wege, gruppen, fristen] = await Promise.all([
    rechtelage(benutzer),
    objekteLaden(benutzer),
    kreditorenLaden(benutzer),
    kontenLaden(benutzer),
    zahlungswegeLaden(benutzer),
    ordnungsgruppenLaden(benutzer),
    fristenLaden(benutzer),
  ])

  return (
    <Seitenrahmen titel="Stammdaten">
      <Fehler text={fehler} />
      {!darf.stammdaten && <NurLesend was="die Stammdaten" />}

      <p style={{ color: '#555', fontSize: '0.85rem', marginTop: 0 }}>
        {darf.benutzer ? (
          <>
            Benutzer und Rollen stehen unter{' '}
            <Link href="/stammdaten/benutzer">Benutzer und Rollen</Link> — sie brauchen ein
            eigenes Recht.
          </>
        ) : (
          'Benutzer und Rollen brauchen ein eigenes Recht und stehen deshalb nicht hier.'
        )}
      </p>

      <Abschnitt
        titel="Objekte"
        hinweis="Objekte werden nie gelöscht — an ihnen hängen archivierte Belege. Wer ein Objekt abgibt, beendet die Zuständigkeiten."
      >
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Nummer</th>
              <th style={kopfzelle}>Bezeichnung</th>
              <th style={kopfzelle}>Art</th>
              <th style={kopfzelle}>Eskalation ab</th>
              <th style={kopfzelle}>Zuständig</th>
            </tr>
          </thead>
          <tbody>
            {objekte.length === 0 && (
              <tr>
                <td style={zelle} colSpan={5}>
                  Noch kein Objekt. Ohne mindestens eines lässt sich kein Beleg zuordnen.
                </td>
              </tr>
            )}
            {objekte.map((o) => (
              <tr key={o.id}>
                <td style={zelle}>{o.objektnummer}</td>
                <td style={zelle}>
                  {o.bezeichnung}
                  {o.adresse !== null && (
                    <span style={{ color: '#777' }}> · {o.adresse}</span>
                  )}
                </td>
                <td style={zelle}>
                  {VERWALTUNGSART.find((v) => v.wert === o.verwaltungsart)?.text ??
                    o.verwaltungsart}
                </td>
                <td style={zelle}>
                  {o.eskalationsgrenze === null ? '—' : euro.format(o.eskalationsgrenze)}
                </td>
                <td style={zelle}>
                  {o.zustaendige.length === 0 ? (
                    <span style={{ color: '#B3271E' }}>niemand</span>
                  ) : (
                    o.zustaendige.join(', ')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {darf.stammdaten && (
          <Anlegen aktion={objektAnlegenAktion} zurueck={HIER}>
            <Eingabe name="objektnummer" label="Nummer" breite="6rem" pflicht />
            <Eingabe name="bezeichnung" label="Bezeichnung" breite="14rem" pflicht />
            <Eingabe name="adresse" label="Adresse" breite="14rem" />
            <Auswahl name="verwaltungsart" label="Art" optionen={VERWALTUNGSART} breite="9rem" />
            <Eingabe name="eskalationsgrenze" label="Eskalation ab (€)" breite="8rem" />
          </Anlegen>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Kreditoren und Bankverbindungen"
        hinweis="Eine Bankverbindung zu bestätigen heißt zu erklären: Ich habe geprüft, dass dieses Konto zu diesem Kreditor gehört. Die Datenbank hält fest, wer das war."
      >
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Kreditor</th>
              <th style={kopfzelle}>Bankverbindungen</th>
            </tr>
          </thead>
          <tbody>
            {kreditoren.length === 0 && (
              <tr>
                <td style={zelle} colSpan={2}>
                  Noch kein Kreditor. Sie entstehen auch von selbst, sobald ein Beleg
                  eingeht und zugeordnet wird.
                </td>
              </tr>
            )}
            {kreditoren.map((k) => (
              <tr key={k.id}>
                <td style={{ ...zelle, whiteSpace: 'nowrap' }}>
                  {k.name}
                  {k.status !== 'aktiv' && (
                    <>
                      {' '}
                      <Marke text={k.status} farbe="#B3271E" />
                    </>
                  )}
                </td>
                <td style={zelle}>
                  {k.banken.length === 0 && <span style={{ color: '#777' }}>keine</span>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {k.banken.map((b) => (
                      <div key={b.id} style={{ alignItems: 'baseline', display: 'flex', gap: '0.6rem' }}>
                        <code style={{ fontSize: '0.82rem' }}>{b.iban}</code>
                        <Marke text={b.status} farbe={IBAN_MARKE[b.status] ?? '#555'} />
                        {b.bestaetigtVon !== null && (
                          <span style={{ color: '#777', fontSize: '0.75rem' }}>
                            {b.bestaetigtVon}, {b.bestaetigtAm}
                          </span>
                        )}
                        {darf.stammdaten && b.status !== 'verifiziert' && (
                          <Handlung
                            aktion={bankverbindungEntscheidenAktion}
                            zurueck={HIER}
                            felder={{ id: b.id, entscheidung: 'verifizieren' }}
                            farbe="#2F6F4E"
                          >
                            bestätigen
                          </Handlung>
                        )}
                        {darf.stammdaten && b.status !== 'gesperrt' && (
                          <Handlung
                            aktion={bankverbindungEntscheidenAktion}
                            zurueck={HIER}
                            felder={{ id: b.id, entscheidung: 'sperren' }}
                            farbe="#B3271E"
                          >
                            sperren
                          </Handlung>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {darf.stammdaten && (
          <>
            <Anlegen aktion={kreditorAnlegenAktion} zurueck={HIER} beschriftung="Kreditor anlegen">
              <Eingabe name="name" label="Name" breite="18rem" pflicht />
            </Anlegen>
            {kreditoren.length > 0 && (
              <Anlegen
                aktion={bankverbindungAnlegenAktion}
                zurueck={HIER}
                beschriftung="IBAN hinzufügen"
              >
                <Auswahl
                  name="kreditorId"
                  label="Kreditor"
                  breite="14rem"
                  optionen={kreditoren.map((k) => ({ wert: k.id, text: k.name }))}
                />
                <Eingabe name="iban" label="IBAN" breite="18rem" pflicht />
              </Anlegen>
            )}
          </>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Konten"
        hinweis="Nur deaktivierbar, nie löschbar: An einem Konto hängen die Kontierungszeilen archivierter Belege."
      >
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Nummer</th>
              <th style={kopfzelle}>Bezeichnung</th>
              <th style={kopfzelle}>Umlagefähig</th>
              <th style={kopfzelle}>Rahmen</th>
              <th style={kopfzelle} />
            </tr>
          </thead>
          <tbody>
            {konten.map((k) => (
              <tr key={k.id} style={k.aktiv ? undefined : { color: '#999' }}>
                <td style={zelle}>{k.nummer}</td>
                <td style={zelle}>{k.bezeichnung}</td>
                <td style={zelle}>{k.umlagefaehig ? 'ja' : 'nein'}</td>
                <td style={zelle}>{k.rahmen}</td>
                <td style={zelle}>
                  {darf.stammdaten && (
                    <Handlung
                      aktion={kontoUmschaltenAktion}
                      zurueck={HIER}
                      felder={{ id: k.id }}
                    >
                      {k.aktiv ? 'deaktivieren' : 'aktivieren'}
                    </Handlung>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {darf.stammdaten && (
          <Anlegen aktion={kontoAnlegenAktion} zurueck={HIER}>
            <Eingabe name="nummer" label="Kontonummer" breite="8rem" pflicht />
            <Eingabe name="bezeichnung" label="Bezeichnung" breite="16rem" pflicht />
            <Auswahl
              name="umlagefaehig"
              label="Umlagefähig"
              breite="7rem"
              optionen={[
                { wert: 'nein', text: 'nein' },
                { wert: 'ja', text: 'ja' },
              ]}
            />
          </Anlegen>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Zahlungswege"
        hinweis="Ohne aktiven Zahlungsweg lässt sich kein Beleg zur Zahlung übergeben."
      >
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Name</th>
              <th style={kopfzelle}>Art</th>
              <th style={kopfzelle} />
            </tr>
          </thead>
          <tbody>
            {wege.map((w) => (
              <tr key={w.id} style={w.aktiv ? undefined : { color: '#999' }}>
                <td style={zelle}>{w.name}</td>
                <td style={zelle}>
                  {ZAHLUNGSART.find((a) => a.wert === w.art)?.text ?? w.art}
                </td>
                <td style={zelle}>
                  {darf.stammdaten && (
                    <Handlung
                      aktion={zahlungswegUmschaltenAktion}
                      zurueck={HIER}
                      felder={{ id: w.id }}
                    >
                      {w.aktiv ? 'deaktivieren' : 'aktivieren'}
                    </Handlung>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {darf.stammdaten && (
          <Anlegen aktion={zahlungswegAnlegenAktion} zurueck={HIER}>
            <Eingabe name="name" label="Name" breite="14rem" pflicht />
            <Auswahl name="art" label="Art" optionen={ZAHLUNGSART} breite="12rem" />
          </Anlegen>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Ordnungsgruppen"
        hinweis="Nur deaktivierbar, nie löschbar — sie tragen die Sichtbarkeit archivierter Belege."
      >
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Name</th>
              <th style={kopfzelle}>Farbe</th>
              <th style={kopfzelle} />
            </tr>
          </thead>
          <tbody>
            {gruppen.map((g) => (
              <tr key={g.id} style={g.aktiv ? undefined : { color: '#999' }}>
                <td style={zelle}>{g.name}</td>
                <td style={zelle}>
                  {g.farbe === null ? (
                    '—'
                  ) : (
                    <span style={{ alignItems: 'center', display: 'flex', gap: '0.4rem' }}>
                      <span
                        aria-hidden="true"
                        style={{
                          background: g.farbe,
                          borderRadius: '2px',
                          display: 'inline-block',
                          height: '0.8rem',
                          width: '0.8rem',
                        }}
                      />
                      {g.farbe}
                    </span>
                  )}
                </td>
                <td style={zelle}>
                  {darf.stammdaten && (
                    <Handlung
                      aktion={ordnungsgruppeUmschaltenAktion}
                      zurueck={HIER}
                      felder={{ id: g.id }}
                    >
                      {g.aktiv ? 'deaktivieren' : 'aktivieren'}
                    </Handlung>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {darf.stammdaten && (
          <Anlegen aktion={ordnungsgruppeAnlegenAktion} zurueck={HIER}>
            <Eingabe name="name" label="Name" breite="14rem" pflicht />
            <Eingabe name="kurzcode" label="Kurzcode" breite="6rem" pflicht />
            <Eingabe name="farbe" label="Farbe" breite="7rem" typ="color" wert="#3B4A80" />
          </Anlegen>
        )}
      </Abschnitt>

      <Abschnitt
        titel="Aufbewahrungsfristen"
        hinweis="Ohne Eintrag gelten zehn Jahre. Eine fehlende Konfiguration darf nie zu einer kürzeren Frist führen — deshalb die längere als Vorgabe."
      >
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Belegart</th>
              <th style={kopfzelle}>Jahre</th>
              <th style={kopfzelle}>Grund</th>
            </tr>
          </thead>
          <tbody>
            {fristen.length === 0 && (
              <tr>
                <td style={zelle} colSpan={3}>
                  Keine hinterlegt — es gelten überall zehn Jahre ab Jahresende (§ 147 AO).
                </td>
              </tr>
            )}
            {fristen.map((f) => (
              <tr key={f.id}>
                <td style={zelle}>
                  {BELEGART.find((b) => b.wert === f.belegart)?.text ?? f.belegart}
                </td>
                <td style={zelle}>{f.jahre}</td>
                <td style={zelle}>{f.grund}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {darf.stammdaten && (
          <Anlegen aktion={fristSetzenAktion} zurueck={HIER} beschriftung="Frist festlegen">
            <Auswahl name="belegart" label="Belegart" optionen={BELEGART} breite="12rem" />
            <Eingabe name="jahre" label="Jahre" breite="5rem" pflicht />
            <Eingabe name="grund" label="Begründung" breite="20rem" pflicht />
          </Anlegen>
        )}
      </Abschnitt>
    </Seitenrahmen>
  )
}
