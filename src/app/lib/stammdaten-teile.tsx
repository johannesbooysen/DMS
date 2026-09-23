/**
 * Bausteine der Stammdatenmasken.
 *
 * Sieben Masken, ein Aussehen. Ohne diese Bausteine entstünden sieben
 * leicht verschiedene Tabellen — und die achte wäre wieder anders.
 *
 * Bewusst kein allgemeiner Formulargenerator: Jede Maske hat eine eigene
 * Regel (eine Bankverbindung wird *bestätigt*, ein Konto nur *deaktiviert*,
 * eine Rolle wird *beendet* statt gelöscht). Ein Generator müsste diese
 * Regeln als Ausnahmen wieder hereinreichen, und dann wäre er kein
 * Generator mehr.
 */

import type { ReactNode } from 'react'

/*
 * Die Stilkonstanten sind seit dem Stilsystem (`globals.css`) leer: Tabelle,
 * Zelle, Kopfzelle und Feld bekommen ihr Aussehen von dort. Sie bleiben als
 * Namen bestehen, damit die sieben Masken nicht angefasst werden muessen --
 * `style={zelle}` ist jetzt ein Nichts, und das ist der Sinn.
 */
import type { CSSProperties } from 'react'

export const tabelle: CSSProperties = {}
export const zelle: CSSProperties = {}
export const kopfzelle: CSSProperties = {}
export const feld: CSSProperties = {}

/**
 * Sichtbar fuer Vorleseprogramme, unsichtbar auf dem Bildschirm.
 *
 * Nicht `display: none` und nicht `visibility: hidden` — beides nimmt den
 * Text auch dem Vorleseprogramm weg und waere damit dasselbe wie gar keine
 * Beschriftung.
 */
export const nurFuerVorleser = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute' as const,
  whiteSpace: 'nowrap' as const,
  width: '1px',
}

export const knopf = {
  background: 'none',
  border: 0,
  color: 'var(--farbe-akzent)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.85rem',
  padding: 0,
  textDecoration: 'underline',
} as const

/** Eine Zeile Formular unter einer Tabelle — überall gleich aufgebaut. */
export function Anlegen({
  aktion,
  zurueck,
  children,
  beschriftung = 'Anlegen',
}: {
  aktion: (f: FormData) => Promise<void>
  zurueck: string
  children: ReactNode
  beschriftung?: string
}) {
  return (
    <form
      action={aktion}
      className="filterzeile"
      style={{ borderTop: '1px solid var(--farbe-linie)', marginTop: '0.75rem', paddingTop: '0.75rem' }}
    >
      {/* Wohin nach dem Absenden -- damit dieselbe Aktion von mehreren
          Unterseiten aus benutzt werden kann. */}
      <input type="hidden" name="zurueck" value={zurueck} />
      {children}
      <button type="submit" className="knopf-primaer">
        {beschriftung}
      </button>
    </form>
  )
}

export function Eingabe({
  name,
  label,
  breite = '10rem',
  pflicht = false,
  wert,
  typ = 'text',
}: {
  name: string
  label: string
  breite?: string
  pflicht?: boolean
  wert?: string
  typ?: string
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.15rem' }}>
      <span style={{ color: 'var(--farbe-text-leise)' }}>{label}</span>
      <input
        type={typ}
        name={name}
        required={pflicht}
        defaultValue={wert}
        style={{ ...feld, width: breite }}
      />
    </label>
  )
}

export function Auswahl({
  name,
  label,
  optionen,
  breite = '10rem',
  leer,
  wert,
  labelVerbergen,
}: {
  name: string
  label: string
  optionen: Array<{ wert: string; text: string }>
  breite?: string
  leer?: string
  /**
   * Vorbelegung. Wo eine Auswahl einen **bestehenden** Zustand aendert und
   * nicht etwas Neues anlegt, muss sie zeigen, was gerade gilt — sonst
   * setzt ein Formular, das jemand nur halb ausfuellt, das Uebrige still
   * zurueck.
   */
  wert?: string | null
  /**
   * Beschriftung nur fuer Vorleseprogramme.
   *
   * In einer Tabellenzeile ist die Spaltenueberschrift fuer Sehende Kontext
   * genug — fuer ein Vorleseprogramm ist sie es **nicht**: Es liest das Feld
   * einzeln vor. Eine leere Beschriftung ergaebe ein namenloses Auswahlfeld,
   * und das ist derselbe Fehler wie das `aria-label` an der Ampel: Er sieht
   * nach nichts aus und macht die Stelle unbedienbar.
   */
  labelVerbergen?: boolean
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.15rem' }}>
      <span style={labelVerbergen === true ? nurFuerVorleser : { color: 'var(--farbe-text-leise)' }}>{label}</span>
      <select name={name} defaultValue={wert ?? ''} style={{ ...feld, width: breite }}>
        {leer !== undefined && <option value="">{leer}</option>}
        {optionen.map((o) => (
          <option key={o.wert} value={o.wert}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Ein Knopf, der etwas ändert — immer ein Formular, nie ein Link. */
export function Handlung({
  aktion,
  zurueck,
  felder,
  children,
  farbe,
}: {
  aktion: (f: FormData) => Promise<void>
  zurueck: string
  felder: Record<string, string>
  children: ReactNode
  farbe?: string
}) {
  return (
    <form action={aktion} style={{ display: 'inline' }}>
      <input type="hidden" name="zurueck" value={zurueck} />
      {Object.entries(felder).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" style={{ ...knopf, ...(farbe === undefined ? {} : { color: farbe }) }}>
        {children}
      </button>
    </form>
  )
}

/** Der Hinweis, wenn eine Aktion abgewiesen wurde. */
export function Fehler({ text }: { text?: string }) {
  if (text === undefined || text === '') return null
  return (
    <p role="alert" className="meldung-fehler">
      {text}
    </p>
  )
}

/**
 * Der Hinweis für den, der nur zusehen darf.
 *
 * Statt die Seite zu verstecken: Wer die Stammdaten nicht pflegen darf, hat
 * trotzdem oft Grund nachzusehen, welches Konto es gibt. Verborgen wäre die
 * Auskunft weg, und die Frage ginge an einen Kollegen.
 */
export function NurLesend({ was }: { was: string }) {
  return (
    <p className="meldung-hinweis klein">
      Sie sehen {was}, dürfen sie aber nicht ändern — dafür fehlt das Recht.
    </p>
  )
}

export function Marke({ text, farbe }: { text: string; farbe: string }) {
  return (
    <span
      style={{
        background: `color-mix(in srgb, ${farbe} 14%, transparent)`,
        borderRadius: '2px',
        color: farbe,
        fontSize: '0.72rem',
        padding: '0.1rem 0.35rem',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  )
}
