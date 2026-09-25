/**
 * Angaben nachtragen -- das Formular der manuellen Zuordnung.
 *
 * Steht am Arbeitsplatz vor der Entscheidung, sobald Objekt oder Kreditor
 * fehlen. Serverseitig wie die uebrigen Masken; die Listen kommen unter
 * der RLS, also nur aus dem eigenen Haus.
 *
 * Die Pflichtfelder des Hauses (Stammdatum `pflichtfeld`) sind gekennzeichnet,
 * und es steht dabei, welche noch fehlen. Alles andere liegt unter "Weitere
 * Angaben" -- wer nur Objekt und Kreditor setzen will, sieht nicht dreizehn
 * Felder.
 *
 * Darunter: die Erkennung noch einmal anstossen -- oder der Satz, dass
 * keine eingerichtet ist. Die Frage "warum wird das nicht automatisch
 * ausgelesen" soll die Seite beantworten, nicht das Handbuch.
 */

import { angabenNachtragenAktion, aufbereitungErneutAktion } from '@/app/lib/aktionen'
import type { Nachtragsauswahl } from '@/belege/nachtragen'
import type { Feldname } from '@/extraktion/typen'
import { FELDER } from '@/stammdaten/pflichtfeld'

const BESCHRIFTUNG = new Map<Feldname, string>(FELDER.map((f) => [f.name, f.label]))

/** Die Eingabefelder der Rechnungsfakten, wie sie im Formular heissen. */
const FAKTEN: ReadonlyArray<{ feld: Feldname; name: string; typ: 'text' | 'date' | 'betrag' | 'prozent' }> = [
  { feld: 'rechnungsnummer', name: 'rechnungsnummer', typ: 'text' },
  { feld: 'rechnungsdatum', name: 'rechnungsdatum', typ: 'date' },
  { feld: 'brutto', name: 'brutto', typ: 'betrag' },
  { feld: 'netto', name: 'netto', typ: 'betrag' },
  { feld: 'steuer', name: 'steuer', typ: 'betrag' },
  { feld: 'leistung_von', name: 'leistungVon', typ: 'date' },
  { feld: 'leistung_bis', name: 'leistungBis', typ: 'date' },
  { feld: 'iban_im_beleg', name: 'ibanImBeleg', typ: 'text' },
  { feld: 'zahlungsziel', name: 'zahlungsziel', typ: 'date' },
  { feld: 'skonto_prozent', name: 'skontoProzent', typ: 'prozent' },
  { feld: 'skonto_bis', name: 'skontoBis', typ: 'date' },
]

/** Die drei, die immer vorn stehen -- auch wenn das Haus sie nicht verlangt. */
const IMMER_VORN: readonly Feldname[] = ['rechnungsnummer', 'rechnungsdatum', 'brutto']

function Feld({
  eintrag,
  pflicht,
  fehlt,
}: {
  eintrag: (typeof FAKTEN)[number]
  pflicht: boolean
  fehlt: boolean
}) {
  const label = BESCHRIFTUNG.get(eintrag.feld) ?? eintrag.feld
  return (
    <label className="entscheidung-feld">
      {label}
      {pflicht && (
        <span className={`klein ${fehlt ? 'rot' : 'leise'}`}> {fehlt ? '— fehlt noch' : '— Pflicht, vorhanden'}</span>
      )}
      {eintrag.typ === 'date' ? (
        <input name={eintrag.name} type="date" />
      ) : eintrag.typ === 'betrag' ? (
        <input name={eintrag.name} inputMode="decimal" placeholder="z. B. 1.240,00" />
      ) : eintrag.typ === 'prozent' ? (
        <input name={eintrag.name} inputMode="decimal" placeholder="z. B. 2" />
      ) : (
        <input name={eintrag.name} maxLength={eintrag.feld === 'iban_im_beleg' ? 34 : 80} />
      )}
    </label>
  )
}

export function Nachtragsformular({
  dokumentId,
  aufgabeId,
  auswahl,
  belegart,
  ohneObjekt,
  pflicht = [],
  fehlt = [],
  extraktion = false,
}: {
  dokumentId: string
  aufgabeId: string
  auswahl: Nachtragsauswahl
  belegart: string
  ohneObjekt: boolean
  /** Die Pflichtfelder des Hauses fuer diese Belegart. */
  pflicht?: readonly Feldname[]
  /** Davon: die am Beleg noch fehlen. */
  fehlt?: readonly Feldname[]
  /** Ob eine automatische Erkennung eingerichtet ist. */
  extraktion?: boolean
}) {
  const rechnung = belegart !== 'schriftverkehr' && belegart !== 'sonstiges'
  const istPflicht = (f: Feldname) => pflicht.includes(f)
  const vorn = FAKTEN.filter((e) => IMMER_VORN.includes(e.feld) || istPflicht(e.feld))
  const hinten = FAKTEN.filter((e) => !vorn.includes(e))
  const fehltBeschriftet = fehlt.map((f) => BESCHRIFTUNG.get(f) ?? f)

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
      {rechnung && pflicht.length > 0 && (
        <p className="klein" role="status">
          {fehlt.length === 0
            ? 'Alle Pflichtfelder des Hauses sind erfasst.'
            : `Noch offen: ${fehltBeschriftet.join(', ')}.`}
        </p>
      )}
      <form action={angabenNachtragenAktion}>
        <input type="hidden" name="dokumentId" value={dokumentId} />
        <input type="hidden" name="aufgabeId" value={aufgabeId} />
        <label className="entscheidung-feld">
          Belegart
          <select name="belegart" defaultValue={belegart}>
            <option value="rechnung">Rechnung</option>
            <option value="gutschrift">Gutschrift</option>
            <option value="mahnung">Mahnung</option>
            <option value="schriftverkehr">Schriftverkehr (Angebot, Schreiben, Protokoll)</option>
            <option value="sonstiges">Sonstiges</option>
          </select>
          <span className="klein leise"> Eine andere Belegart wechselt den Ablauf — nur vor dem ersten Stempel.</span>
        </label>
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
              {istPflicht('kreditor_name') && (
                <span className={`klein ${fehlt.includes('kreditor_name') ? 'rot' : 'leise'}`}>
                  {' '}
                  {fehlt.includes('kreditor_name') ? '— fehlt noch' : '— Pflicht, vorhanden'}
                </span>
              )}
              <select name="kreditorId" defaultValue="">
                <option value="">— unverändert —</option>
                {auswahl.kreditoren.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            {vorn.map((e) => (
              <Feld key={e.feld} eintrag={e} pflicht={istPflicht(e.feld)} fehlt={fehlt.includes(e.feld)} />
            ))}
            {hinten.length > 0 && (
              <details>
                <summary className="klein">Weitere Angaben</summary>
                {hinten.map((e) => (
                  <Feld key={e.feld} eintrag={e} pflicht={false} fehlt={false} />
                ))}
              </details>
            )}
          </>
        )}
        <button type="submit" className="knopf-primaer" style={{ marginTop: '0.5rem' }}>
          Angaben übernehmen
        </button>
      </form>

      {/* Die Erkennung noch einmal -- oder der Grund, warum sie nichts liefert. */}
      {extraktion ? (
        <form action={aufbereitungErneutAktion} style={{ marginTop: '0.75rem' }}>
          <input type="hidden" name="dokumentId" value={dokumentId} />
          <input type="hidden" name="aufgabeId" value={aufgabeId} />
          <button type="submit" className="knopf-link">
            Erkennung erneut ausführen
          </button>
          <span className="leise klein"> — Texterkennung, Rechnungsdaten und Zuordnung wie beim Eingang</span>
        </form>
      ) : (
        <p className="leise klein" style={{ marginTop: '0.75rem' }}>
          Keine automatische Erkennung eingerichtet (DMS_EXTRAKTION) — die Rechnungsdaten kommen von Hand.
        </p>
      )}
    </section>
  )
}
