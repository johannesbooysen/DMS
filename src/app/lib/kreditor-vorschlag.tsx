/**
 * Die Karte "Neuer Kreditor vorgeschlagen" -- am Arbeitsplatz zum Beleg und
 * unter Stammdaten fuer alle offenen Vorschlaege dasselbe Bauteil.
 *
 * Drei Handlungen, jede ein eigenes Formular: uebernehmen (mit den Feldern
 * zum Nachbessern), einem vorhandenen zuordnen, verwerfen. Wer keine
 * Stammdaten pflegen darf, sieht den Vorschlag und den Satz, wer ihn
 * entscheiden kann -- ein verschwundener Vorschlag waere schlimmer als ein
 * unveraenderbarer.
 */

import {
  kreditorVorschlagUebernehmenAktion,
  kreditorVorschlagVerwerfenAktion,
  kreditorVorschlagZuordnenAktion,
} from '@/app/lib/stammdaten-aktionen'
import { euro } from '@/app/lib/anzeige'
import type { Kreditorvorschlag } from '@/stammdaten/kreditor-vorschlag'

export function KreditorVorschlagKarte({
  vorschlag,
  kreditoren,
  darf,
  zurueck,
}: {
  vorschlag: Kreditorvorschlag
  kreditoren: Array<{ id: string; name: string }>
  darf: boolean
  zurueck: string
}) {
  const feld = { display: 'flex', flexDirection: 'column' as const, gap: '0.2rem', fontSize: '0.85rem' }
  return (
    <section className="karte" aria-labelledby={`vorschlag-${vorschlag.id}`} style={{ marginBottom: '0.75rem' }}>
      <h3 id={`vorschlag-${vorschlag.id}`} style={{ marginTop: 0 }}>
        Neuer Kreditor vorgeschlagen: {vorschlag.name}
      </h3>
      <p className="leise klein" style={{ marginTop: 0 }}>
        Aus dem Beleg erkannt
        {vorschlag.rechnungsnummer !== null && ` (Rechnung ${vorschlag.rechnungsnummer}`}
        {vorschlag.rechnungsnummer !== null && vorschlag.brutto !== null && `, ${euro.format(vorschlag.brutto)}`}
        {vorschlag.rechnungsnummer !== null && ')'}
        . Ein Kreditor ist ein Stammdatum: Ein Mensch prüft und gibt frei, die IBAN kommt als „neu“ herein und wird gesondert bestätigt.
        {vorschlag.gleiche > 0 && ` ${vorschlag.gleiche} weitere offene Belege nennen denselben Rechnungssteller und werden mit zugeordnet.`}
      </p>
      {!darf ? (
        <p className="meldung-hinweis klein">Entscheiden darf, wer Stammdaten pflegen darf.</p>
      ) : (
        <>
          <form action={kreditorVorschlagUebernehmenAktion} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}>
            <input type="hidden" name="vorschlagId" value={vorschlag.id} />
            <input type="hidden" name="zurueck" value={zurueck} />
            <label style={feld}>
              Name
              <input name="name" defaultValue={vorschlag.name} required style={{ width: '16rem' }} />
            </label>
            <label style={feld}>
              USt-IdNr.
              <input name="ustId" defaultValue={vorschlag.ustId ?? ''} style={{ width: '9rem' }} />
            </label>
            <label style={feld}>
              IBAN
              <input name="iban" defaultValue={vorschlag.iban ?? ''} style={{ width: '15rem' }} />
            </label>
            <label style={feld}>
              E-Mail
              <input name="email" type="email" defaultValue={vorschlag.email ?? ''} style={{ width: '13rem' }} />
            </label>
            <button type="submit" className="knopf-primaer">
              Als Kreditor anlegen und zuordnen
            </button>
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end', marginTop: '0.6rem' }}>
            {kreditoren.length > 0 && (
              <form action={kreditorVorschlagZuordnenAktion} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end' }}>
                <input type="hidden" name="vorschlagId" value={vorschlag.id} />
                <input type="hidden" name="zurueck" value={zurueck} />
                <label style={feld}>
                  Oder vorhandener Kreditor
                  <select name="kreditorId" defaultValue="">
                    <option value="" disabled>
                      — wählen —
                    </option>
                    {kreditoren.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Zuordnen</button>
              </form>
            )}
            <form action={kreditorVorschlagVerwerfenAktion}>
              <input type="hidden" name="vorschlagId" value={vorschlag.id} />
              <input type="hidden" name="zurueck" value={zurueck} />
              <button type="submit" className="knopf-link">
                Vorschlag verwerfen
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  )
}
