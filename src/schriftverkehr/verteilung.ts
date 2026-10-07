/**
 * Verteilung eines Schriftstuecks: Wer bekommt es, und ist es wichtig?
 * (Migration 20261006170000)
 *
 * Beim Bedienen gefragt: "Wie wird sichergestellt, dass der richtige
 * Mitarbeiter das Schreiben erhaelt und bei wichtigen Sachen die
 * Geschaeftsleitung informiert wird?"
 *
 * **Empfaenger**, in dieser Rangfolge (Entscheidung des Hauses):
 *   1. eine im Schreiben genannte Person -- voller Name oder Kuerzel,
 *   2. die feste Zuordnung des Absenders (`schriftverkehr_regel`, art absender),
 *   3. der Spezialist fuers Thema (`spezialgebiet_zustaendigkeit`),
 *   4. der Objektverantwortliche.
 * Die ersten beiden rechnet diese Datei und schreibt sie an den Beleg
 * (`empfaenger_*`); die letzten beiden kennt die Engine schon -- die Stufe
 * mit Zustaendigkeit `ermittelt` nimmt sie als Rueckfall.
 *
 * **Wichtig** ist ein Schreiben, wenn sein Thema `gl_informieren` traegt oder
 * eine passende Regel `wichtig` sagt. Ein Signalwort kann dabei das Thema
 * setzen ("Klage" -> Rechtssache) -- aber nie ueber ein von Hand gesetztes.
 *
 * Alles hier ist **deterministisch und begruendet**: Jeder Treffer steht als
 * Satz am Beleg, und der Belegweg zeigt ihn unter "Warum hier". Kein Modell,
 * keine Aehnlichkeit -- wer "Klage" schreibt, meint Klage.
 */

import type { PoolClient } from 'pg'

export interface Verteilung {
  wichtig: boolean
  wichtigBegruendung: string | null
  /** Das Thema, das eine Regel gesetzt hat -- null, wenn keines gesetzt wurde. */
  ordnungsgruppeId: string | null
  empfaenger: { benutzerId: string | null; gruppeId: string | null; begruendung: string | null }
  /** Hat sich am Beleg etwas geaendert? Dann gehoeren die Aufgaben neu aufgesetzt. */
  geaendert: boolean
}

interface Regel {
  id: string
  art: 'signalwort' | 'absender'
  muster: string
  ordnungsgruppe_id: string | null
  ordnungsgruppe_name: string | null
  wichtig: boolean
  benutzer_id: string | null
  benutzer_name: string | null
  gruppe_id: string | null
  gruppe_name: string | null
}

function regex(muster: string, flags: string): RegExp {
  return new RegExp(muster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
}

/** Ganzes Wort, Gross/Klein egal -- auch vor und nach Umlauten. */
function wortImText(wort: string, text: string): boolean {
  const kern = wort.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${kern}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text)
}

/** Die ersten Zeilen der ersten Seite -- dort steht der Absender. */
function kopf(text: string): string {
  return text.slice(0, 1200)
}

export async function schriftverkehrVerteilen(c: PoolClient, dokumentId: string): Promise<Verteilung> {
  const { rows } = await c.query<{
    mandant_id: string
    belegart: string
    ordnungsgruppe_id: string | null
    kategorie_quelle: string | null
    gl_informieren: boolean | null
    gruppe_name: string | null
    wichtig: boolean
    empfaenger_benutzer_id: string | null
    empfaenger_gruppe_id: string | null
    korrespondent: string | null
    text: string | null
  }>(
    `select d.mandant_id, d.belegart, d.ordnungsgruppe_id, d.kategorie_quelle,
            og.gl_informieren, og.name as gruppe_name,
            d.wichtig, d.empfaenger_benutzer_id, d.empfaenger_gruppe_id,
            sv.korrespondent,
            (select string_agg(s.text, E'\\n' order by s.seite) from dokument_seite s where s.dokument_id = d.id) as text
       from dokument d
       left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
       left join schriftverkehr_fakten sv on sv.dokument_id = d.id
      where d.id = $1`,
    [dokumentId],
  )
  const d = rows[0]
  const unveraendert: Verteilung = {
    wichtig: d?.wichtig ?? false,
    wichtigBegruendung: null,
    ordnungsgruppeId: null,
    empfaenger: { benutzerId: null, gruppeId: null, begruendung: null },
    geaendert: false,
  }
  if (d === undefined || d.belegart !== 'schriftverkehr') return unveraendert

  const text = d.text ?? ''
  const absendertext = d.korrespondent ?? kopf(text)

  const { rows: regeln } = await c.query<Regel>(
    `select r.id, r.art, r.muster, r.ordnungsgruppe_id, og.name as ordnungsgruppe_name, r.wichtig,
            r.benutzer_id, b.name as benutzer_name, r.gruppe_id, g.name as gruppe_name
       from schriftverkehr_regel r
       left join ordnungsgruppe og on og.id = r.ordnungsgruppe_id
       left join benutzer b on b.id = r.benutzer_id
       left join gruppe g on g.id = r.gruppe_id
      where r.mandant_id = $1 and r.aktiv
      order by r.sortierung, r.muster`,
    [d.mandant_id],
  )

  const treffer = regeln.filter((r) =>
    r.art === 'signalwort' ? wortImText(r.muster, text) : regex(r.muster, 'i').test(absendertext),
  )
  const beschreibung = (r: Regel): string =>
    r.art === 'signalwort' ? `Signalwort „${r.muster}“` : `Absender „${r.muster}“`

  // 1. Thema aus der ersten Regel, die eines nennt -- nie ueber einen Menschen.
  let ordnungsgruppeId: string | null = null
  let ordnungsgruppeName = d.gruppe_name
  let glInformieren = d.gl_informieren ?? false
  const themaRegel = treffer.find((r) => r.ordnungsgruppe_id !== null)
  if (themaRegel !== undefined && d.kategorie_quelle !== 'mensch' && d.ordnungsgruppe_id !== themaRegel.ordnungsgruppe_id) {
    ordnungsgruppeId = themaRegel.ordnungsgruppe_id
    ordnungsgruppeName = themaRegel.ordnungsgruppe_name
    const { rows: og } = await c.query<{ gl_informieren: boolean }>(
      'select gl_informieren from ordnungsgruppe where id = $1',
      [ordnungsgruppeId],
    )
    glInformieren = og[0]?.gl_informieren ?? false
    await c.query(
      `update dokument set ordnungsgruppe_id = $2, kategorie_quelle = 'schluesselwort', kategorie_begruendung = $3
        where id = $1`,
      [dokumentId, ordnungsgruppeId, `${beschreibung(themaRegel)} im Schreiben → „${ordnungsgruppeName ?? ''}“.`],
    )
  }

  // 2. Wichtig: Thema oder Regel.
  const gruende: string[] = []
  if (glInformieren) gruende.push(`Thema „${ordnungsgruppeName ?? ''}“ informiert die Geschäftsleitung`)
  for (const r of treffer.filter((r) => r.wichtig)) gruende.push(beschreibung(r))
  const wichtig = gruende.length > 0
  const wichtigBegruendung = wichtig ? gruende.join('; ') + '.' : null

  // 3. Empfaenger: Person im Schreiben, sonst Absenderregel.
  let empfaenger: Verteilung['empfaenger'] = { benutzerId: null, gruppeId: null, begruendung: null }
  const { rows: personen } = await c.query<{ id: string; name: string; kuerzel: string | null }>(
    'select id, name, kuerzel from benutzer where mandant_id = $1 and aktiv order by name',
    [d.mandant_id],
  )
  const genannt = personen.find(
    (p) =>
      wortImText(p.name, text) ||
      (p.kuerzel !== null && new RegExp(`(^|[^\\p{L}\\p{N}])${p.kuerzel}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text)),
  )
  if (genannt !== undefined) {
    empfaenger = {
      benutzerId: genannt.id,
      gruppeId: null,
      begruendung: `${genannt.name} ist im Schreiben genannt${
        wortImText(genannt.name, text) ? '' : ` (Kürzel ${genannt.kuerzel ?? ''})`
      }.`,
    }
  } else {
    const absender = treffer.find((r) => r.art === 'absender' && (r.benutzer_id !== null || r.gruppe_id !== null))
    if (absender !== undefined) {
      empfaenger = {
        benutzerId: absender.benutzer_id,
        gruppeId: absender.gruppe_id,
        begruendung: `${beschreibung(absender)} ist ${
          absender.benutzer_id !== null ? absender.benutzer_name ?? 'einer Person' : `der Gruppe „${absender.gruppe_name ?? ''}“`
        } zugeordnet.`,
      }
    }
  }

  const geaendert =
    ordnungsgruppeId !== null ||
    wichtig !== d.wichtig ||
    empfaenger.benutzerId !== d.empfaenger_benutzer_id ||
    empfaenger.gruppeId !== d.empfaenger_gruppe_id

  await c.query(
    `update dokument
        set wichtig = $2, wichtig_begruendung = $3,
            empfaenger_benutzer_id = $4, empfaenger_gruppe_id = $5, empfaenger_begruendung = $6
      where id = $1`,
    [dokumentId, wichtig, wichtigBegruendung, empfaenger.benutzerId, empfaenger.gruppeId, empfaenger.begruendung],
  )

  return { wichtig, wichtigBegruendung, ordnungsgruppeId, empfaenger, geaendert }
}
