/**
 * Die Paginierung -- Einstellung der Eingangsnummer je Haus.
 *
 * Vergeben wird die Nummer beim Abschluss des Posteingangs
 * (app.eingang_abschliessen, Migration 20261002100000); hier steht nur, wie
 * sie aussieht: Praefix, Jahr im Nummernkreis, Stellen, an oder aus. Fehlt
 * die Zeile, gelten die Vorgaben -- eine frische Installation paginiert von
 * Anfang an, ohne dass jemand etwas einstellen muss.
 *
 * Der Zaehler selbst ist nicht einstellbar: Eine Paginierung, deren Stand
 * jemand zuruecksetzen kann, ist keine.
 */

import { alsBenutzer } from '../db'
import { NichtErlaubt, NichtMoeglich } from './index'

export interface Paginierung {
  aktiv: boolean
  praefix: string
  mitJahr: boolean
  stellen: number
  /** Der naechste Stand je Jahr -- zum Anzeigen, nicht zum Aendern. */
  zaehler: Array<{ jahr: number; naechste: number }>
}

export const VORGABE: Omit<Paginierung, 'zaehler'> = { aktiv: true, praefix: '', mitJahr: true, stellen: 6 }

export async function paginierungLaden(benutzerId: string): Promise<Paginierung> {
  return alsBenutzer(benutzerId, async (c) => {
    const [{ rows }, { rows: staende }] = await Promise.all([
      c.query<{ aktiv: boolean; praefix: string; mit_jahr: boolean; stellen: number }>(
        'select aktiv, praefix, mit_jahr, stellen from paginierung where mandant_id = app.mein_mandant()',
      ),
      c.query<{ jahr: number; naechste: string }>(
        'select jahr, naechste from paginierung_zaehler where mandant_id = app.mein_mandant() order by jahr desc',
      ),
    ])
    const z = rows[0]
    return {
      aktiv: z?.aktiv ?? VORGABE.aktiv,
      praefix: z?.praefix ?? VORGABE.praefix,
      mitJahr: z?.mit_jahr ?? VORGABE.mitJahr,
      stellen: z === undefined ? VORGABE.stellen : Number(z.stellen),
      zaehler: staende.map((s) => ({ jahr: Number(s.jahr), naechste: Number(s.naechste) })),
    }
  })
}

/** So saehe die naechste Nummer aus -- fuer die Vorschau auf der Seite. */
export function beispielnummer(p: Omit<Paginierung, 'zaehler'>, jahr: number, stand = 1): string {
  return `${p.praefix}${p.mitJahr ? `${jahr}-` : ''}${String(stand).padStart(p.stellen, '0')}`
}

export async function paginierungSetzen(
  benutzerId: string,
  eingabe: { aktiv: boolean; praefix: string; mitJahr: boolean; stellen: number },
): Promise<void> {
  const praefix = eingabe.praefix.trim()
  if (praefix.length > 12) throw new NichtMoeglich('Das Präfix bleibt kurz — höchstens zwölf Zeichen.')
  if (!/^[A-Za-z0-9\-_/.]*$/.test(praefix)) {
    throw new NichtMoeglich('Das Präfix darf Buchstaben, Ziffern, Bindestrich, Punkt und Schrägstrich enthalten.')
  }
  if (!Number.isInteger(eingabe.stellen) || eingabe.stellen < 1 || eingabe.stellen > 10) {
    throw new NichtMoeglich('Die Stellen liegen zwischen 1 und 10.')
  }
  return alsBenutzer(benutzerId, async (c) => {
    // Kein `on conflict`: Die Schreibpolicy meldet einen fehlenden Rechteschutz
    // beim insert als Fehler, beim update als null Zeilen -- beides wird hier
    // zur selben Auskunft.
    const { rowCount } = await c.query(
      `update paginierung set aktiv = $1, praefix = $2, mit_jahr = $3, stellen = $4
        where mandant_id = app.mein_mandant()`,
      [eingabe.aktiv, praefix, eingabe.mitJahr, eingabe.stellen],
    )
    if (rowCount === 0) {
      try {
        const { rowCount: eingefuegt } = await c.query(
          `insert into paginierung (mandant_id, aktiv, praefix, mit_jahr, stellen)
           select app.mein_mandant(), $1, $2, $3, $4`,
          [eingabe.aktiv, praefix, eingabe.mitJahr, eingabe.stellen],
        )
        if (eingefuegt === 0) throw new NichtErlaubt('Die Paginierung einstellen darf, wer Stammdaten pflegt.')
      } catch (fehler) {
        if (fehler instanceof Error && /row-level security/.test(fehler.message)) {
          throw new NichtErlaubt('Die Paginierung einstellen darf, wer Stammdaten pflegt.')
        }
        throw fehler
      }
    }
  })
}
