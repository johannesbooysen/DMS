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

export const tabelle = {
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
  width: '100%',
} as const

export const zelle = {
  borderBottom: '1px solid #eee',
  padding: '0.45rem 0.5rem',
  verticalAlign: 'top',
} as const

export const kopfzelle = {
  ...zelle,
  borderBottom: '1px solid #ccc',
  color: '#555',
  fontWeight: 600,
  textAlign: 'left',
} as const

export const feld = {
  border: '1px solid #bbb',
  borderRadius: '2px',
  font: 'inherit',
  padding: '0.3rem 0.4rem',
} as const

export const knopf = {
  background: 'none',
  border: 0,
  color: '#3B4A80',
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
      style={{
        alignItems: 'flex-end',
        borderTop: '1px solid #ddd',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        marginTop: '0.75rem',
        paddingTop: '0.75rem',
      }}
    >
      {/* Wohin nach dem Absenden -- damit dieselbe Aktion von mehreren
          Unterseiten aus benutzt werden kann. */}
      <input type="hidden" name="zurueck" value={zurueck} />
      {children}
      <button type="submit" style={{ ...feld, background: '#3B4A80', color: '#fff' }}>
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
      <span style={{ color: '#555' }}>{label}</span>
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
}: {
  name: string
  label: string
  optionen: Array<{ wert: string; text: string }>
  breite?: string
  leer?: string
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.15rem' }}>
      <span style={{ color: '#555' }}>{label}</span>
      <select name={name} style={{ ...feld, width: breite }}>
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
    <p
      role="alert"
      style={{
        background: '#F6DCD9',
        color: '#6B1D15',
        fontSize: '0.9rem',
        margin: '0 0 1rem',
        padding: '0.75rem',
      }}
    >
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
    <p
      style={{
        background: '#F3EDDC',
        color: '#6B551A',
        fontSize: '0.85rem',
        margin: '0 0 1rem',
        padding: '0.6rem 0.75rem',
      }}
    >
      Sie sehen {was}, dürfen sie aber nicht ändern — dafür fehlt das Recht.
    </p>
  )
}

export function Marke({ text, farbe }: { text: string; farbe: string }) {
  return (
    <span
      style={{
        background: `${farbe}22`,
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
