/**
 * Konfiguration der Abläufe — der Baukasten.
 *
 * Grundlage: ADR 0002. Der Ablauf ist ein Blockbaum; hier wird er bearbeitet.
 * Drei Dinge machen das Ändern erst sicher (Konzept 8.8):
 *
 *   * **Versionierung.** Bearbeitet wird nie die aktive Fassung, sondern ein
 *     Entwurf. Laufende Belege behalten ihre Version bis zum Abschluss.
 *   * **Gültigkeitsprüfung.** Vor dem Aktivieren, nicht danach.
 *   * **Simulation.** Zeigt die Kette für einen gedachten Beleg.
 *
 * Jede schreibende Funktion prüft `prozess_konfigurieren`. Das Recht ist
 * nicht dasselbe wie „darf den Beleg sehen": Wer Abläufe ändert, ändert sie
 * für alle.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '@/db'
import { baumLaden, simulieren, type Knoten, type Simulationsschritt } from './baum'
import { bedingungPruefen, type Kontext } from './bedingung'

export class NichtErlaubt extends Error {}
export class NichtMoeglich extends Error {}

export interface Definitionszeile {
  id: string
  belegart: string
  ordnungsgruppe: string | null
  version: number
  status: string
  entwurfVon: string | null
  entwurfVonName: string | null
  laufendeBelege: number
}

async function rechtPruefen(c: PoolClient): Promise<void> {
  const { rows } = await c.query<{ darf: boolean }>(
    `select app.darf('prozess_konfigurieren') as darf`,
  )
  if (rows[0]?.darf !== true) {
    throw new NichtErlaubt('Kein Recht, Abläufe zu konfigurieren')
  }
}

export async function definitionenLaden(benutzerId: string): Promise<Definitionszeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select p.id, p.belegart, p.version, p.status, p.entwurf_von,
              b.name as entwurf_von_name, og.name as ordnungsgruppe,
              (select count(*) from dokument_lauf l
                where l.definition_id = p.id and l.status in ('laufend','klaerung'))
                as laufende_belege
         from prozessdefinition p
         left join benutzer b on b.id = p.entwurf_von
         left join ordnungsgruppe og on og.id = p.ordnungsgruppe_id
        where p.mandant_id = app.mein_mandant()
        order by p.belegart, og.name nulls first, p.version desc`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      belegart: String(z['belegart']),
      ordnungsgruppe: z['ordnungsgruppe'] == null ? null : String(z['ordnungsgruppe']),
      version: Number(z['version']),
      status: String(z['status']),
      entwurfVon: z['entwurf_von'] == null ? null : String(z['entwurf_von']),
      entwurfVonName: z['entwurf_von_name'] == null ? null : String(z['entwurf_von_name']),
      laufendeBelege: Number(z['laufende_belege']),
    }))
  })
}

/**
 * Legt einen Entwurf als Kopie einer bestehenden Fassung an.
 *
 * Kopiert werden Stufen, Baum und Stempelzuordnung. Die Kennungen sind neu:
 * Der Entwurf darf die Stufen der laufenden Fassung nicht teilen, sonst
 * änderte eine Bearbeitung rückwirkend die Belege, die gerade unterwegs sind.
 */
export async function entwurfAnlegen(benutzerId: string, vorlageId: string): Promise<string> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)

    const { rows: vorhandene } = await c.query<{ id: string; name: string | null }>(
      `select p.id, b.name
         from prozessdefinition p
         join prozessdefinition v
           on v.mandant_id = p.mandant_id and v.belegart = p.belegart
          and v.ordnungsgruppe_id is not distinct from p.ordnungsgruppe_id
         left join benutzer b on b.id = p.entwurf_von
        where v.id = $1 and p.status = 'entwurf'`,
      [vorlageId],
    )
    if (vorhandene.length > 0) {
      throw new NichtMoeglich(
        `Es gibt bereits einen Entwurf${vorhandene[0].name === null ? '' : ` (bei ${vorhandene[0].name})`}`,
      )
    }

    const { rows: neu } = await c.query<{ id: string }>(
      `insert into prozessdefinition (mandant_id, belegart, ordnungsgruppe_id, version,
                                      status, erstellt_von, entwurf_von, entwurf_seit)
       select v.mandant_id, v.belegart, v.ordnungsgruppe_id,
              (select coalesce(max(p.version), 0) + 1 from prozessdefinition p
                where p.mandant_id = v.mandant_id and p.belegart = v.belegart
                  and p.ordnungsgruppe_id is not distinct from v.ordnungsgruppe_id),
              'entwurf', app.mein_benutzer(), app.mein_benutzer(), now()
         from prozessdefinition v
        where v.id = $1
       returning id`,
      [vorlageId],
    )
    const entwurfId = neu[0]?.id
    if (entwurfId === undefined) throw new NichtMoeglich('Vorlage nicht gefunden')

    // Stufen kopieren und die alte Kennung mitfuehren, damit Baum und
    // Stempelzuordnung darauf abgebildet werden koennen.
    const { rows: stufen } = await c.query<{ alt: string; neu: string }>(
      `with kopie as (
         insert into prozessstufe (definition_id, reihenfolge, parallelgruppe, stufentyp,
                                   bezeichnung, pflicht, betrag_von, betrag_bis,
                                   zustaendigkeit_typ, zustaendigkeit_ref, sla_stunden,
                                   eskalation_nach_stunden, eskalation_an, vier_augen_pflicht)
         select $2, s.reihenfolge, s.parallelgruppe, s.stufentyp, s.bezeichnung, s.pflicht,
                s.betrag_von, s.betrag_bis, s.zustaendigkeit_typ, s.zustaendigkeit_ref,
                s.sla_stunden, s.eskalation_nach_stunden, s.eskalation_an, s.vier_augen_pflicht
           from prozessstufe s
          where s.definition_id = $1
          order by s.reihenfolge
         returning id, reihenfolge
       )
       select alt.id as alt, kopie.id as neu
         from kopie
         join prozessstufe alt
           on alt.definition_id = $1 and alt.reihenfolge = kopie.reihenfolge`,
      [vorlageId, entwurfId],
    )
    const stufenkarte = new Map(stufen.map((s) => [s.alt, s.neu]))

    // Stempelzuordnung mitnehmen
    for (const [alt, neuId] of stufenkarte) {
      await c.query(
        `insert into prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung)
         select $2, pst.stempeltyp_id, pst.sortierung
           from prozessstufe_stempeltyp pst where pst.stufe_id = $1`,
        [alt, neuId],
      )
    }

    // Baum kopieren: erst die Knoten ohne Eltern, dann die Verweise setzen.
    const { rows: knoten } = await c.query<{
      id: string
      eltern_id: string | null
      reihenfolge: number
      knotentyp: string
      bedingung: unknown
      stufe_id: string | null
    }>(
      `select id, eltern_id, reihenfolge, knotentyp, bedingung, stufe_id
         from prozessknoten where definition_id = $1`,
      [vorlageId],
    )

    // Von oben nach unten kopieren: Ein Knoten wird erst eingefuegt, wenn
    // sein Elternteil schon eine neue Kennung hat.
    //
    // Der naheliegende Weg -- alle Knoten zuerst ohne Elternteil anlegen und
    // die Verweise danach nachtragen -- scheitert an zwei Regeln des Schemas,
    // und zwar zu Recht: Waehrenddessen haette die Definition mehrere
    // Wurzeln, und mehrere Geschwister saessen auf derselben Position.
    const knotenkarte = new Map<string, string>()
    let offen = [...knoten]

    while (offen.length > 0) {
      const bereit = offen.filter(
        (k) => k.eltern_id === null || knotenkarte.has(k.eltern_id),
      )
      if (bereit.length === 0) {
        throw new NichtMoeglich('Der Baum der Vorlage hängt nicht zusammen')
      }

      for (const k of bereit) {
        const { rows } = await c.query<{ id: string }>(
          `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp,
                                      bedingung, stufe_id)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [
            entwurfId,
            k.eltern_id === null ? null : knotenkarte.get(k.eltern_id),
            k.reihenfolge,
            k.knotentyp,
            k.bedingung === null ? null : JSON.stringify(k.bedingung),
            k.stufe_id === null ? null : (stufenkarte.get(k.stufe_id) ?? null),
          ],
        )
        knotenkarte.set(k.id, rows[0].id)
      }

      offen = offen.filter((k) => !knotenkarte.has(k.id))
    }

    await c.query(
      `insert into prozessdefinition_ereignis (definition_id, art, benutzer_id, hinweis)
       values ($1, 'angelegt', app.mein_benutzer(), $2)`,
      [entwurfId, `Kopie von Version ${vorlageId}`],
    )

    return entwurfId
  })
}

async function entwurfPruefen(c: PoolClient, definitionId: string): Promise<void> {
  const { rows } = await c.query<{ status: string; entwurf_von: string | null }>(
    'select status, entwurf_von from prozessdefinition where id = $1',
    [definitionId],
  )
  const d = rows[0]
  if (d === undefined) throw new NichtMoeglich('Fassung nicht gefunden')
  if (d.status !== 'entwurf') {
    throw new NichtMoeglich('Nur ein Entwurf lässt sich bearbeiten, keine aktive Fassung')
  }
  const { rows: ich } = await c.query<{ id: string }>('select app.mein_benutzer() as id')
  if (d.entwurf_von !== null && d.entwurf_von !== ich[0]?.id) {
    throw new NichtMoeglich('Dieser Entwurf wird gerade von jemand anderem bearbeitet')
  }
}

/** Hängt einen Baustein unter einen Behälter. */
export async function knotenEinfuegen(
  benutzerId: string,
  definitionId: string,
  eingabe: {
    elternId: string
    knotentyp: 'nacheinander' | 'gleichzeitig' | 'verzweigung' | 'stufe'
    stufeId?: string | null
    bedingung?: unknown
  },
): Promise<string> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)
    await entwurfPruefen(c, definitionId)

    if (eingabe.bedingung !== undefined && eingabe.bedingung !== null) {
      const befunde = bedingungPruefen(eingabe.bedingung)
      if (befunde.length > 0) throw new NichtMoeglich(befunde.join(' '))
    }

    const { rows: naechste } = await c.query<{ position: number }>(
      `select coalesce(max(reihenfolge) + 1, 0) as position
         from prozessknoten where eltern_id = $1`,
      [eingabe.elternId],
    )

    const { rows } = await c.query<{ id: string }>(
      `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp,
                                  bedingung, stufe_id)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        definitionId,
        eingabe.elternId,
        naechste[0].position,
        eingabe.knotentyp,
        eingabe.bedingung === undefined || eingabe.bedingung === null
          ? null
          : JSON.stringify(eingabe.bedingung),
        eingabe.stufeId ?? null,
      ],
    )
    return rows[0].id
  })
}

/**
 * Verschiebt einen Baustein unter seinen Geschwistern.
 *
 * Bewusst nur innerhalb des Behälters: Ein Baustein wechselt seinen Platz,
 * nicht seine Ebene. Für den Ebenenwechsel gibt es Einfügen und Entfernen —
 * das ist umständlicher, aber es kann keinen Baum zerreißen.
 */
export async function knotenVerschieben(
  benutzerId: string,
  definitionId: string,
  knotenId: string,
  richtung: 'hoch' | 'runter',
): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)
    await entwurfPruefen(c, definitionId)

    const { rows } = await c.query<{ eltern_id: string | null; reihenfolge: number }>(
      'select eltern_id, reihenfolge from prozessknoten where id = $1 and definition_id = $2',
      [knotenId, definitionId],
    )
    const knoten = rows[0]
    if (knoten === undefined) throw new NichtMoeglich('Baustein nicht gefunden')
    if (knoten.eltern_id === null) throw new NichtMoeglich('Die Wurzel lässt sich nicht bewegen')

    const vergleich = richtung === 'hoch' ? '<' : '>'
    const sortierung = richtung === 'hoch' ? 'desc' : 'asc'
    const { rows: nachbarn } = await c.query<{ id: string; reihenfolge: number }>(
      `select id, reihenfolge from prozessknoten
        where eltern_id = $1 and reihenfolge ${vergleich} $2
        order by reihenfolge ${sortierung} limit 1`,
      [knoten.eltern_id, knoten.reihenfolge],
    )
    const nachbar = nachbarn[0]
    if (nachbar === undefined) return // schon ganz oben oder unten

    // Ueber eine freie Position tauschen: die Eindeutigkeit der
    // Geschwisterposition gilt auch waehrend des Tauschs.
    await c.query('update prozessknoten set reihenfolge = -1 where id = $1', [knotenId])
    await c.query('update prozessknoten set reihenfolge = $2 where id = $1', [
      nachbar.id,
      knoten.reihenfolge,
    ])
    await c.query('update prozessknoten set reihenfolge = $2 where id = $1', [
      knotenId,
      nachbar.reihenfolge,
    ])
  })
}

export async function knotenEntfernen(
  benutzerId: string,
  definitionId: string,
  knotenId: string,
): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)
    await entwurfPruefen(c, definitionId)

    const { rows } = await c.query<{ eltern_id: string | null }>(
      'select eltern_id from prozessknoten where id = $1 and definition_id = $2',
      [knotenId, definitionId],
    )
    if (rows[0] === undefined) throw new NichtMoeglich('Baustein nicht gefunden')
    if (rows[0].eltern_id === null) throw new NichtMoeglich('Die Wurzel lässt sich nicht entfernen')

    // Kinder gehen mit -- das ist der Sinn eines Bausteins: Er ist ein Block,
    // kein loser Knoten.
    await c.query('delete from prozessknoten where id = $1', [knotenId])
  })
}

export interface Befund {
  schwere: string
  befund: string
}

export async function entwurfPruefung(
  benutzerId: string,
  definitionId: string,
): Promise<Befund[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Befund>(
      'select schwere, befund from app.prozessbaum_pruefen($1)',
      [definitionId],
    )
    return rows
  })
}

/**
 * Schaltet einen Entwurf scharf.
 *
 * Erst prüfen, dann aktivieren, dann die bisherige Fassung ablösen — in
 * dieser Reihenfolge und in einer Transaktion. Ein Fehler in der Prüfung
 * lässt alles unverändert; es gibt keinen Zwischenzustand, in dem zwei
 * Fassungen aktiv sind oder keine.
 */
export async function entwurfAktivieren(
  benutzerId: string,
  definitionId: string,
): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)
    await entwurfPruefen(c, definitionId)

    const { rows: befunde } = await c.query<Befund>(
      `select schwere, befund from app.prozessbaum_pruefen($1) where schwere = 'fehler'`,
      [definitionId],
    )
    if (befunde.length > 0) {
      throw new NichtMoeglich(
        `Der Ablauf ist nicht gültig: ${befunde.map((b) => b.befund).join(' ')}`,
      )
    }

    await c.query(
      `update prozessdefinition alt
          set status = 'abgeloest', aktiv_bis = now()
         from prozessdefinition neu
        where neu.id = $1
          and alt.mandant_id = neu.mandant_id
          and alt.belegart = neu.belegart
          and alt.ordnungsgruppe_id is not distinct from neu.ordnungsgruppe_id
          and alt.status = 'aktiv'`,
      [definitionId],
    )

    await c.query(
      `update prozessdefinition
          set status = 'aktiv', aktiv_ab = now(), entwurf_von = null, entwurf_seit = null
        where id = $1`,
      [definitionId],
    )

    await c.query(
      `insert into prozessdefinition_ereignis (definition_id, art, benutzer_id)
       values ($1, 'aktiviert', app.mein_benutzer())`,
      [definitionId],
    )
  })
}

/** Die Kette, die sich für einen gedachten Beleg ergibt (Konzept 8.8). */
export async function fassungSimulieren(
  benutzerId: string,
  definitionId: string,
  kontext: Kontext,
): Promise<Simulationsschritt[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const wurzel = await baumLaden(c, definitionId)
    return wurzel === null ? [] : simulieren(wurzel, kontext)
  })
}

export async function baumFuerAnzeige(
  benutzerId: string,
  definitionId: string,
): Promise<Knoten | null> {
  return alsBenutzer(benutzerId, (c) => baumLaden(c, definitionId))
}
