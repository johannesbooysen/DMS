/**
 * Vorlagen für die Ausgangspost.
 *
 * **Die Vorschau ist der Punkt dieser Seite, nicht das Textfeld.** Wer eine
 * Formulierung ändert, die an eine Bank oder einen Versicherer geht, will
 * sehen, was ankommt — und zwar bevor es ankommt. Ein Eingabefeld allein
 * zeigt nur, was jemand getippt hat.
 *
 * Die Beispielwerte sind erfunden. Die Vorschau mit dem zuletzt versandten
 * Beleg zu füllen wäre naheliegend und falsch: Sie wäre ein zweiter Weg,
 * einen Beleg zu lesen — vorbei an der Berechtigung, die dafür gilt.
 *
 * Ein **unbekannter** Platzhalter wird beim Speichern abgewiesen. Beim
 * Füllen bleibt er dagegen stehen: Das sind zwei verschiedene Gelegenheiten,
 * einen Tippfehler zu bemerken, und die spätere ist eine Mail, die schon
 * draußen ist.
 */

import Link from 'next/link'
import { rechtelage } from '@/stammdaten'
import { platzhalterListe, vorlagenpflegeLaden } from '@/stammdaten/quellen'
import { vorlageAnlegenAktion, vorlageSpeichernAktion, vorlageUmschaltenAktion } from '@/app/lib/stammdaten-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { feld, Fehler, Handlung, kopfzelle, Marke, NurLesend, tabelle, zelle } from '@/app/lib/stammdaten-teile'

export const dynamic = 'force-dynamic'

const HIER = '/stammdaten/vorlagen'

const vorschau = {
  background: 'var(--farbe-flaeche-leise)',
  borderLeft: '3px solid var(--farbe-akzent)',
  fontSize: '0.85rem',
  padding: '0.6rem 0.8rem',
  whiteSpace: 'pre-wrap',
} as const

export default async function Vorlagen({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler } = await searchParams

  const [darf, vorlagen] = await Promise.all([
    rechtelage(benutzer),
    vorlagenpflegeLaden(benutzer),
  ])
  const platzhalter = platzhalterListe()

  return (
    <Seitenrahmen titel="Vorlagen für die Ausgangspost">
      <Fehler text={fehler} />
      {!darf.stammdaten && <NurLesend was="die Vorlagen" />}

      <p className="absatz-leise">
        Betreff und Text der Mails, die das Haus verlassen.{' '}
        <Link href="/stammdaten">Zurück zu den Stammdaten</Link>
      </p>

      <section className="abschnitt">
        <h2>
          Diese Platzhalter gibt es
        </h2>
        <p className="absatz-leise">
          Und nur diese. Was hier nicht steht, lässt sich nicht einsetzen — eine freie
          Vorlagensprache könnte den ganzen Belegtext in eine Mail schreiben, an einen
          Empfänger, den ein Stammdatum bestimmt.
        </p>
        <table style={tabelle}>
          <thead>
            <tr>
              <th style={kopfzelle}>Platzhalter</th>
              <th style={kopfzelle}>Bedeutung</th>
              <th style={kopfzelle}>Wofür</th>
            </tr>
          </thead>
          <tbody>
            {platzhalter.map((p) => (
              <tr key={p.name}>
                <td style={zelle}>
                  <code>{`{{${p.name}}}`}</code>
                </td>
                <td style={zelle}>{p.anzeige}</td>
                <td style={{ ...zelle, color: 'var(--farbe-text-leise)' }}>{p.hinweis}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="leise winzig">
          Ein bekannter Platzhalter ohne Wert wird zu einem Strich — dann fehlt die Angabe am
          Beleg, nicht in der Vorlage.
        </p>
      </section>

      {vorlagen.length === 0 && (
        <p>Noch keine Vorlage hinterlegt. Ohne sie bleibt Ausgangspost ungesendet liegen.</p>
      )}

      {vorlagen.map((v) => (
        <section
          key={v.id}
          style={{
            border: '1px solid var(--farbe-linie)',
            marginBottom: '1.5rem',
            padding: '1rem 1.25rem',
          }}
        >
          <h2 style={{ alignItems: 'baseline', display: 'flex', fontSize: '1rem', gap: '0.6rem', margin: '0 0 0.5rem' }}>
            {v.name}
            <code className="leise winzig">{v.schluessel}</code>
            {!v.aktiv && <Marke text="inaktiv" farbe="var(--farbe-rot)" />}
            {v.unbekannt.length > 0 && (
              <Marke text={`${v.unbekannt.length} unbekannt`} farbe="var(--farbe-rot)" />
            )}
            {/* Nie loeschen: Systemaktionen nennen den Schluessel, das
                Ausgangsbuch verweist auf den Text. Aus dem Verkehr ziehen
                genuegt -- und ist umkehrbar. */}
            {darf.stammdaten && (
              <Handlung
                aktion={vorlageUmschaltenAktion}
                zurueck={HIER}
                felder={{ id: v.id, aktiv: v.aktiv ? 'nein' : 'ja' }}
                farbe={v.aktiv ? 'var(--farbe-rot)' : 'var(--farbe-gruen)'}
              >
                {v.aktiv ? 'deaktivieren' : 'aktivieren'}
              </Handlung>
            )}
          </h2>

          {v.geaendertVon !== null && (
            <p style={{ color: 'var(--farbe-text-leise)', fontSize: '0.78rem', margin: '0 0 0.75rem' }}>
              Zuletzt geändert von {v.geaendertVon} am {v.geaendertAm}
            </p>
          )}

          {darf.stammdaten ? (
            <form action={vorlageSpeichernAktion}>
              <input type="hidden" name="zurueck" value={HIER} />
              <input type="hidden" name="id" value={v.id} />
              <label
                style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.6rem' }}
              >
                <span className="leise">Betreff</span>
                <input
                  name="betreff"
                  defaultValue={v.betreff}
                  required
                  style={{ ...feld, display: 'block', width: '100%' }}
                />
              </label>
              <label className="feld">
                <span className="leise">Text</span>
                <textarea
                  name="text"
                  defaultValue={v.text}
                  required
                  rows={7}
                  style={{ ...feld, display: 'block', fontFamily: 'inherit', width: '100%' }}
                />
              </label>
              <button
                type="submit"
                style={{ ...feld, background: 'var(--farbe-akzent)', color: 'var(--farbe-marke-text)', marginTop: '0.6rem' }}
              >
                Speichern
              </button>
            </form>
          ) : (
            <>
              <p style={{ fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
                <strong>Betreff:</strong> {v.betreff}
              </p>
              <div style={vorschau}>{v.text}</div>
            </>
          )}

          <h3 style={{ fontSize: '0.8rem', letterSpacing: '0.06em', margin: '1rem 0 0.4rem', textTransform: 'uppercase' }}>
            So sieht sie ausgefüllt aus
          </h3>
          <p style={{ fontSize: '0.85rem', margin: '0 0 0.35rem' }}>
            <strong>Betreff:</strong> {v.vorschauBetreff}
          </p>
          <div style={vorschau}>{v.vorschauText}</div>

          {v.unbekannt.length > 0 && (
            <p
              role="alert"
              style={{
                background: 'var(--farbe-rot-hell)',
                color: 'var(--farbe-rot-text)',
                fontSize: '0.85rem',
                marginTop: '0.75rem',
                padding: '0.6rem 0.75rem',
              }}
            >
              Diese Platzhalter kennt das System nicht und lässt sie deshalb stehen:{' '}
              {v.unbekannt.map((n) => `{{${n}}}`).join(', ')}. So gingen sie im Klartext
              hinaus — meist ist es ein Tippfehler.
            </p>
          )}
        </section>
      ))}

      {/* Eigene Vorlagen -- fuer Systemaktionen, die der Grundbestand nicht
          kennt. Der Schluessel ist die Anknuepfung und bleibt danach fest. */}
      {darf.stammdaten && (
        <section className="karte">
          <h2>Vorlage anlegen</h2>
          <p className="absatz-leise">
            Für eine Systemaktion, die es im Grundbestand nicht gibt. Der Schlüssel ist der
            Name, unter dem der Ablauf sie findet — Kleinbuchstaben, Ziffern, Unterstrich — und
            ändert sich danach nicht mehr.
          </p>
          <form action={vorlageAnlegenAktion}>
            <input type="hidden" name="zurueck" value={HIER} />
            <div className="filterzeile">
              <label className="feld">
                Schlüssel
                <input name="schluessel" required pattern="[a-z0-9_]{2,40}" maxLength={40} style={{ width: '12rem' }} />
              </label>
              <label className="feld">
                Name
                <input name="name" required maxLength={80} style={{ width: '20rem' }} />
              </label>
            </div>
            <label className="feld" style={{ marginBottom: '0.6rem' }}>
              Betreff
              <input name="betreff" required style={{ ...feld, display: 'block', width: '100%' }} />
            </label>
            <label className="feld">
              Text
              <textarea name="text" required rows={6} style={{ ...feld, display: 'block', fontFamily: 'inherit', width: '100%' }} />
            </label>
            <button type="submit" className="knopf-primaer" style={{ marginTop: '0.6rem' }}>
              Vorlage anlegen
            </button>
          </form>
        </section>
      )}
    </Seitenrahmen>
  )
}
