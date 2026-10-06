/**
 * Einen Beleg in eine andere Ablage legen.
 *
 * Die Ablage ist Ablagemerkmal, kein Teil des Belegs -- deshalb darf sie
 * auch nach der Archivierung wechseln (wie die Ordnungsgruppe, Konzept 18).
 * Wer wechselt, braucht `bearbeiten` in der **Zielablage** (sonst legte
 * jemand Belege dorthin, wo er selbst nicht hin darf) und sieht den Beleg
 * ohnehin nur, wenn er die Quellablage sieht. Der Wechsel ist eine
 * Handlung eines Menschen: `ablage_quelle = 'mensch'`, und die Erkennung
 * ruehrt die Ablage danach nicht mehr an. Begruendung Pflicht, Spur in
 * `korrektur_ereignis`.
 */

import { alsBenutzer } from '../db'

export class AblagewechselAbgelehnt extends Error {}

export async function ablageWechseln(
  benutzerId: string,
  dokumentId: string,
  ablageId: string,
  grund: string,
): Promise<{ von: string; nach: string }> {
  const begruendung = grund.trim()
  if (begruendung === '') throw new AblagewechselAbgelehnt('Ein Ablagewechsel braucht eine Begründung.')
  // Kein Formularwert in einem uuid-Vergleich: Ein leeres Feld waere sonst
  // ein Datenbankfehler statt eines Satzes.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ablageId)) {
    throw new AblagewechselAbgelehnt('Bitte eine Ablage wählen.')
  }

  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ alt_id: string; alt: string; neu: string | null; objekt_id: string | null; darf: boolean }>(
      `select d.ablage_id as alt_id, a.name as alt, z.name as neu, d.objekt_id,
              dms.darf_in_ablage('bearbeiten', $2, d.objekt_id, d.belegart, d.ordnungsgruppe_id) as darf
         from dokument d
         join ablage a on a.id = d.ablage_id
         left join ablage z on z.id = $2 and z.aktiv
        where d.id = $1`,
      [dokumentId, ablageId],
    )
    const z = rows[0]
    if (z === undefined) throw new AblagewechselAbgelehnt('Diesen Beleg gibt es nicht, oder er ist nicht sichtbar.')
    if (z.neu === null) throw new AblagewechselAbgelehnt('Diese Ablage gibt es nicht oder sie ist deaktiviert.')
    if (z.alt_id === ablageId) throw new AblagewechselAbgelehnt('Der Beleg liegt schon in dieser Ablage.')
    if (!z.darf) throw new AblagewechselAbgelehnt(`In die Ablage „${z.neu}“ legen darf, wer dort bearbeiten darf.`)

    const { rowCount } = await c.query(
      `update dokument set ablage_id = $2, ablage_quelle = 'mensch' where id = $1`,
      [dokumentId, ablageId],
    )
    if ((rowCount ?? 0) === 0) throw new AblagewechselAbgelehnt('Der Beleg lässt sich nicht ändern.')

    // Name **und** Kennung: Nach einer Umbenennung bleibt die Spur eindeutig.
    await c.query(
      `insert into korrektur_ereignis (dokument_id, feld, vorschlag, korrektur, benutzer_id, wirkung)
       values ($1, 'ablage', $2, $3, dms.mein_benutzer(), 'einmalig')`,
      [dokumentId, `${z.alt} (${z.alt_id})`, `${z.neu} (${ablageId}) — ${begruendung}`],
    )
    return { von: z.alt, nach: z.neu }
  })
}
