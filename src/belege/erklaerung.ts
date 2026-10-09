/**
 * Warum ist dieser Beleg hier?
 *
 * Vier Saetze je Beleg -- Objekt, Kategorie, Ablauf, Bearbeiter --, jeder mit
 * seinem Grund. Im abzuloesenden System muss man dafuer alle Magneten
 * gleichzeitig lesen (docs/analyse-amagno-bestand.md, Abschnitt 1); hier
 * sagt der Beleg es selbst.
 *
 * **Zwei Arten von Grund.** Ablauf und Bearbeiter folgen Regeln, die noch
 * gelten -- sie werden hier **abgeleitet**, aus `ordnungsgruppe.
 * prozessdefinition_id` und der Zustaendigkeit der Stufe. Objekt und
 * Kategorie sind eine Tatsache des Augenblicks, in dem sie zugeordnet
 * wurden -- welches Muster damals griff, was damals am Kreditor stand. Sie
 * werden **gelesen**, aus den Spalten, die die Aufbereitung im Moment der
 * Zuordnung beschreibt (Migration 20260922100000). Nachrechnen wuerde
 * womoeglich einen anderen Grund liefern als den, der gewirkt hat.
 *
 * Laeuft unter der RLS: Wer den Beleg nicht sehen darf, bekommt auch keine
 * Erklaerung dazu -- und die Personen, die hier genannt werden, sind die,
 * die der Fragende ohnehin im Rollenmodell sieht.
 */

import { alsBenutzer } from '../db'
import { belegartName } from '../lernen/belegart'

export interface Erklaerungszeile {
  /** Was gilt -- "Objekt 42", "Betriebskosten", "Rechnung, Fassung 1". */
  was: string
  /** Warum -- ein Satz. */
  warum: string
}

export interface Erklaerung {
  /** Die Belegart und woher sie stammt -- Eingangsweg, Inhalt oder Mensch. */
  belegart: Erklaerungszeile | null
  objekt: Erklaerungszeile | null
  kategorie: Erklaerungszeile | null
  ablauf: Erklaerungszeile | null
  /** Die offene Stufe und wer sie bearbeiten kann. */
  stufe: (Erklaerungszeile & { personen: string[] }) | null
  /** Schriftverkehr: der ermittelte Empfaenger und warum (Migration 20261006170000). */
  empfaenger: Erklaerungszeile | null
  /** Schriftverkehr: wichtig -- und woran das lag. */
  wichtig: Erklaerungszeile | null
}

const QUELLE: Record<string, string> = {
  kreditor: 'am Kreditor als übliche Kategorie hinterlegt',
  muster: 'aus gelernten Kontierungen dieses Kreditors',
  schluesselwort: 'über ein Schlüsselwort im Belegtext',
  eingangsquelle: 'von der Eingangsquelle vorgegeben',
  mensch: 'von Hand gesetzt',
}

export async function zuordnungErklaeren(
  benutzerId: string,
  dokumentId: string,
): Promise<Erklaerung | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select d.belegart, d.belegart_quelle, d.belegart_begruendung,
              o.objektnummer, d.objekt_begruendung,
              og.name as kategorie, d.kategorie_quelle, d.kategorie_begruendung,
              og.prozessdefinition_id as kategorie_ablauf,
              p.id as ablauf_id, p.belegart as ablauf_belegart,
              p.ablage_id as ablauf_ablage, pab.name as ablauf_ablage_name,
              l.definition_version, p.ordnungsgruppe_id as ablauf_kategorie,
              s.id as stufe_id, s.bezeichnung as stufe, s.zustaendigkeit_typ,
              s.zustaendigkeit_ref,
              r.name as rolle, g.name as gruppe, sg.name as spezialgebiet,
              zb.name as zugewiesen,
              d.wichtig, d.wichtig_begruendung, d.empfaenger_begruendung,
              eb.name as empfaenger_benutzer, eg.name as empfaenger_gruppe
         from dokument d
         left join benutzer eb on eb.id = d.empfaenger_benutzer_id
         left join gruppe eg on eg.id = d.empfaenger_gruppe_id
         left join objekt o on o.id = d.objekt_id
         left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
         left join dokument_lauf l on l.dokument_id = d.id
         left join prozessdefinition p on p.id = l.definition_id
         left join ablage pab on pab.id = p.ablage_id
         left join aufgabe a on a.lauf_id = l.id and a.status in ('offen','in_arbeit')
         left join prozessstufe s on s.id = a.stufe_id
         left join rolle r on s.zustaendigkeit_typ = 'rolle' and r.id = s.zustaendigkeit_ref
         left join gruppe g on s.zustaendigkeit_typ = 'gruppe' and g.id = s.zustaendigkeit_ref
         left join spezialgebiet sg on sg.id = d.spezialgebiet_id
         left join benutzer zb on zb.id = a.zugewiesen_benutzer
        where d.id = $1
        order by a.faellig_am nulls last
        limit 1`,
      [dokumentId],
    )
    const z = rows[0]
    if (z === undefined) return null
    const text = (w: unknown): string | null => (w == null ? null : String(w))

    const belegartQuelle = text(z['belegart_quelle'])
    const belegart: Erklaerungszeile = {
      was: belegartName(text(z['belegart']) ?? ''),
      warum:
        text(z['belegart_begruendung']) ??
        (belegartQuelle === 'mensch'
          ? 'von Hand gesetzt'
          : belegartQuelle === 'erkannt'
            ? 'aus dem Inhalt erkannt'
            : 'vom Eingangsweg vorgegeben — im Text kein Merkmal einer anderen Belegart'),
    }

    const objekt: Erklaerungszeile | null =
      text(z['objektnummer']) === null
        ? null
        : {
            was: `Objekt ${text(z['objektnummer'])}`,
            warum:
              text(z['objekt_begruendung']) ??
              'ohne aufgezeichneten Grund — zugeordnet, bevor Gründe festgehalten wurden.',
          }

    const quelle = text(z['kategorie_quelle'])
    const kategorie: Erklaerungszeile | null =
      text(z['kategorie']) === null
        ? null
        : {
            was: text(z['kategorie']) ?? '',
            warum:
              text(z['kategorie_begruendung']) ??
              (quelle !== null && QUELLE[quelle] !== undefined
                ? QUELLE[quelle]
                : 'ohne aufgezeichneten Grund — gesetzt, bevor Gründe festgehalten wurden.'),
          }

    let ablauf: Erklaerungszeile | null = null
    if (text(z['ablauf_id']) !== null) {
      const fassung = `${text(z['ablauf_belegart'])}, Fassung ${String(z['definition_version'])}${
        text(z['ablauf_ablage_name']) === null ? '' : ` (Ablage „${text(z['ablauf_ablage_name'])}“)`
      }`
      let warum: string
      if (text(z['ablauf_ablage']) !== null) {
        warum = `Die Ablage „${text(z['ablauf_ablage_name'])}“ hat einen eigenen Ablauf für diese Belegart — Ablage vor Kategorie.`
      } else if (text(z['kategorie_ablauf']) !== null && z['kategorie_ablauf'] === z['ablauf_id']) {
        warum = `Die Kategorie „${text(z['kategorie'])}“ benennt diesen Ablauf.`
      } else if (text(z['ablauf_kategorie']) !== null) {
        warum = `Ablauf für die Belegart und die Kategorie „${text(z['kategorie'])}“.`
      } else {
        warum =
          text(z['kategorie']) === null
            ? `Standardablauf für die Belegart — der Beleg hat keine Kategorie.`
            : `Standardablauf für die Belegart — die Kategorie „${text(z['kategorie'])}“ benennt keinen eigenen.`
      }
      ablauf = { was: fassung, warum }
    }

    let stufe: (Erklaerungszeile & { personen: string[] }) | null = null
    const stufeId = text(z['stufe_id'])
    if (stufeId !== null) {
      const typ = text(z['zustaendigkeit_typ']) ?? ''
      const { rows: personen } = await c.query<{ name: string }>(
        `select distinct b.name
           from dokument d
           join prozessstufe s on s.id = $2
           join benutzer b on b.mandant_id = d.mandant_id and b.aktiv
          where d.id = $1
            and (
              (s.zustaendigkeit_typ = 'objektverantwortlich' and exists (
                 select 1 from objekt_zustaendigkeit oz
                  where oz.objekt_id = d.objekt_id and oz.benutzer_id = b.id
                    and oz.gueltig_von <= current_date
                    and (oz.gueltig_bis is null or oz.gueltig_bis >= current_date)))
              or (s.zustaendigkeit_typ = 'rolle' and exists (
                 select 1 from benutzer_rolle_objekt bro
                  where bro.rolle_id = s.zustaendigkeit_ref and bro.benutzer_id = b.id
                    and (bro.objekt_id = d.objekt_id or bro.objekt_id is null)
                    and bro.gueltig_von <= current_date
                    and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)))
              or (s.zustaendigkeit_typ = 'gruppe' and exists (
                 select 1 from gruppe_mitglied gm
                  where gm.gruppe_id = s.zustaendigkeit_ref and gm.benutzer_id = b.id))
              or (s.zustaendigkeit_typ = 'spezialgebiet' and exists (
                 select 1 from spezialgebiet_zustaendigkeit sz
                  where sz.spezialgebiet_id = d.spezialgebiet_id
                    and (sz.objekt_id is null or sz.objekt_id = d.objekt_id)
                    and (sz.benutzer_id = b.id or exists (
                          select 1 from gruppe_mitglied gm
                           where gm.gruppe_id = sz.gruppe_id and gm.benutzer_id = b.id))))
              -- Ermittelter Empfaenger: Person, sonst Gruppe, sonst Spezialgebiet, sonst Objekt.
              or (s.zustaendigkeit_typ = 'ermittelt' and (
                 b.id = d.empfaenger_benutzer_id
                 or (d.empfaenger_benutzer_id is null and d.empfaenger_gruppe_id is not null and exists (
                      select 1 from gruppe_mitglied gm
                       where gm.gruppe_id = d.empfaenger_gruppe_id and gm.benutzer_id = b.id))
                 or (d.empfaenger_benutzer_id is null and d.empfaenger_gruppe_id is null and (
                      exists (
                        select 1 from spezialgebiet_zustaendigkeit sz
                         where sz.spezialgebiet_id = d.spezialgebiet_id
                           and (sz.objekt_id is null or sz.objekt_id = d.objekt_id)
                           and (sz.benutzer_id = b.id or exists (
                                 select 1 from gruppe_mitglied gm
                                  where gm.gruppe_id = sz.gruppe_id and gm.benutzer_id = b.id)))
                      or (not exists (
                            select 1 from spezialgebiet_zustaendigkeit sz
                             where sz.spezialgebiet_id = d.spezialgebiet_id
                               and (sz.objekt_id is null or sz.objekt_id = d.objekt_id))
                          and exists (
                            select 1 from objekt_zustaendigkeit oz
                             where oz.objekt_id = d.objekt_id and oz.benutzer_id = b.id
                               and oz.gueltig_von <= current_date
                               and (oz.gueltig_bis is null or oz.gueltig_bis >= current_date)))))))
            )
          order by b.name`,
        [dokumentId, stufeId],
      )

      const warum: Record<string, string> = {
        objektverantwortlich: `Zuständig ist, wer für Objekt ${text(z['objektnummer']) ?? '—'} verantwortlich ist.`,
        rolle: `Zuständig ist die Rolle „${text(z['rolle']) ?? '—'}“.`,
        gruppe: `Zuständig ist die Gruppe „${text(z['gruppe']) ?? '—'}“.`,
        spezialgebiet:
          text(z['spezialgebiet']) === null
            ? 'Zuständig wäre ein Spezialgebiet — der Beleg hat keines.'
            : `Zuständig ist das Spezialgebiet „${text(z['spezialgebiet'])}“, abgeleitet aus der Kategorie.`,
        extern: 'Eine externe Stelle prüft.',
        system: 'Das System handelt selbst.',
        ermittelt:
          text(z['empfaenger_begruendung']) ??
          (text(z['spezialgebiet']) !== null
            ? `Ermittelter Empfänger: niemand im Schreiben genannt, kein Absender hinterlegt — der Spezialist für „${text(z['spezialgebiet'])}“.`
            : `Ermittelter Empfänger: niemand im Schreiben genannt, kein Absender hinterlegt, kein Spezialgebiet — wer für Objekt ${text(z['objektnummer']) ?? '—'} verantwortlich ist.`),
      }
      const zugewiesen = text(z['zugewiesen'])
      stufe = {
        was: text(z['stufe']) ?? '',
        warum:
          (warum[typ] ?? `Zuständigkeit: ${typ}.`) +
          (zugewiesen !== null ? ` Zugewiesen an ${zugewiesen}.` : ''),
        personen: personen.map((p) => p.name),
      }
    }

    const empfaengerName = text(z['empfaenger_benutzer']) ?? (text(z['empfaenger_gruppe']) === null ? null : `Gruppe „${text(z['empfaenger_gruppe'])}“`)
    const empfaenger: Erklaerungszeile | null =
      empfaengerName === null
        ? null
        : { was: empfaengerName, warum: text(z['empfaenger_begruendung']) ?? 'aus den Verteilregeln.' }

    const wichtig: Erklaerungszeile | null =
      z['wichtig'] === true
        ? { was: 'Wichtig — Geschäftsleitung wird informiert', warum: text(z['wichtig_begruendung']) ?? 'ohne aufgezeichneten Grund.' }
        : null

    return { belegart, objekt, kategorie, ablauf, stufe, empfaenger, wichtig }
  })
}
