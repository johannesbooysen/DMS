/**
 * Angaben nachtragen -- das Formular der manuellen Zuordnung.
 *
 * Steht am Arbeitsplatz vor der Entscheidung, sobald Objekt oder Kreditor
 * fehlen. Serverseitig wie die uebrigen Masken; die Listen kommen unter
 * der RLS, also nur aus dem eigenen Haus.
 */

import { angabenNachtragenAktion } from '@/app/lib/aktionen'
import type { Nachtragsauswahl } from '@/belege/nachtragen'

export function Nachtragsformular({
  dokumentId,
  aufgabeId,
  auswahl,
  belegart,
  ohneObjekt,
}: {
  dokumentId: string
  aufgabeId: string
  auswahl: Nachtragsauswahl
  belegart: string
  ohneObjekt: boolean
}) {
  const rechnung = belegart !== 'schriftverkehr' && belegart !== 'sonstiges'
  return (
    <section className="karte nachtrag" aria-labelledby="nachtrag-titel">
      <h3 id="nachtrag-titel" style={{ marginTop: 0 }}>
        Angaben nachtragen
      </h3>
      <p className="leise klein" style={{ marginTop: 0 }}>
        {ohneObjekt
          ? 'Ohne Objekt hat diese Aufgabe niemanden. Was erkannt wurde, steht schon da; der Rest kommt von Hand.'
          : 'Ohne Kreditor gibt es keine Freigabe. Was erkannt wurde, steht schon da; der Rest kommt von Hand.'}
      </p>
      <form action={angabenNachtragenAktion}>
        <input type="hidden" name="dokumentId" value={dokumentId} />
        <input type="hidden" name="aufgabeId" value={aufgabeId} />
        <label className="entscheidung-feld">
          Objekt
          <select name="objektId" defaultValue="">
            <option value="">— unverändert —</option>
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
        {rechnung && (
          <>
            <label className="entscheidung-feld">
              Kreditor
              <select name="kreditorId" defaultValue="">
                <option value="">— unverändert —</option>
                {auswahl.kreditoren.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="entscheidung-feld">
              Rechnungsnummer
              <input name="rechnungsnummer" maxLength={80} />
            </label>
            <label className="entscheidung-feld">
              Rechnungsdatum
              <input name="rechnungsdatum" type="date" />
            </label>
            <label className="entscheidung-feld">
              Brutto (EUR)
              <input name="brutto" inputMode="decimal" placeholder="z. B. 1.240,00" />
            </label>
          </>
        )}
        <button type="submit" className="knopf-primaer" style={{ marginTop: '0.5rem' }}>
          Angaben übernehmen
        </button>
      </form>
    </section>
  )
}
