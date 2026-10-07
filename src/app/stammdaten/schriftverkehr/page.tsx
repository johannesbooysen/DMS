/**
 * Schriftverkehr -- wer bekommt ein Schreiben, und was ist wichtig
 * (Migration 20261006170000).
 *
 * Drei Einstellungen, eine Frage: Wie kommt ein Schreiben zum richtigen
 * Mitarbeiter, und wann erfaehrt die Geschaeftsleitung davon? Signalwoerter
 * und Absender sind Regeln, die Themen mit GL-Information ein Haken an der
 * Ordnungsgruppe; die parallele Kenntnisstufe der GL steht im Ablauf
 * Schriftverkehr (Konfiguration -> Ablaeufe) als "Wenn wichtig".
 */

import Link from 'next/link'
import {
  glInformierenSetzenAktion,
  regelAnlegenAktion,
  regelUmschaltenAktion,
} from '@/app/lib/stammdaten-aktionen'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Anlegen, Auswahl, Eingabe, Fehler, Handlung, kopfzelle, Marke, NurLesend, tabelle, zelle } from '@/app/lib/stammdaten-teile'
import { alsBenutzer } from '@/db'
import { benutzerLaden, ordnungsgruppenLaden, rechtelage } from '@/stammdaten'
import { regelnLaden, type Regelzeile } from '@/stammdaten/schriftverkehr-regeln'

export const dynamic = 'force-dynamic'

const HIER = '/stammdaten/schriftverkehr'

function Regeltabelle({
  zeilen,
  darf,
  mitEmpfaenger,
}: {
  zeilen: Regelzeile[]
  darf: boolean
  mitEmpfaenger: boolean
}) {
  if (zeilen.length === 0) return <p className="leise klein">Noch keine Regel.</p>
  return (
    <table style={tabelle}>
      <thead>
        <tr>
          <th style={kopfzelle}>{mitEmpfaenger ? 'Absender enthält' : 'Signalwort'}</th>
          {mitEmpfaenger && <th style={kopfzelle}>Empfänger</th>}
          <th style={kopfzelle}>Thema</th>
          <th style={kopfzelle}>Wichtig</th>
          {darf && <th style={kopfzelle} />}
        </tr>
      </thead>
      <tbody>
        {zeilen.map((r) => (
          <tr key={r.id} style={r.aktiv ? undefined : { color: 'var(--farbe-text-leise)' }}>
            <td style={zelle}>
              <strong>{r.muster}</strong>
              {!r.aktiv && <span className="leise klein"> · aus</span>}
            </td>
            {mitEmpfaenger && (
              <td style={zelle}>
                {r.empfaenger === null ? (
                  <span className="leise">—</span>
                ) : (
                  `${r.empfaenger.name}${r.empfaenger.art === 'gruppe' ? ' (Gruppe)' : ''}`
                )}
              </td>
            )}
            <td style={zelle}>{r.ordnungsgruppe === null ? <span className="leise">—</span> : r.ordnungsgruppe.name}</td>
            <td style={zelle}>{r.wichtig ? <Marke text="wichtig" farbe="var(--farbe-rot)" /> : <span className="leise">—</span>}</td>
            {darf && (
              <td style={zelle}>
                <Handlung
                  aktion={regelUmschaltenAktion}
                  zurueck={HIER}
                  felder={{ id: r.id }}
                  farbe={r.aktiv ? 'var(--farbe-rot)' : undefined}
                >
                  {r.aktiv ? 'ausschalten' : 'einschalten'}
                </Handlung>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default async function Schriftverkehr({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const ich = await angemeldeterBenutzer()
  const { fehler } = await searchParams
  const [darf, regeln, gruppen, benutzer, gruppenliste] = await Promise.all([
    rechtelage(ich),
    regelnLaden(ich),
    ordnungsgruppenLaden(ich),
    benutzerLaden(ich),
    alsBenutzer(ich, async (c) => (await c.query<{ id: string; name: string }>('select id, name from gruppe where aktiv order by name')).rows),
  ])
  // gl_informieren haengt nicht an der Ordnungsgruppenzeile; eine Abfrage.
  const glGruppen = await alsBenutzer(ich, async (c) =>
    new Set((await c.query<{ id: string }>('select id from ordnungsgruppe where gl_informieren')).rows.map((z) => z.id)),
  )
  const signalwoerter = regeln.filter((r) => r.art === 'signalwort')
  const absender = regeln.filter((r) => r.art === 'absender')
  const themen = gruppen.filter((g) => g.aktiv).map((g) => ({ wert: g.id, text: g.name }))
  const empfaenger = [
    ...benutzer.filter((b) => b.aktiv).map((b) => ({ wert: `benutzer:${b.id}`, text: b.name })),
    ...gruppenliste.map((g) => ({ wert: `gruppe:${g.id}`, text: `Gruppe ${g.name}` })),
  ]

  return (
    <Seitenrahmen titel="Schriftverkehr">
      <Fehler text={fehler} />
      {!darf.stammdaten && <NurLesend was="die Verteilregeln" />}

      <p className="einleitung">
        Ein Schreiben geht an den <strong>richtigen Mitarbeiter</strong>, in dieser Reihenfolge: an eine im
        Schreiben genannte Person (Name oder Kürzel), sonst an den hier hinterlegten Empfänger des Absenders,
        sonst an den Spezialisten für das Thema, sonst an den Objektverantwortlichen. Ein Schreiben ist{' '}
        <strong>wichtig</strong>, wenn sein Thema die Geschäftsleitung informiert oder ein Signalwort darin
        steht — dann bekommt die Geschäftsleitung eine eigene, gleichzeitige Kenntnisaufgabe, und die Frist bis
        zur Eskalation ist kürzer. Beides steht im Ablauf <em>Schriftverkehr</em> unter{' '}
        <Link href="/konfiguration">Abläufe</Link>; Kürzel unter{' '}
        <Link href="/stammdaten/benutzer">Benutzer und Rollen</Link>.
      </p>

      <section className="abschnitt">
        <h2>Signalwörter</h2>
        <p className="absatz-leise">
          Ein Wort im Text — ganzes Wort, Groß- und Kleinschreibung egal. Es kann das Thema setzen (nie über ein
          von Hand gesetztes) und das Schreiben wichtig machen.
        </p>
        <Regeltabelle zeilen={signalwoerter} darf={darf.stammdaten} mitEmpfaenger={false} />
        {darf.stammdaten && (
          <Anlegen aktion={regelAnlegenAktion} zurueck={HIER}>
            <input type="hidden" name="art" value="signalwort" />
            <Eingabe name="muster" label="Signalwort" pflicht breite="12rem" />
            <Auswahl name="ordnungsgruppeId" label="Thema setzen" optionen={themen} leer="— keines —" breite="12rem" />
            <label style={{ fontSize: '0.75rem', alignSelf: 'flex-end' }}>
              <input type="checkbox" name="wichtig" value="ja" defaultChecked /> wichtig
            </label>
          </Anlegen>
        )}
      </section>

      <section className="abschnitt">
        <h2>Absender</h2>
        <p className="absatz-leise">
          Ein Teil des Absendernamens, wie er im Schreiben steht („Amtsgericht“, „Rechtsanwälte“). Der Absender
          kann fest an eine Person oder Gruppe gehen, ein Thema setzen und das Schreiben wichtig machen.
        </p>
        <Regeltabelle zeilen={absender} darf={darf.stammdaten} mitEmpfaenger />
        {darf.stammdaten && (
          <Anlegen aktion={regelAnlegenAktion} zurueck={HIER}>
            <input type="hidden" name="art" value="absender" />
            <Eingabe name="muster" label="Absender enthält" pflicht breite="12rem" />
            <Auswahl name="empfaenger" label="Empfänger" optionen={empfaenger} leer="— keiner —" breite="12rem" />
            <Auswahl name="ordnungsgruppeId" label="Thema setzen" optionen={themen} leer="— keines —" breite="12rem" />
            <label style={{ fontSize: '0.75rem', alignSelf: 'flex-end' }}>
              <input type="checkbox" name="wichtig" value="ja" /> wichtig
            </label>
          </Anlegen>
        )}
      </section>

      <section className="abschnitt">
        <h2>Themen, bei denen die Geschäftsleitung informiert wird</h2>
        <p className="absatz-leise">
          Jedes Schreiben eines angehakten Themas gilt als wichtig — unabhängig von Signalwörtern.
        </p>
        <form action={glInformierenSetzenAktion}>
          <input type="hidden" name="zurueck" value={HIER} />
          <fieldset disabled={!darf.stammdaten} style={{ border: 0, padding: 0, margin: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem' }}>
              {gruppen
                .filter((g) => g.aktiv)
                .map((g) => (
                  <label key={g.id} style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" name="gruppe" value={g.id} defaultChecked={glGruppen.has(g.id)} /> {g.name}
                  </label>
                ))}
            </div>
            {darf.stammdaten && (
              <button type="submit" className="klein" style={{ marginTop: '0.6rem' }}>
                Themen speichern
              </button>
            )}
          </fieldset>
        </form>
      </section>
    </Seitenrahmen>
  )
}
