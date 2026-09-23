/**
 * Der Stempel-Designer.
 *
 * Je Stempeltyp: welche Felder auf dem Stempel stehen, welche Form, welcher
 * Rahmen, welche Neigung, welche Schrift, welche Farbe — mit einer Vorschau,
 * die dasselbe `Stempelbild` zeichnet wie der Beleg. Was man hier sieht, ist
 * das, was auf dem Beleg erscheint.
 *
 * **Kein Zielfeld.** Der Stempel trägt die Entscheidung, nicht das Ziel —
 * wohin der Beleg danach geht, leitet die Engine aus dem Ablauf ab. Das war
 * der Amagno-Fehler, den das Konzept behebt (§8.7); ein Designer mit
 * Zielfeld brächte ihn zurück.
 *
 * **Gilt für die nächsten Stempel.** Ein gesetzter Stempel ändert sich nicht,
 * wenn hier etwas umgestellt wird — sein Text entstand beim Stempeln und
 * bleibt, wie er war. Deshalb steht das oben auf der Seite.
 *
 * Eigene Seite aus demselben Grund wie Kategorien und Benutzer: ein anderes
 * Recht. Stempel gestalten darf, wer Abläufe konfigurieren darf.
 */

import Link from 'next/link'
import { darfGestalten, stempeltypenLaden } from '@/stammdaten/stempel'
import {
  stempelGestaltungAktion,
  stempeltypAnlegenAktion,
  stempeltypUmschaltenAktion,
} from '@/app/lib/stammdaten-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { Stempelbild } from '@/app/lib/stempelbild'
import { Anlegen, Auswahl, Eingabe, Fehler, Handlung, NurLesend } from '@/app/lib/stammdaten-teile'
import {
  beispieltext,
  DREHUNG_MAX,
  FELD_BESCHRIFTUNG,
  FELDER,
  FORMEN,
  RAHMEN,
  SCHRIFTEN,
} from '@/layer/gestaltung'

export const dynamic = 'force-dynamic'

const HIER = '/stammdaten/stempel'

const ENTSCHEIDUNG: Record<string, string> = {
  freigabe: 'Freigabe — schließt die Stufe ab',
  ablehnung: 'Ablehnung',
  rueckgabe: 'Rückgabe',
  klaerung: 'Klärung',
  systemaktion: 'Systemaktion',
}

const BESCHRIFTUNG = {
  form: { rechteck: 'Rechteck', abgerundet: 'Abgerundet', oval: 'Oval' },
  rahmen: { durchgezogen: 'Durchgezogen', gestrichelt: 'Gestrichelt', doppelt: 'Doppelt' },
  schrift: { klein: 'Klein', normal: 'Normal', gross: 'Groß' },
} as const

export default async function Stempeldesigner({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler } = await searchParams
  const [darf, typen] = await Promise.all([darfGestalten(benutzer), stempeltypenLaden(benutzer)])

  return (
    <Seitenrahmen titel="Stempel gestalten">
      <Fehler text={fehler} />

      <p className="einleitung">
        Je Stempeltyp: was auf dem Stempel steht und wie er aussieht. Der Stempeltext
        steht immer zuerst — er ist die Entscheidung; alles andere ist Beleg dafür.
        Die Vorschau zeigt, was auf dem Beleg erscheint.
      </p>
      <p className="einleitung">
        <strong>Gilt für die nächsten Stempel.</strong> Ein gesetzter Stempel ändert sich
        nicht — sein Text entstand beim Stempeln und bleibt, wie er war. Wohin der Beleg
        nach einem Stempel geht, steht nicht hier, sondern im{' '}
        <Link href="/konfiguration">Ablauf</Link>.
      </p>

      {typen.map((t) => (
        <section
          key={t.id}
          style={{
            border: '1px solid var(--farbe-linie)',
            borderRadius: '0.3rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.5rem',
            marginBottom: '1.25rem',
            opacity: t.aktiv ? 1 : 0.6,
            padding: '1rem',
          }}
        >
          <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
            <h2>
              {t.name}{' '}
              <span className="leise winzig normal">
                {t.kurzcode} · {ENTSCHEIDUNG[t.entscheidung] ?? t.entscheidung}
                {t.aktiv ? '' : ' · deaktiviert'}
              </span>
            </h2>
            <p style={{ color: 'var(--farbe-text-leise)', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
              {t.stufen === 0
                ? 'An keiner Stufe eingehängt — wird nie gesetzt.'
                : `An ${t.stufen} Stufe${t.stufen === 1 ? '' : 'n'} eingehängt.`}
              {!t.sichtbarAufBeleg && ' Erscheint nicht auf dem Beleg (nur im Protokoll).'}
            </p>

            {/* Die Vorschau: dasselbe Bild wie auf dem Beleg, in Stempelgröße. */}
            <div
              aria-label={`Vorschau: ${beispieltext(t.name, t.gestaltung)}`}
              role="img"
              style={{ height: '4rem', margin: '0.5rem 0 0.5rem', width: '12rem' }}
            >
              <Stempelbild text={beispieltext(t.name, t.gestaltung)} farbe={t.farbe} gestaltung={t.gestaltung} />
            </div>

            {darf && (
              <Handlung aktion={stempeltypUmschaltenAktion} zurueck={HIER} felder={{ id: t.id }}>
                {t.aktiv ? 'deaktivieren' : 'aktivieren'}
              </Handlung>
            )}
          </div>

          <div style={{ flex: '2 1 22rem', minWidth: 0 }}>
            {darf ? (
              <form
                action={stempelGestaltungAktion}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
              >
                <input type="hidden" name="zurueck" value={HIER} />
                <input type="hidden" name="id" value={t.id} />

                <fieldset style={{ border: '1px solid var(--farbe-linie)', borderRadius: '0.2rem', padding: '0.5rem 0.75rem' }}>
                  <legend style={{ fontSize: '0.8rem', color: 'var(--farbe-text-leise)' }}>Was auf dem Stempel steht</legend>
                  <div className="reihe">
                    {FELDER.map((f) => (
                      <label key={f} className="klein">
                        <input
                          type="checkbox"
                          name="feld"
                          value={f}
                          defaultChecked={t.gestaltung.felder.includes(f)}
                          /* Der Stempeltext ist keine Wahl: ohne ihn keine Entscheidung. */
                          disabled={f === 'text'}
                        />{' '}
                        {FELD_BESCHRIFTUNG[f]}
                      </label>
                    ))}
                    <input type="hidden" name="feld" value="text" />
                  </div>
                </fieldset>

                <div style={{ alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                  <Auswahl
                    name="form"
                    label="Form"
                    optionen={FORMEN.map((f) => ({ wert: f, text: BESCHRIFTUNG.form[f] }))}
                    wert={t.gestaltung.form}
                    breite="8rem"
                  />
                  <Auswahl
                    name="rahmen"
                    label="Rahmen"
                    optionen={RAHMEN.map((r) => ({ wert: r, text: BESCHRIFTUNG.rahmen[r] }))}
                    wert={t.gestaltung.rahmen}
                    breite="8rem"
                  />
                  <Auswahl
                    name="schrift"
                    label="Schrift"
                    optionen={SCHRIFTEN.map((s) => ({ wert: s, text: BESCHRIFTUNG.schrift[s] }))}
                    wert={t.gestaltung.schrift}
                    breite="7rem"
                  />
                  <Eingabe
                    name="drehung"
                    label={`Neigung in Grad (−${DREHUNG_MAX} bis ${DREHUNG_MAX})`}
                    typ="number"
                    wert={String(t.gestaltung.drehung)}
                    breite="5rem"
                  />
                  <Eingabe name="farbe" label="Farbe" typ="color" wert={t.farbe} breite="4rem" />
                  <label className="winzig">
                    <input type="checkbox" name="sichtbar" value="ja" defaultChecked={t.sichtbarAufBeleg} /> auf dem
                    Beleg sichtbar
                  </label>
                </div>

                <div>
                  <button
                    type="submit"
                    style={{
                      background: 'var(--farbe-akzent)',
                      border: 0,
                      borderRadius: '0.2rem',
                      color: 'var(--farbe-marke-text)',
                      cursor: 'pointer',
                      padding: '0.4rem 0.9rem',
                    }}
                  >
                    Gestaltung speichern
                  </button>
                </div>
              </form>
            ) : (
              <NurLesend was="Stempel zu gestalten" />
            )}
          </div>
        </section>
      ))}

      {darf && (
        <section style={{ marginTop: '2rem' }}>
          <h2>Neuer Stempeltyp</h2>
          <p style={{ color: 'var(--farbe-text-leise)', fontSize: '0.85rem', margin: '0 0 0.5rem', maxWidth: '46rem' }}>
            Ein neuer Typ steht zunächst an keiner Stufe — eingehängt wird er im Ablauf, und
            wer ihn setzen darf, unter <Link href="/stammdaten/benutzer">Benutzer und Rollen</Link>.
          </p>
          <Anlegen aktion={stempeltypAnlegenAktion} zurueck={HIER}>
            <Eingabe name="name" label="Name" breite="14rem" pflicht />
            <Eingabe name="kurzcode" label="Kurzcode" breite="7rem" pflicht />
            <Auswahl
              name="entscheidung"
              label="Entscheidung"
              optionen={Object.entries(ENTSCHEIDUNG).map(([wert, text]) => ({ wert, text }))}
              breite="16rem"
            />
            <Eingabe name="farbe" label="Farbe" typ="color" wert="#3B4A80" breite="4rem" />
          </Anlegen>
        </section>
      )}

      <p style={{ fontSize: '0.85rem', marginTop: '2rem' }}>
        <Link href="/stammdaten">Zurück zu den Stammdaten</Link>
      </p>
    </Seitenrahmen>
  )
}
