/**
 * Posteingang.
 *
 * Die Tür, die bisher fehlte: `dokumentAufnehmen` gab es schon, aber
 * außerhalb eines Demoskripts rief es niemand auf — es gab keinen Weg, einen
 * Beleg ins System zu bringen.
 *
 * Zwei Wege, und die Unterscheidung ist eine Entscheidung des Menschen, nicht
 * eine Erkennung: Ein einzelner Beleg geht direkt in den Lauf. Ein Stapel aus
 * dem Scanner geht zuerst in die Trennung — dort ist noch nichts geschrieben,
 * was zurückgenommen werden müsste (Konzept 24.1).
 */

import { eigeneEingaenge } from '@/belege/liste'
import { alsBenutzer } from '@/db'
import { offeneStapel } from '@/stapel'
import { Ablagezone } from '@/app/lib/ablagezone'
import { angabenNachtragenAktion } from '@/app/lib/aktionen'
import { postAufnehmenAktion } from '@/app/lib/posteingang-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Ampel, belegBezeichnung, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'
import { KreditorVorschlagKarte } from '@/app/lib/kreditor-vorschlag'
import { nachtragsauswahl } from '@/belege/nachtragen'
import { rechtelage } from '@/stammdaten'
import { vorschlaegeLaden } from '@/stammdaten/kreditor-vorschlag'

/** Wo ein frisch aufgenommener Beleg gerade steht -- in Worten. */
const STAND: Record<string, string> = {
  in_aufbereitung: 'wird aufbereitet',
  laufend: 'im Ablauf',
  wartend: 'wartet',
  abgeschlossen: 'abgeschlossen',
  archiviert: 'archiviert',
  abgelehnt: 'abgelehnt',
  storniert: 'storniert',
}

export const dynamic = 'force-dynamic'

export default async function Posteingang({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; hinweis?: string }>
}) {
  const { fehler, hinweis } = await searchParams
  const benutzer = await angemeldeterBenutzer()
  const stapel = await offeneStapel(benutzer)
  // Die Rueckmeldung: Was man selbst hereingebracht hat, und wo es steht.
  // Ohne sie verschwindet ein Upload in der Warteschlange, und die Frage
  // "ist er angekommen?" fuehrt in die Belegsuche.
  const alleEingaenge = await alsBenutzer(benutzer, (c) => eigeneEingaenge(c, benutzer, 20))
  // Erkannte, aber unbekannte Rechnungssteller -- gleich in der Zeile, mit
  // der Seitenmaske zum Anlegen. Die Listen fuer die Maske kommen unter der
  // RLS, wie am Arbeitsplatz.
  const [vorschlaege, darf, auswahl] = await Promise.all([
    vorschlaegeLaden(benutzer),
    rechtelage(benutzer),
    nachtragsauswahl(benutzer),
  ])
  const vorschlagJeBeleg = new Map(vorschlaege.map((v) => [v.dokumentId, v]))
  const HIER = '/posteingang'

  /*
   * Zwei Listen aus einer: Was noch etwas vom Einliefernden braucht, steht in
   * der Tabelle -- in Aufbereitung, ohne Objekt, ohne Kreditor (bei einer
   * Rechnung), abgewiesen oder storniert. Was zugeordnet ist und laeuft,
   * liegt bei seinem Bearbeiter; hier bleibt davon nur ein Satz mit Link.
   * Beim Bedienen gefragt: "Warum ist der Beleg noch im Posteingang?" --
   * weil die Liste die Eingangshistorie war, und die sah aus wie eine
   * Warteschlange.
   */
  const brauchtRechnungsdaten = (belegart: string) => ['rechnung', 'gutschrift', 'mahnung'].includes(belegart)
  const nochBeiMir = (z: (typeof alleEingaenge)[number]) =>
    z.status !== 'laufend' || z.objektnummer === null || (brauchtRechnungsdaten(z.belegart) && z.kreditor === null)
  const eingaenge = alleEingaenge.filter(nochBeiMir)
  const weitergegeben = alleEingaenge.filter((z) => !nochBeiMir(z))

  return (
    <Seitenrahmen titel="Posteingang">
      {fehler !== undefined && (
        <p role="alert" className="meldung-fehler">
          {fehler}
        </p>
      )}
      {hinweis !== undefined && (
        <p role="status" className="meldung-hinweis">
          {hinweis}
        </p>
      )}

      <form action={postAufnehmenAktion} className="karte filterzeile" style={{ marginTop: 0 }}>
        <Ablagezone accept="application/pdf,image/*,message/rfc822" />

        <label className="klein">
          <input type="checkbox" name="stapel" value="ja" /> Stapelscan — enthält mehrere Belege
        </label>

        <button type="submit" className="knopf-primaer">
          Aufnehmen
        </button>
      </form>

      <p className="leise klein">
        Ein einzelner Beleg geht sofort in den Ablauf. Ein Stapelscan wird erst getrennt und
        geprüft — bis zur Übernahme entsteht kein Dokument. Mehrere Dateien auf einmal: jede wird
        ein eigener Beleg (oder ein eigener Stapel).
      </p>

      <h2>Zuletzt aufgenommen</h2>
      <p className="leise klein" style={{ marginTop: 0 }}>
        Hier steht, was noch etwas von Ihnen braucht: in Aufbereitung, ohne Objekt, ohne Kreditor oder
        abgewiesen. Was zugeordnet ist, liegt bei seinem Bearbeiter und verschwindet hier.
        {weitergegeben.length > 0 && (
          <>
            {' '}
            {weitergegeben.length === 1
              ? 'Ein Beleg ist im Ablauf und liegt bei seinem Bearbeiter'
              : `${weitergegeben.length} Belege sind im Ablauf und liegen bei ihren Bearbeitern`}
            :{' '}
            {weitergegeben.map((z, i) => (
              <span key={z.id}>
                {i > 0 && ', '}
                <a href={`/beleg/${z.id}`}>{belegBezeichnung(z)}</a>
              </span>
            ))}
            .
          </>
        )}
      </p>

      {eingaenge.length === 0 ? (
        <p className="leise">
          {weitergegeben.length === 0 ? 'Noch nichts über diesen Posteingang aufgenommen.' : 'Nichts wartet auf Sie.'}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Beleg</th>
              <th>Objekt</th>
              <th className="rechts">Betrag</th>
              <th>Eingang</th>
              <th>Stand</th>
              <th>Kreditor</th>
            </tr>
          </thead>
          <tbody>
            {eingaenge.map((z) => {
              const vorschlag = vorschlagJeBeleg.get(z.id)
              return (
                <tr key={z.id}>
                  <td>
                    <Ampel wert={z.ampel} /> <a href={`/beleg/${z.id}`}>{belegBezeichnung(z)}</a>
                  </td>
                  <td>
                    {z.objektnummer ?? (z.status === 'abgelehnt' || z.status === 'storniert' ? (
                      <span className="leise">—</span>
                    ) : (
                      <>
                        <span className="marke marke--neu">ohne Objekt</span>{' '}
                        <button type="button" className="winzig" popoverTarget={`objekt-${z.id}`}>
                          Zuordnen …
                        </button>
                        <div id={`objekt-${z.id}`} popover="auto" className="seitenmaske">
                          <button type="button" className="winzig seitenmaske-schliessen" popoverTarget={`objekt-${z.id}`} popoverTargetAction="hide">
                            Schließen
                          </button>
                          <section className="karte" aria-labelledby={`objekt-titel-${z.id}`}>
                            <h3 id={`objekt-titel-${z.id}`} style={{ marginTop: 0 }}>
                              Objekt zuordnen: {belegBezeichnung(z)}
                            </h3>
                            <p className="leise klein" style={{ marginTop: 0 }}>
                              Kein Merkmal im Beleg passte zu einem Objekt. Wer hier zuordnet, bringt dem System
                              Kundennummer, Vertrags- oder Zählernummer aus dem Beleg bei — beim nächsten Beleg dieses
                              Absenders geht es von selbst.
                            </p>
                            <form action={angabenNachtragenAktion}>
                              <input type="hidden" name="dokumentId" value={z.id} />
                              <input type="hidden" name="zurueck" value={HIER} />
                              <label className="entscheidung-feld">
                                Objekt
                                <select name="objektId" defaultValue="" required>
                                  <option value="" disabled>
                                    — wählen —
                                  </option>
                                  {auswahl.objekte.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.objektnummer} — {o.bezeichnung}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="entscheidung-feld">
                                Ordnungsgruppe
                                <select name="ordnungsgruppeId" defaultValue="">
                                  <option value="">— unverändert —</option>
                                  {auswahl.gruppen.map((g) => (
                                    <option key={g.id} value={g.id}>
                                      {g.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button type="submit" className="knopf-primaer" style={{ marginTop: '0.5rem' }}>
                                Objekt zuordnen
                              </button>
                            </form>
                          </section>
                        </div>
                      </>
                    ))}
                  </td>
                  <td className="rechts">{z.brutto === null ? '—' : euro.format(z.brutto)}</td>
                  <td>{datum.format(new Date(z.eingangAm))}</td>
                  <td>
                    <span className={`eingangsstand eingangsstand--${z.status}`}>{STAND[z.status] ?? z.status}</span>
                  </td>
                  <td>
                    {/*
                      Ein erkannter, aber unbekannter Rechnungssteller steht
                      gleich hier in der Zeile, und ein Klick oeffnet die
                      Seitenmaske zum Anlegen. Native \`popover\`: kein
                      Browsercode, dieselbe Karte wie unter Stammdaten.
                    */}
                    {z.kreditor !== null ? (
                      z.kreditor
                    ) : vorschlag !== undefined ? (
                      <>
                        <span className="marke marke--neu">Neu: {vorschlag.name}</span>{' '}
                        <button type="button" className="winzig" popoverTarget={`vorschlag-${vorschlag.id}`}>
                          {darf.stammdaten ? 'Anlegen …' : 'Ansehen …'}
                        </button>
                        <div id={`vorschlag-${vorschlag.id}`} popover="auto" className="seitenmaske">
                          <button type="button" className="winzig seitenmaske-schliessen" popoverTarget={`vorschlag-${vorschlag.id}`} popoverTargetAction="hide">
                            Schließen
                          </button>
                          <KreditorVorschlagKarte vorschlag={vorschlag} kreditoren={auswahl.kreditoren} darf={darf.stammdaten} zurueck={HIER} />
                        </div>
                      </>
                    ) : (
                      <span className="leise">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <h2>Stapel in Prüfung</h2>

      {stapel.length === 0 ? (
        <p className="leise">Kein Stapel wartet auf Prüfung.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Datei</th>
              <th>Eingang</th>
              <th>Seiten</th>
              <th>Erkannte Belege</th>
            </tr>
          </thead>
          <tbody>
            {stapel.map((s) => (
              <tr key={s.stapelId}>
                <td>
                  <a href={`/posteingang/${s.stapelId}`}>{s.dateiname}</a>
                  <span className="leise klein"> · {s.eingangskanal}</span>
                </td>
                <td>{datum.format(new Date(s.eingangAm))}</td>
                <td>{s.seitenzahl}</td>
                <td>{s.belege}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seitenrahmen>
  )
}
