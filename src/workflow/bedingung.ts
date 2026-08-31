/**
 * Bedingungen an Verzweigungen des Ablaufs.
 *
 * Grundlage: ADR 0002, Teil B. Ein strukturierter Ausdruck über einer festen
 * Feldliste, serverseitig ausgewertet — bewusst kein Freitext und kein
 * Skript. Die Weißliste ist der entscheidende Teil: Der Editor bietet nur an,
 * was die Engine auswerten kann, und der Baukasten wird dadurch nicht
 * schleichend zu einer Programmiersprache.
 *
 * Ausgewertet wird einmal je Beleg beim Durchlaufen des Baums, nie in einer
 * RLS-Policy und nie je Zeile.
 */

export type Feldtyp = 'zahl' | 'text' | 'wahrheitswert'

export interface Feldbeschreibung {
  typ: Feldtyp
  /** Was im Editor als Bezeichnung erscheint. */
  anzeige: string
}

/**
 * Die Weißliste. Was hier nicht steht, lässt sich weder auswählen noch
 * auswerten. Erweitern ist eine bewusste Handlung mit Test, kein Zufall.
 */
export const FELDER: Record<string, Feldbeschreibung> = {
  brutto: { typ: 'zahl', anzeige: 'Rechnungsbetrag brutto' },
  netto: { typ: 'zahl', anzeige: 'Rechnungsbetrag netto' },
  wirtschaftsjahr: { typ: 'zahl', anzeige: 'Wirtschaftsjahr' },
  belegart: { typ: 'text', anzeige: 'Belegart' },
  'ordnungsgruppe.kurzcode': { typ: 'text', anzeige: 'Ordnungsgruppe' },
  'spezialgebiet.name': { typ: 'text', anzeige: 'Spezialgebiet' },
  'objekt.objektnummer': { typ: 'text', anzeige: 'Objektnummer' },
  'objekt.verwaltungsart': { typ: 'text', anzeige: 'Verwaltungsart' },
  'kreditor.name': { typ: 'text', anzeige: 'Kreditor' },
  zahlungsart: { typ: 'text', anzeige: 'Zahlungsart (ueberweisung|lastschrift)' },
  hat_umlagefaehige_zeile: { typ: 'wahrheitswert', anzeige: 'Umlagefähige Zeile vorhanden' },
}

export const OPERATOREN = {
  zahl: ['=', '!=', '<', '<=', '>', '>='] as const,
  text: ['=', '!=', 'in', 'enthaelt'] as const,
  wahrheitswert: ['='] as const,
}

export type Vergleich = {
  feld: string
  op: string
  wert: string | number | boolean | Array<string | number>
}

export type Bedingung =
  | Vergleich
  | { und: Bedingung[] }
  | { oder: Bedingung[] }
  | { nicht: Bedingung }

/** Werte des Belegs, gegen die geprüft wird. Baut die Engine zusammen. */
export type Kontext = Record<string, string | number | boolean | null | undefined>

const istVergleich = (b: Bedingung): b is Vergleich =>
  typeof b === 'object' && b !== null && 'feld' in b

/**
 * Prüft einen Ausdruck, ohne ihn auszuwerten. Liefert die Befunde im Klartext
 * — der Editor zeigt sie an, bevor gespeichert wird.
 */
export function bedingungPruefen(b: unknown, pfad = 'Bedingung'): string[] {
  if (typeof b !== 'object' || b === null) {
    return [`${pfad}: kein Ausdruck.`]
  }

  if ('und' in b || 'oder' in b) {
    const schluessel = 'und' in b ? 'und' : 'oder'
    const teile = (b as Record<string, unknown>)[schluessel]
    if (!Array.isArray(teile) || teile.length === 0) {
      return [`${pfad}: "${schluessel}" braucht mindestens einen Teilausdruck.`]
    }
    return teile.flatMap((teil, i) => bedingungPruefen(teil, `${pfad}.${schluessel}[${i}]`))
  }

  if ('nicht' in b) {
    return bedingungPruefen((b as { nicht: unknown }).nicht, `${pfad}.nicht`)
  }

  const v = b as Partial<Vergleich>
  if (typeof v.feld !== 'string') return [`${pfad}: kein Feld angegeben.`]

  const beschreibung = FELDER[v.feld]
  if (beschreibung === undefined) {
    return [`${pfad}: Feld "${v.feld}" steht nicht zur Verfügung.`]
  }

  const erlaubt: readonly string[] = OPERATOREN[beschreibung.typ]
  if (typeof v.op !== 'string' || !erlaubt.includes(v.op)) {
    return [
      `${pfad}: Vergleich "${String(v.op)}" ist für ${beschreibung.anzeige} nicht möglich ` +
        `(erlaubt: ${erlaubt.join(', ')}).`,
    ]
  }

  if (v.op === 'in') {
    if (!Array.isArray(v.wert) || v.wert.length === 0) {
      return [`${pfad}: "in" braucht eine nicht leere Liste.`]
    }
    return []
  }

  const erwartet = beschreibung.typ === 'zahl' ? 'number'
    : beschreibung.typ === 'text' ? 'string'
      : 'boolean'
  if (typeof v.wert !== erwartet) {
    return [`${pfad}: ${beschreibung.anzeige} erwartet einen Wert vom Typ ${beschreibung.typ}.`]
  }

  return []
}

/**
 * Wertet einen geprüften Ausdruck gegen einen Beleg aus.
 *
 * Ein fehlender Wert im Kontext ergibt `false`, nicht einen Fehler: Ein Beleg
 * ohne Kreditor ist kein Beleg mit falschem Kreditor. Verzweigungen mit
 * fehlenden Angaben nehmen damit den Sonst-Zweig, statt den Lauf anzuhalten.
 */
export function bedingungAuswerten(b: Bedingung, kontext: Kontext): boolean {
  if ('und' in b) return b.und.every((teil) => bedingungAuswerten(teil, kontext))
  if ('oder' in b) return b.oder.some((teil) => bedingungAuswerten(teil, kontext))
  if ('nicht' in b) return !bedingungAuswerten(b.nicht, kontext)
  if (!istVergleich(b)) return false

  const wert = kontext[b.feld]
  if (wert === null || wert === undefined) return false

  switch (b.op) {
    case '=':
      return wert === b.wert
    case '!=':
      return wert !== b.wert
    case '<':
      return typeof wert === 'number' && typeof b.wert === 'number' && wert < b.wert
    case '<=':
      return typeof wert === 'number' && typeof b.wert === 'number' && wert <= b.wert
    case '>':
      return typeof wert === 'number' && typeof b.wert === 'number' && wert > b.wert
    case '>=':
      return typeof wert === 'number' && typeof b.wert === 'number' && wert >= b.wert
    case 'in':
      return Array.isArray(b.wert) && (b.wert as Array<string | number>).includes(wert as never)
    case 'enthaelt':
      return (
        typeof wert === 'string' &&
        typeof b.wert === 'string' &&
        wert.toLocaleLowerCase('de').includes(b.wert.toLocaleLowerCase('de'))
      )
    default:
      return false
  }
}

/** Alle Felder, die ein Ausdruck benutzt — für Editor und Simulation. */
export function verwendeteFelder(b: Bedingung, gesammelt = new Set<string>()): Set<string> {
  if ('und' in b) b.und.forEach((t) => verwendeteFelder(t, gesammelt))
  else if ('oder' in b) b.oder.forEach((t) => verwendeteFelder(t, gesammelt))
  else if ('nicht' in b) verwendeteFelder(b.nicht, gesammelt)
  else if (istVergleich(b)) gesammelt.add(b.feld)
  return gesammelt
}
