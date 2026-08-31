/**
 * Datenzugriff des Viewers.
 *
 * Jede Abfrage läuft über `alsBenutzer` und damit unter der RLS. Ein Beleg,
 * den der Benutzer nicht sehen darf, ist hier nicht „verboten", sondern
 * schlicht nicht vorhanden — der Unterschied ist wichtig: Eine
 * Fehlermeldung „kein Zugriff" verrät bereits, dass es den Beleg gibt.
 */

import { DateisystemAblage, type Ablage } from '@/ablage'
import { alsBenutzer } from '@/db'

export const ABLAGE: Ablage = new DateisystemAblage(process.env['DMS_ABLAGE'] ?? '.ablage')

export interface Belegkopf {
  id: string
  belegart: string
  seitenzahl: number | null
  eingangAm: string
  ampel: string | null
  objektId: string | null
  objektnummer: string | null
  ordnungsgruppe: string | null
  kreditor: string | null
  brutto: number | null
  rechnungsnummer: string | null
}

export async function belegkopfLaden(
  benutzerId: string,
  dokumentId: string,
): Promise<Belegkopf | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, string | number | null>>(
      `select d.id, d.belegart, d.seitenzahl, d.eingang_am, d.ampel_gesamt,
              d.objekt_id, o.objektnummer, og.name as ordnungsgruppe,
              k.name as kreditor, f.brutto, f.rechnungsnummer
         from dokument d
         left join objekt o on o.id = d.objekt_id
         left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
         left join rechnung_fakten f on f.dokument_id = d.id
         left join kreditor k on k.id = f.kreditor_id
        where d.id = $1`,
      [dokumentId],
    )
    const z = rows[0]
    if (z === undefined) return null
    return {
      id: String(z['id']),
      belegart: String(z['belegart']),
      objektId: z['objekt_id'] == null ? null : String(z['objekt_id']),
      seitenzahl: z['seitenzahl'] === null ? null : Number(z['seitenzahl']),
      eingangAm: String(z['eingang_am']),
      ampel: z['ampel_gesamt'] === null ? null : String(z['ampel_gesamt']),
      objektnummer: z['objektnummer'] === null ? null : String(z['objektnummer']),
      ordnungsgruppe: z['ordnungsgruppe'] === null ? null : String(z['ordnungsgruppe']),
      kreditor: z['kreditor'] === null ? null : String(z['kreditor']),
      brutto: z['brutto'] === null ? null : Number(z['brutto']),
      rechnungsnummer: z['rechnungsnummer'] === null ? null : String(z['rechnungsnummer']),
    }
  })
}

/**
 * Der Ablageschlüssel einer vorgerenderten Seite.
 *
 * Der Viewer liefert ein fertiges Bild aus — gerendert wurde beim Eingang.
 * Genau darin liegt das Geschwindigkeitsversprechen des Konzepts (§1).
 */
export async function seitenbildSchluessel(
  benutzerId: string,
  dokumentId: string,
  seite: number,
  groesse: 'lesen' | 'miniatur',
): Promise<string | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const muster = groesse === 'miniatur' ? '%-miniatur.webp' : '%-lesen.webp'
    const { rows } = await c.query<{ storage_key: string }>(
      `select storage_key from dokument_datei
        where dokument_id = $1 and variante = 'ansicht_webp'
          and seite = $2 and storage_key like $3
        limit 1`,
      [dokumentId, seite, muster],
    )
    return rows[0]?.storage_key ?? null
  })
}

export async function originalSchluessel(
  benutzerId: string,
  dokumentId: string,
): Promise<{ schluessel: string; groesse: number; mime: string } | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ storage_key: string; groesse: string; mime: string }>(
      `select storage_key, groesse, mime from dokument_datei
        where dokument_id = $1 and variante = 'original' limit 1`,
      [dokumentId],
    )
    const z = rows[0]
    if (z === undefined) return null
    return { schluessel: z.storage_key, groesse: Number(z.groesse), mime: z.mime }
  })
}

/** Volltext einer Seite — Grundlage der Trefferhervorhebung ohne Nachladen. */
export async function seitentextLaden(
  benutzerId: string,
  dokumentId: string,
): Promise<Array<{ seite: number; text: string }>> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ seite: number; text: string | null }>(
      'select seite, text from dokument_seite where dokument_id = $1 order by seite',
      [dokumentId],
    )
    return rows.map((r) => ({ seite: r.seite, text: r.text ?? '' }))
  })
}

export interface Befundzeile {
  pruefung: string
  schwere: string
  hinweis: string
}

/**
 * Die Plausibilitätsbefunde eines Belegs.
 *
 * Eine rote Ampel ohne Begründung ist ein Rätsel, kein Hinweis — der
 * Bearbeiter würde selbst suchen, was auffällig ist, und das kostet mehr
 * Zeit, als die Prüfung spart.
 */
export async function befundeLaden(
  benutzerId: string,
  dokumentId: string,
): Promise<Befundzeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Befundzeile>(
      `select pruefung, schwere, hinweis from plausibilitaet_befund
        where dokument_id = $1
        order by case schwere when 'hart' then 0 when 'orange' then 1 else 2 end, pruefung`,
      [dokumentId],
    )
    return rows
  })
}
