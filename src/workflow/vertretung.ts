/**
 * Vertretung anlegen, ansehen, widerrufen.
 *
 * Grundlage: ADR 0002, Teil C. Eine Vertretung lenkt Aufgaben um — sie
 * überträgt keine Rechte. Der Unterschied ist kein Detail: Ein Rechtemodell,
 * das sich temporär verschiebt, lässt sich später nicht mehr prüfen.
 *
 * Wirksam wird sie in der Engine beim Zuweisen einer Aufgabe. Bereits
 * zugewiesene Aufgaben wandern **nicht** mit — wer eine Aufgabe schon hat,
 * behält sie. Für den Einzelfall gibt es die Zuweisung von Hand.
 */

import { alsBenutzer } from '@/db'

export class VertretungAbgelehnt extends Error {}

export interface Vertretung {
  id: string
  vonBenutzer: string
  vonName: string
  anBenutzer: string
  anName: string
  objekt: string | null
  ordnungsgruppe: string | null
  stufentyp: string | null
  gueltigVon: string
  gueltigBis: string | null
  grund: string | null
  widerrufenAm: string | null
  gilt: boolean
}

const ABFRAGE = `
  select d.id, d.von_benutzer, d.an_benutzer, d.stufentyp, d.gueltig_von,
         d.gueltig_bis, d.grund, d.widerrufen_am,
         vb.name as von_name, ab.name as an_name,
         o.objektnummer, og.name as ordnungsgruppe,
         (d.widerrufen_am is null and d.gueltig_von <= now()
          and (d.gueltig_bis is null or d.gueltig_bis >= now())) as gilt
    from delegation d
    join benutzer vb on vb.id = d.von_benutzer
    join benutzer ab on ab.id = d.an_benutzer
    left join objekt o on o.id = d.objekt_id
    left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
`

function zeile(z: Record<string, unknown>): Vertretung {
  const text = (wert: unknown): string | null => (wert == null ? null : String(wert))
  return {
    id: String(z['id']),
    vonBenutzer: String(z['von_benutzer']),
    vonName: String(z['von_name']),
    anBenutzer: String(z['an_benutzer']),
    anName: String(z['an_name']),
    objekt: text(z['objektnummer']),
    ordnungsgruppe: text(z['ordnungsgruppe']),
    stufentyp: text(z['stufentyp']),
    gueltigVon: String(z['gueltig_von']),
    gueltigBis: text(z['gueltig_bis']),
    grund: text(z['grund']),
    widerrufenAm: text(z['widerrufen_am']),
    gilt: Boolean(z['gilt']),
  }
}

/** Was ich weggegeben habe und was mir übertragen wurde. */
export async function meineVertretungen(
  benutzerId: string,
): Promise<{ abgegeben: Vertretung[]; uebernommen: Vertretung[] }> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `${ABFRAGE} where d.von_benutzer = app.mein_benutzer()
                     or d.an_benutzer = app.mein_benutzer()
        order by d.gueltig_von desc`,
    )
    const alle = rows.map(zeile)
    return {
      abgegeben: alle.filter((v) => v.vonBenutzer === benutzerId),
      uebernommen: alle.filter((v) => v.anBenutzer === benutzerId),
    }
  })
}

export async function vertretungAnlegen(
  benutzerId: string,
  eingabe: {
    anBenutzer: string
    objektId?: string | null
    ordnungsgruppeId?: string | null
    stufentyp?: string | null
    gueltigVon?: string | null
    gueltigBis?: string | null
    grund?: string | null
    /** Für den Ausfall eines anderen — verlangt das Recht `delegieren`. */
    vonBenutzer?: string | null
  },
): Promise<string> {
  return alsBenutzer(benutzerId, async (c) => {
    const von = eingabe.vonBenutzer ?? benutzerId
    if (von === eingabe.anBenutzer) {
      throw new VertretungAbgelehnt('Eine Vertretung an sich selbst ergibt keinen Sinn')
    }

    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into delegation (mandant_id, von_benutzer, an_benutzer, objekt_id,
                                 ordnungsgruppe_id, stufentyp, gueltig_von, gueltig_bis,
                                 grund, erstellt_von)
         select b.mandant_id, $1, $2, $3, $4, $5,
                coalesce($6::timestamptz, now()), $7::timestamptz, $8, app.mein_benutzer()
           from benutzer b where b.id = $1
         returning id`,
        [
          von,
          eingabe.anBenutzer,
          eingabe.objektId ?? null,
          eingabe.ordnungsgruppeId ?? null,
          eingabe.stufentyp ?? null,
          eingabe.gueltigVon ?? null,
          eingabe.gueltigBis ?? null,
          eingabe.grund ?? null,
        ],
      )
      const id = rows[0]?.id
      if (id === undefined) {
        // Die Policy hat die Zeile abgewiesen -- etwa beim Versuch, fuer
        // jemand anderen zu delegieren, ohne das Recht dazu.
        throw new VertretungAbgelehnt('Diese Vertretung dürfen Sie nicht anlegen')
      }
      return id
    } catch (fehler) {
      if (fehler instanceof VertretungAbgelehnt) throw fehler
      const meldung = fehler instanceof Error ? fehler.message : String(fehler)
      if (/row-level security/i.test(meldung)) {
        throw new VertretungAbgelehnt('Diese Vertretung dürfen Sie nicht anlegen')
      }
      if (/delegation_zeitraum/.test(meldung)) {
        throw new VertretungAbgelehnt('Das Ende darf nicht vor dem Beginn liegen')
      }
      throw fehler
    }
  })
}

export async function vertretungWiderrufen(
  benutzerId: string,
  vertretungId: string,
): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rowCount } = await c.query(
      `update delegation set widerrufen_am = now()
        where id = $1 and widerrufen_am is null`,
      [vertretungId],
    )
    if (rowCount === 0) {
      // Entweder schon widerrufen oder die Policy gibt die Zeile nicht frei.
      throw new VertretungAbgelehnt('Diese Vertretung lässt sich nicht widerrufen')
    }
  })
}

/** Benutzer desselben Mandanten — für die Auswahl im Formular. */
export async function benutzerListe(
  benutzerId: string,
): Promise<Array<{ id: string; name: string }>> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string; name: string }>(
      `select id, name from benutzer
        where mandant_id = app.mein_mandant() and aktiv and id <> app.mein_benutzer()
        order by name`,
    )
    return rows
  })
}
