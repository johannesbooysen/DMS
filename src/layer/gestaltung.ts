/**
 * Die Gestaltung eines Stempeltyps -- was der Stempel-Designer einstellt.
 *
 * Antwort auf Frage 9 des Entwurfs: "Stempeltext, Datum + Uhrzeit +
 * Mitarbeiter (es soll jedoch ein Stempel-Designer geben)". Der Designer
 * legt je Stempeltyp fest, **welche Felder** auf dem Stempel stehen und
 * **wie er aussieht** -- Form, Rahmen, Drehung, Schriftgroesse. Die Farbe
 * traegt der Stempeltyp schon.
 *
 * **Weissliste, kein Freitext.** Wie bei den Bedingungen des Ablaufs: Was
 * hier nicht steht, laesst sich weder waehlen noch zeichnen. Ein Feld ist
 * ein Name aus einer festen Liste, kein Ausdruck -- der Trigger in der
 * Datenbank setzt den Text daraus zusammen (Migration 20260923100000), und
 * der muss wissen, was er einsetzen soll.
 *
 * **Der Stempeltext steht immer zuerst.** Er ist die Entscheidung; alles
 * andere ist Beleg dafuer. Ein Stempel ohne Entscheidung ist eine Notiz.
 */

export const FELDER = [
  'text',
  'mitarbeiter',
  'datum',
  'uhrzeit',
  'kommentar',
  'objekt',
  'betrag',
  'stufe',
  'paginiernummer',
] as const
export type Feld = (typeof FELDER)[number]

export const FELD_BESCHRIFTUNG: Record<Feld, string> = {
  text: 'Stempeltext',
  mitarbeiter: 'Mitarbeiter',
  datum: 'Datum',
  uhrzeit: 'Uhrzeit',
  kommentar: 'Kommentar',
  objekt: 'Objektnummer',
  betrag: 'Betrag',
  stufe: 'Stufe',
  paginiernummer: 'Paginiernummer',
}

export const FORMEN = ['rechteck', 'abgerundet', 'oval'] as const
export const RAHMEN = ['durchgezogen', 'gestrichelt', 'doppelt'] as const
export const SCHRIFTEN = ['klein', 'normal', 'gross'] as const

export interface Gestaltung {
  felder: Feld[]
  form: (typeof FORMEN)[number]
  rahmen: (typeof RAHMEN)[number]
  /** Grad, gegen den Uhrzeigersinn positiv. Klein gehalten: schief ist schlecht lesbar. */
  drehung: number
  schrift: (typeof SCHRIFTEN)[number]
  /** Linienstaerke des Rahmens in Punkten (LINIE_MIN bis LINIE_MAX). */
  linie: number
  /**
   * Schriftfarbe als #RRGGBB -- oder null: dann aus der Rahmenfarbe des
   * Stempeltyps abgeleitet, abgedunkelt bis sie lesbar ist (lesefarbe).
   * Beim Bedienen gewuenscht: "die Schriftfarbe soll unabhaengig von der
   * Rahmenfarbe bestimmt werden koennen."
   */
  schriftfarbe: string | null
}

export const DREHUNG_MAX = 15
export const LINIE_MIN = 0.5
export const LINIE_MAX = 6

/** Was gilt, solange niemand etwas eingestellt hat -- die Antwort auf Frage 9. */
export const VORGABE: Gestaltung = {
  felder: ['text', 'mitarbeiter', 'datum', 'uhrzeit'],
  form: 'rechteck',
  rahmen: 'durchgezogen',
  drehung: -3,
  schrift: 'normal',
  linie: 2,
  schriftfarbe: null,
}

const HEXFARBE = /^#[0-9a-f]{6}$/i

/**
 * Liest eine Gestaltung aus der Datenbank -- tolerant.
 *
 * Was fehlt oder nicht in der Weissliste steht, wird durch die Vorgabe
 * ersetzt statt abgewiesen: Ein Stempel muss immer gezeichnet werden
 * koennen, auch wenn jemand die Spalte von Hand verdorben hat.
 */
export function gestaltungLesen(roh: unknown): Gestaltung {
  const o = typeof roh === 'object' && roh !== null ? (roh as Record<string, unknown>) : {}
  const felderRoh = Array.isArray(o['felder']) ? o['felder'] : VORGABE.felder
  const felder = felderRoh.filter((f): f is Feld => (FELDER as readonly string[]).includes(String(f)))
  const drehung = Number(o['drehung'])
  const linie = Number(o['linie'])
  const schriftfarbe = typeof o['schriftfarbe'] === 'string' && HEXFARBE.test(o['schriftfarbe']) ? o['schriftfarbe'].toUpperCase() : null
  return {
    felder: felder.length === 0 ? VORGABE.felder : mitTextZuerst(felder),
    form: (FORMEN as readonly string[]).includes(String(o['form'])) ? (o['form'] as Gestaltung['form']) : VORGABE.form,
    rahmen: (RAHMEN as readonly string[]).includes(String(o['rahmen'])) ? (o['rahmen'] as Gestaltung['rahmen']) : VORGABE.rahmen,
    drehung: Number.isFinite(drehung) ? Math.max(-DREHUNG_MAX, Math.min(DREHUNG_MAX, drehung)) : VORGABE.drehung,
    schrift: (SCHRIFTEN as readonly string[]).includes(String(o['schrift'])) ? (o['schrift'] as Gestaltung['schrift']) : VORGABE.schrift,
    linie: Number.isFinite(linie) ? Math.max(LINIE_MIN, Math.min(LINIE_MAX, linie)) : VORGABE.linie,
    schriftfarbe,
  }
}

/**
 * Prueft eine Eingabe aus der Maske -- streng.
 *
 * Anders als `gestaltungLesen`: Was hier nicht passt, wird gemeldet, nicht
 * ersetzt. Wer etwas einstellt, soll erfahren, wenn es nicht angenommen
 * wurde.
 */
export function gestaltungPruefen(eingabe: {
  felder: string[]
  form: string
  rahmen: string
  drehung: number
  schrift: string
  /** Punkte; fehlt sie, gilt die Vorgabe. */
  linie?: number
  /** #RRGGBB, leer oder fehlend heisst: aus der Rahmenfarbe. */
  schriftfarbe?: string | null
}): { gestaltung: Gestaltung } | { fehler: string } {
  const linie = eingabe.linie === undefined ? VORGABE.linie : eingabe.linie
  if (!Number.isFinite(linie) || linie < LINIE_MIN || linie > LINIE_MAX) {
    return { fehler: `Die Linienstärke bleibt zwischen ${LINIE_MIN} und ${LINIE_MAX} Punkten.` }
  }
  const schriftfarbeRoh = (eingabe.schriftfarbe ?? '').trim()
  if (schriftfarbeRoh !== '' && !HEXFARBE.test(schriftfarbeRoh)) {
    return { fehler: 'Die Schriftfarbe muss als #rrggbb angegeben sein.' }
  }
  const unbekannt = eingabe.felder.filter((f) => !(FELDER as readonly string[]).includes(f))
  if (unbekannt.length > 0) return { fehler: `Unbekanntes Feld: ${unbekannt.join(', ')}.` }
  if (!(FORMEN as readonly string[]).includes(eingabe.form)) return { fehler: 'Unbekannte Form.' }
  if (!(RAHMEN as readonly string[]).includes(eingabe.rahmen)) return { fehler: 'Unbekannter Rahmen.' }
  if (!(SCHRIFTEN as readonly string[]).includes(eingabe.schrift)) return { fehler: 'Unbekannte Schriftgroesse.' }
  if (!Number.isFinite(eingabe.drehung) || Math.abs(eingabe.drehung) > DREHUNG_MAX) {
    return { fehler: `Die Drehung bleibt zwischen -${DREHUNG_MAX} und ${DREHUNG_MAX} Grad -- schief ist schlecht lesbar.` }
  }
  return {
    gestaltung: {
      felder: mitTextZuerst(eingabe.felder as Feld[]),
      form: eingabe.form as Gestaltung['form'],
      rahmen: eingabe.rahmen as Gestaltung['rahmen'],
      drehung: Math.round(eingabe.drehung),
      schrift: eingabe.schrift as Gestaltung['schrift'],
      linie: Math.round(linie * 2) / 2,
      schriftfarbe: schriftfarbeRoh === '' ? null : schriftfarbeRoh.toUpperCase(),
    },
  }
}

/** Der Stempeltext zuerst, der Rest in der Reihenfolge der Weissliste, ohne Doppelte. */
function mitTextZuerst(felder: Feld[]): Feld[] {
  const menge = new Set<Feld>(felder)
  menge.add('text')
  return FELDER.filter((f) => menge.has(f))
}

/**
 * Beispieltext fuer die Vorschau im Designer -- dieselbe Zusammensetzung wie
 * im Trigger, mit erfundenen Werten. Erfunden, nicht aus dem letzten Beleg:
 * Die Vorschau darf kein zweiter Leseweg zu einem Beleg sein.
 */
export function beispieltext(name: string, g: Gestaltung): string {
  const werte: Record<Feld, string | null> = {
    text: name,
    mitarbeiter: 'Anna Ahrens',
    datum: '22.09.2026',
    uhrzeit: '09:10',
    kommentar: 'Beispielkommentar',
    objekt: 'Objekt 42',
    betrag: '1.240,00 EUR',
    stufe: 'Sachliche Pruefung',
    paginiernummer: '2026-000123',
  }
  return textZusammensetzen(g.felder, werte)
}

/**
 * Datum und Uhrzeit ruecken zusammen, wenn beide gewaehlt sind --
 * "22.09.2026 09:10" statt zwei Segmente. Dieselbe Regel steht im Trigger.
 */
export function textZusammensetzen(felder: Feld[], werte: Record<Feld, string | null>): string {
  const teile: string[] = []
  let datumUhrzeit: string[] = []
  for (const f of felder) {
    const w = werte[f]
    if (w === null || w === '') continue
    if (f === 'datum' || f === 'uhrzeit') {
      datumUhrzeit.push(w)
      continue
    }
    if (datumUhrzeit.length > 0) {
      teile.push(datumUhrzeit.join(' '))
      datumUhrzeit = []
    }
    teile.push(w)
  }
  if (datumUhrzeit.length > 0) teile.push(datumUhrzeit.join(' '))
  return teile.join(' · ')
}
