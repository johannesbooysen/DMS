/**
 * Das Stufenformular -- eine Zeile je Stufe, beim Anlegen wie beim Aendern.
 *
 * Was im abzuloesenden System ueber dreissig Stempel mit Zielmagneten verteilt
 * ist, steht hier in einer Zeile: wer (Zustaendigkeit), womit (Stempel), ab
 * welchem Betrag, mit welcher Frist. Wohin es danach geht, steht **nicht**
 * hier -- das leitet die Engine aus der Reihenfolge ab (Konzept 8).
 *
 * Serverseitig, wie die uebrigen Masken. Die Zustaendigkeit ist ein
 * Auswahlfeld plus drei Listen (Rolle, Gruppe, Spezialgebiet); welche davon
 * gilt, entscheidet der Server anhand des Typs -- ohne Skript, das Felder
 * ein- und ausblendet.
 */

import type { Stufe } from '@/workflow/baum'
import {
  STUFENTYP_NAMEN,
  STUFENTYPEN,
  ZUSTAENDIGKEIT_NAMEN,
  ZUSTAENDIGKEITEN,
  type Auswahl,
} from '@/workflow/stufen'
import { EMPFAENGERART_NAMEN, EMPFAENGERARTEN } from '@/workflow/systemaktion'

const ENTSCHEIDUNG: Record<string, string> = {
  freigabe: 'schließt ab',
  ablehnung: 'lehnt ab',
  rueckgabe: 'gibt zurück',
  klaerung: 'Klärung',
  systemaktion: 'System',
}

export function Stufenformular({
  aktion,
  definitionId,
  auswahl,
  stufe = null,
  stempel = [],
  behaelter = [],
  beschriftung,
}: {
  aktion: (f: FormData) => Promise<void>
  definitionId: string
  auswahl: Auswahl
  /** Beim Aendern die bestehende Stufe; beim Anlegen null. */
  stufe?: Stufe | null
  /** Die Stempel, die der Stufe heute zugeordnet sind. */
  stempel?: string[]
  /** Beim Anlegen: die Behaelter, unter die die Stufe kommen kann. */
  behaelter?: Array<{ id: string; name: string }>
  beschriftung: string
}) {
  const ref = stufe?.zustaendigkeitRef ?? ''
  return (
    <form action={aktion} className="stufenformular">
      <input type="hidden" name="definitionId" value={definitionId} />
      {stufe !== null && <input type="hidden" name="stufeId" value={stufe.id} />}

      <div className="filterzeile" style={{ marginBottom: '0.5rem' }}>
        <label className="feld">
          Bezeichnung
          <input name="bezeichnung" required maxLength={80} defaultValue={stufe?.bezeichnung ?? ''} style={{ width: '14rem' }} />
        </label>
        <label className="feld">
          Art
          <select name="stufentyp" defaultValue={stufe?.stufentyp ?? 'sachlich'}>
            {STUFENTYPEN.map((t) => (
              <option key={t} value={t}>
                {STUFENTYP_NAMEN[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="feld">
          Zuständig
          <select name="zustaendigkeitTyp" defaultValue={stufe?.zustaendigkeitTyp ?? 'objektverantwortlich'}>
            {ZUSTAENDIGKEITEN.map((z) => (
              <option key={z} value={z}>
                {ZUSTAENDIGKEIT_NAMEN[z]}
              </option>
            ))}
          </select>
        </label>
        <label className="feld">
          Rolle, Gruppe oder Spezialgebiet
          <select name="zustaendigkeitRef" defaultValue={ref}>
            <option value="">— nur bei Rolle, Gruppe, Spezialgebiet —</option>
            <optgroup label="Rollen">
              {auswahl.rollen.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Gruppen">
              {auswahl.gruppen.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Spezialgebiete">
              {auswahl.spezialgebiete.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="feld">
          Betrag ab (EUR)
          <input name="betragVon" type="number" step="0.01" min="0" defaultValue={stufe?.betragVon ?? ''} style={{ width: '7rem' }} />
        </label>
        <label className="feld">
          Frist (Stunden)
          <input name="slaStunden" type="number" step="1" min="1" defaultValue={stufe?.slaStunden ?? ''} style={{ width: '6rem' }} />
        </label>
        <label className="klein" style={{ paddingBottom: '0.5rem' }}>
          <input type="checkbox" name="pflicht" value="ja" defaultChecked={stufe?.pflicht ?? true} /> Pflicht
        </label>
      </div>

      {/* Eskalation: Spanne ueber der Frist und die Person, die die Aufgabe
          dann bekommt -- beides oder nichts. Rechte wandern nicht mit. */}
      <div className="filterzeile" style={{ marginBottom: '0.5rem' }}>
        <label className="feld">
          Eskalation nach (Stunden über der Frist)
          <input name="eskalationNachStunden" type="number" step="1" min="1" defaultValue={stufe?.eskalationNachStunden ?? ''} style={{ width: '6rem' }} />
        </label>
        <label className="feld">
          Eskalation an
          <select name="eskalationAn" defaultValue={stufe?.eskalationAn ?? ''}>
            <option value="">— niemand —</option>
            {auswahl.benutzer.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Nur fuer die Art "Systemaktion" gelesen; steht trotzdem immer da,
          weil es kein Skript gibt, das Felder ein- und ausblendet. */}
      <fieldset style={{ border: '1px solid var(--farbe-linie)', borderRadius: 'var(--radius)', margin: '0 0 0.5rem', padding: '0.5rem 0.75rem' }}>
        <legend className="klein leise">Systemaktion — nur bei Art „Systemaktion“</legend>
        <div className="filterzeile" style={{ marginBottom: 0 }}>
          <label className="feld">
            Vorlage
            <select name="saVorlage" defaultValue={stufe?.systemaktion?.vorlage ?? ''}>
              <option value="">— Vorlage wählen —</option>
              {auswahl.vorlagen.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="feld">
            Empfänger
            <select name="saEmpfaenger" defaultValue={stufe?.systemaktion?.empfaenger ?? 'adresse'}>
              {EMPFAENGERARTEN.map((e) => (
                <option key={e} value={e}>
                  {EMPFAENGERART_NAMEN[e]}
                </option>
              ))}
            </select>
          </label>
          <label className="feld">
            Feste Adresse
            <input name="saAdresse" type="email" maxLength={200} defaultValue={stufe?.systemaktion?.adresse ?? ''} style={{ width: '16rem' }} />
          </label>
        </div>
      </fieldset>

      <fieldset style={{ border: '1px solid var(--farbe-linie)', borderRadius: 'var(--radius)', margin: '0 0 0.5rem', padding: '0.5rem 0.75rem' }}>
        <legend className="klein leise">Stempel an dieser Stufe</legend>
        <div className="reihe">
          {auswahl.stempeltypen.map((t) => (
            <label key={t.id} className="klein">
              <input type="checkbox" name="stempeltypId" value={t.id} defaultChecked={stempel.includes(t.id)} /> {t.name}
              <span className="leise"> · {ENTSCHEIDUNG[t.entscheidung] ?? t.entscheidung}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="filterzeile" style={{ marginBottom: 0 }}>
        {behaelter.length > 1 && (
          <label className="feld">
            Einhängen unter
            <select name="elternId" defaultValue={behaelter[0]?.id ?? ''}>
              {behaelter.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {behaelter.length === 1 && <input type="hidden" name="elternId" value={behaelter[0]?.id ?? ''} />}
        <button type="submit" className="knopf-primaer">
          {beschriftung}
        </button>
      </div>
    </form>
  )
}
