/**
 * Pflichtfelder je Belegart -- welche Angaben ein Haus unbedingt erfasst
 * haben will (Konzept 14, Migration 20260928100000).
 *
 * Vorher stand die Liste im Quelltext der Extraktion. Jetzt ist sie ein
 * Stammdatum mit zwei Wirkungen: Die Extraktions-Ampel wird ueber genau
 * diese Felder gerechnet, und beim Nachtragen von Hand sind sie
 * gekennzeichnet -- sind alle da, wird die Ampel gruen, weil ein Mensch
 * mehr Gewicht hat als ein Modell.
 *
 * Keine Zeile heisst: kein Pflichtfeld. Das ist eine zulaessige Wahl, aber
 * eine, die die Seite ausspricht, statt sie stillschweigend als "alles
 * gruen" durchzuwinken.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '../db'
import type { Feldname } from '../extraktion/typen'
import { NichtErlaubt } from './index'

/** Alle Felder, die ein Haus verlangen kann -- mit ihrer Beschriftung. */
export const FELDER: ReadonlyArray<{ name: Feldname; label: string }> = [
  { name: 'kreditor_name', label: 'Kreditor (Rechnungssteller)' },
  { name: 'kreditor_ust_id', label: 'USt-IdNr. des Kreditors' },
  { name: 'rechnungsnummer', label: 'Rechnungsnummer' },
  { name: 'rechnungsdatum', label: 'Rechnungsdatum' },
  { name: 'leistung_von', label: 'Leistungszeitraum von' },
  { name: 'leistung_bis', label: 'Leistungszeitraum bis' },
  { name: 'netto', label: 'Nettobetrag' },
  { name: 'steuer', label: 'Steuerbetrag' },
  { name: 'brutto', label: 'Bruttobetrag' },
  { name: 'iban_im_beleg', label: 'IBAN im Beleg' },
  { name: 'zahlungsziel', label: 'Zahlungsziel' },
  { name: 'skonto_prozent', label: 'Skonto in Prozent' },
  { name: 'skonto_bis', label: 'Skonto bis' },
]

/** Die Liste, die vor dem Stammdatum im Quelltext stand -- Rueckfall, wenn es kein Haus gibt. */
export const STANDARD_PFLICHTFELDER: readonly Feldname[] = [
  'kreditor_name',
  'rechnungsnummer',
  'rechnungsdatum',
  'brutto',
]

const GUELTIG = new Set<string>(FELDER.map((f) => f.name))

export function istFeldname(wert: string): wert is Feldname {
  return GUELTIG.has(wert)
}

/** Belegarten, fuer die es Pflichtfelder gibt. Schriftverkehr hat andere Fakten. */
export const BELEGARTEN_MIT_PFLICHTFELDERN = ['rechnung'] as const

export async function pflichtfelderLaden(benutzerId: string, belegart: string): Promise<Feldname[]> {
  return alsBenutzer(benutzerId, (c) => pflichtfelderAbfragen(c, belegart))
}

async function pflichtfelderAbfragen(c: PoolClient, belegart: string): Promise<Feldname[]> {
  const { rows } = await c.query<{ feldname: Feldname }>(
    'select feldname from pflichtfeld where belegart = $1 order by feldname',
    [belegart],
  )
  return rows.map((r) => r.feldname)
}

/**
 * Die Pflichtfelder fuer einen bestimmten Beleg -- auf der laufenden
 * Verbindung, weil die Aufbereitung im Worker sie mitten in ihrer
 * Transaktion braucht. Der Worker arbeitet unter dem Einliefernden, also
 * im richtigen Haus; die RLS liefert dessen Liste.
 */
export async function pflichtfelderFuerDokument(c: PoolClient, dokumentId: string): Promise<Feldname[]> {
  const { rows } = await c.query<{ feldname: Feldname }>(
    `select p.feldname
       from pflichtfeld p
       join dokument d on d.mandant_id = p.mandant_id and d.belegart = p.belegart
      where d.id = $1
      order by p.feldname`,
    [dokumentId],
  )
  return rows.map((r) => r.feldname)
}

/**
 * Setzt die Liste fuer eine Belegart -- ganz, nicht einzeln: Die Seite zeigt
 * Kaestchen, und was abgehakt ist, gilt. Loeschen und Einfuegen unter der
 * RLS; ohne das Recht verschwindet nichts und entsteht nichts, und das wird
 * gemeldet statt geschwiegen.
 */
export async function pflichtfelderSetzen(
  benutzerId: string,
  belegart: string,
  felder: readonly string[],
): Promise<void> {
  if (!(BELEGARTEN_MIT_PFLICHTFELDERN as readonly string[]).includes(belegart)) {
    throw new NichtErlaubt('Für diese Belegart gibt es keine Pflichtfelder.')
  }
  const gewaehlt = [...new Set(felder)].filter(istFeldname)

  await alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ darf: boolean; mandant: string | null }>(
      'select app.darf_stammdaten() as darf, app.mein_mandant() as mandant',
    )
    if (rows[0]?.darf !== true || rows[0].mandant === null) {
      throw new NichtErlaubt(
        'Dafür fehlt das Recht. Pflichtfelder legt fest, wer Stammdaten pflegen darf.',
      )
    }
    await c.query('delete from pflichtfeld where belegart = $1', [belegart])
    for (const feldname of gewaehlt) {
      await c.query(
        'insert into pflichtfeld (mandant_id, belegart, feldname) values ($1, $2, $3)',
        [rows[0].mandant, belegart, feldname],
      )
    }
    // Die Wirkung zaehlen, nicht das Ausbleiben eines Fehlers.
    const jetzt = await pflichtfelderAbfragen(c, belegart)
    if (jetzt.length !== gewaehlt.length) {
      throw new NichtErlaubt('Die Änderung hat nichts bewirkt — der Eintrag ist für Sie nicht änderbar.')
    }
  })
}
