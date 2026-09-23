/**
 * Stufen als Liste -- der Normalfall des Baukastens (Konzept 8.8).
 *
 * Der Baukasten konnte Behaelter einfuegen, verschieben und entfernen --
 * aber keine **Stufe** anlegen und keine aendern. Ein neuer Ablauf war damit
 * in der Oberflaeche nicht zu bauen, nur zu kopieren. Was im abzuloesenden
 * System die Steuerung schwer macht, ist genau diese Stelle: wer darf, mit
 * welchem Stempel, ab welchem Betrag. Hier ist es eine Zeile je Stufe.
 *
 * Dieselben Regeln wie fuer jeden Baustein: nur im Entwurf, nur mit dem
 * Recht `prozess_konfigurieren`, nur von dem, der den Entwurf haelt.
 */

import type { PoolClient } from 'pg'
import { alsBenutzer } from '@/db'
import { entwurfPruefen, NichtMoeglich, rechtPruefen } from './konfiguration'

export const STUFENTYPEN = [
  'zuordnung',
  'sachlich',
  'rechnerisch',
  'freigabe',
  'kontierung',
  'zahlung',
  'extern_pruefung',
  'systemaktion',
] as const
export type Stufentyp = (typeof STUFENTYPEN)[number]

export const STUFENTYP_NAMEN: Record<Stufentyp, string> = {
  zuordnung: 'Zuordnung',
  sachlich: 'Sachliche Prüfung',
  rechnerisch: 'Rechnerische Prüfung',
  freigabe: 'Freigabe',
  kontierung: 'Kontierung',
  zahlung: 'Zahlung',
  extern_pruefung: 'Externe Prüfung',
  systemaktion: 'Systemaktion',
}

export const ZUSTAENDIGKEITEN = [
  'objektverantwortlich',
  'rolle',
  'gruppe',
  'spezialgebiet',
  'extern',
  'system',
] as const
export type Zustaendigkeit = (typeof ZUSTAENDIGKEITEN)[number]

export const ZUSTAENDIGKEIT_NAMEN: Record<Zustaendigkeit, string> = {
  objektverantwortlich: 'Objektverantwortliche',
  rolle: 'Rolle',
  gruppe: 'Gruppe',
  spezialgebiet: 'Spezialgebiet',
  extern: 'Extern',
  system: 'System',
}

/** Was eine Stufe ausmacht -- die Zeile im Listeneditor. */
export interface Stufeneingabe {
  bezeichnung: string
  stufentyp: string
  zustaendigkeitTyp: string
  zustaendigkeitRef: string | null
  betragVon: number | null
  betragBis: number | null
  pflicht: boolean
  slaStunden: number | null
  stempeltypIds: string[]
}

export interface Auswahl {
  rollen: Array<{ id: string; name: string }>
  gruppen: Array<{ id: string; name: string }>
  spezialgebiete: Array<{ id: string; name: string }>
  stempeltypen: Array<{ id: string; name: string; entscheidung: string }>
}

/** Die Listen fuer das Stufenformular -- alles, was der Mandant hat. */
export async function auswahlLaden(benutzerId: string): Promise<Auswahl> {
  return alsBenutzer(benutzerId, async (c) => {
    const liste = async (sql: string) => (await c.query<{ id: string; name: string }>(sql)).rows
    return {
      rollen: await liste('select id, name from rolle where aktiv order by name'),
      gruppen: await liste('select id, name from gruppe where aktiv order by name'),
      spezialgebiete: await liste('select id, name from spezialgebiet where aktiv order by name'),
      stempeltypen: (
        await c.query<{ id: string; name: string; entscheidung: string }>(
          'select id, name, entscheidung from stempeltyp where aktiv order by entscheidung, name',
        )
      ).rows,
    }
  })
}

const REF_TABELLE: Partial<Record<Zustaendigkeit, string>> = {
  rolle: 'rolle',
  gruppe: 'gruppe',
  spezialgebiet: 'spezialgebiet',
}

/**
 * Prueft eine Stufeneingabe -- fachlich und gegen die Stammdaten des
 * Mandanten.
 *
 * Die Verweise (Rolle, Gruppe, Spezialgebiet, Stempeltypen) werden **unter
 * der RLS** nachgeschlagen: Ein Fremdschluessel prueft nur, dass es die
 * Zeile gibt, nicht, dass sie zum eigenen Haus gehoert. Eine Kennung aus
 * einem anderen Mandanten faende die Fremdschluesselpruefung -- die Policy
 * findet sie nicht, und dann ist sie hier ungueltig.
 */
async function stufeneingabePruefen(c: PoolClient, e: Stufeneingabe): Promise<Stufeneingabe> {
  const bezeichnung = e.bezeichnung.trim()
  if (bezeichnung === '' || bezeichnung.length > 80) {
    throw new NichtMoeglich('Eine Stufe braucht eine Bezeichnung (bis 80 Zeichen).')
  }
  if (!(STUFENTYPEN as readonly string[]).includes(e.stufentyp)) {
    throw new NichtMoeglich(`Unbekannter Stufentyp: ${e.stufentyp}`)
  }
  if (!(ZUSTAENDIGKEITEN as readonly string[]).includes(e.zustaendigkeitTyp)) {
    throw new NichtMoeglich(`Unbekannte Zuständigkeit: ${e.zustaendigkeitTyp}`)
  }
  const typ = e.zustaendigkeitTyp as Zustaendigkeit
  const tabelle = REF_TABELLE[typ]
  let ref: string | null = null
  if (tabelle !== undefined) {
    if (e.zustaendigkeitRef === null || e.zustaendigkeitRef === '') {
      throw new NichtMoeglich(`Zuständigkeit „${ZUSTAENDIGKEIT_NAMEN[typ]}“ braucht eine Auswahl.`)
    }
    // Tabellenname aus einer festen Liste, nicht aus der Eingabe.
    const { rows } = await c.query<{ id: string }>(`select id from ${tabelle} where id = $1 and aktiv`, [
      e.zustaendigkeitRef,
    ])
    if (rows[0] === undefined) throw new NichtMoeglich('Die gewählte Zuständigkeit gibt es nicht.')
    ref = rows[0].id
  }
  const betrag = (wert: number | null, name: string): number | null => {
    if (wert === null) return null
    if (!Number.isFinite(wert) || wert < 0) throw new NichtMoeglich(`${name} muss eine Zahl ab 0 sein.`)
    return Math.round(wert * 100) / 100
  }
  const betragVon = betrag(e.betragVon, 'Betrag ab')
  const betragBis = betrag(e.betragBis, 'Betrag bis')
  if (betragVon !== null && betragBis !== null && betragBis < betragVon) {
    throw new NichtMoeglich('„Betrag bis“ liegt unter „Betrag ab“.')
  }
  if (e.slaStunden !== null && (!Number.isInteger(e.slaStunden) || e.slaStunden <= 0)) {
    throw new NichtMoeglich('Die Frist ist eine ganze Zahl von Stunden.')
  }
  const stempel = [...new Set(e.stempeltypIds.filter((s) => s !== ''))]
  if (stempel.length > 0) {
    const { rows } = await c.query<{ n: string }>(
      'select count(*) as n from stempeltyp where id = any($1::uuid[]) and aktiv',
      [stempel],
    )
    if (Number(rows[0]?.n) !== stempel.length) {
      throw new NichtMoeglich('Mindestens ein gewählter Stempel gehört nicht zu diesem Haus oder ist inaktiv.')
    }
  }
  return {
    bezeichnung,
    stufentyp: e.stufentyp,
    zustaendigkeitTyp: e.zustaendigkeitTyp,
    zustaendigkeitRef: ref,
    betragVon,
    betragBis,
    pflicht: e.pflicht,
    slaStunden: e.slaStunden,
    stempeltypIds: stempel,
  }
}

async function stempelSetzen(c: PoolClient, stufeId: string, stempeltypIds: string[]): Promise<void> {
  await c.query('delete from prozessstufe_stempeltyp where stufe_id = $1', [stufeId])
  for (const [i, id] of stempeltypIds.entries()) {
    await c.query(
      'insert into prozessstufe_stempeltyp (stufe_id, stempeltyp_id, sortierung) values ($1, $2, $3)',
      [stufeId, id, i],
    )
  }
}

/**
 * Legt eine Stufe an und haengt sie als Blatt in den Baum -- unter den
 * gewaehlten Behaelter, sonst ans Ende der Wurzel.
 */
export async function stufeAnlegen(
  benutzerId: string,
  definitionId: string,
  eingabe: Stufeneingabe,
  elternId: string | null = null,
): Promise<string> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)
    await entwurfPruefen(c, definitionId)
    const e = await stufeneingabePruefen(c, eingabe)

    const { rows: eltern } = await c.query<{ id: string; knotentyp: string }>(
      elternId === null
        ? 'select id, knotentyp from prozessknoten where definition_id = $1 and eltern_id is null'
        : 'select id, knotentyp from prozessknoten where definition_id = $1 and id = $2',
      elternId === null ? [definitionId] : [definitionId, elternId],
    )
    const behaelter = eltern[0]
    if (behaelter === undefined) throw new NichtMoeglich('Der Behälter gehört nicht zu diesem Entwurf.')
    if (behaelter.knotentyp === 'stufe') throw new NichtMoeglich('Unter eine Stufe lässt sich nichts hängen.')

    const { rows: stufe } = await c.query<{ id: string }>(
      `insert into prozessstufe (definition_id, reihenfolge, stufentyp, bezeichnung, pflicht,
                                 betrag_von, betrag_bis, zustaendigkeit_typ, zustaendigkeit_ref, sla_stunden)
       values ($1, (select coalesce(max(reihenfolge), 0) + 1 from prozessstufe where definition_id = $1),
               $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        definitionId,
        e.stufentyp,
        e.bezeichnung,
        e.pflicht,
        e.betragVon,
        e.betragBis,
        e.zustaendigkeitTyp,
        e.zustaendigkeitRef,
        e.slaStunden,
      ],
    )
    const stufeId = stufe[0]?.id
    if (stufeId === undefined) throw new NichtMoeglich('Die Stufe wurde nicht angelegt.')
    await stempelSetzen(c, stufeId, e.stempeltypIds)

    await c.query(
      `insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp, stufe_id)
       values ($1, $2, (select coalesce(max(reihenfolge) + 1, 0) from prozessknoten where eltern_id = $2),
               'stufe', $3)`,
      [definitionId, behaelter.id, stufeId],
    )
    return stufeId
  })
}

/** Aendert eine Stufe des Entwurfs -- alle Felder, die Stempel als Ganzes. */
export async function stufeAendern(
  benutzerId: string,
  definitionId: string,
  stufeId: string,
  eingabe: Stufeneingabe,
): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)
    await entwurfPruefen(c, definitionId)
    const e = await stufeneingabePruefen(c, eingabe)
    const { rowCount } = await c.query(
      `update prozessstufe
          set stufentyp = $3, bezeichnung = $4, pflicht = $5, betrag_von = $6, betrag_bis = $7,
              zustaendigkeit_typ = $8, zustaendigkeit_ref = $9, sla_stunden = $10
        where id = $1 and definition_id = $2`,
      [
        stufeId,
        definitionId,
        e.stufentyp,
        e.bezeichnung,
        e.pflicht,
        e.betragVon,
        e.betragBis,
        e.zustaendigkeitTyp,
        e.zustaendigkeitRef,
        e.slaStunden,
      ],
    )
    if (rowCount === 0) throw new NichtMoeglich('Stufe nicht gefunden')
    await stempelSetzen(c, stufeId, e.stempeltypIds)
  })
}

/** Entfernt eine Stufe samt Blatt im Baum und Stempelzuordnung (Kaskade). */
export async function stufeEntfernen(benutzerId: string, definitionId: string, stufeId: string): Promise<void> {
  return alsBenutzer(benutzerId, async (c) => {
    await rechtPruefen(c)
    await entwurfPruefen(c, definitionId)
    const { rowCount } = await c.query('delete from prozessstufe where id = $1 and definition_id = $2', [
      stufeId,
      definitionId,
    ])
    if (rowCount === 0) throw new NichtMoeglich('Stufe nicht gefunden')
  })
}

/** Die Stempel je Stufe einer Fassung -- fuer die Anzeige und das Formular. */
export async function stempelJeStufe(
  benutzerId: string,
  definitionId: string,
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ stufe_id: string; id: string; name: string }>(
      `select pst.stufe_id, t.id, t.name
         from prozessstufe_stempeltyp pst
         join prozessstufe s on s.id = pst.stufe_id
         join stempeltyp t on t.id = pst.stempeltyp_id
        where s.definition_id = $1
        order by pst.stufe_id, pst.sortierung`,
      [definitionId],
    )
    const karte = new Map<string, Array<{ id: string; name: string }>>()
    for (const z of rows) {
      const liste = karte.get(z.stufe_id) ?? []
      liste.push({ id: z.id, name: z.name })
      karte.set(z.stufe_id, liste)
    }
    return karte
  })
}

/** Die Namen hinter den Zustaendigkeitsverweisen -- damit die Zeile „Rolle Buchhaltung“ sagt, nicht eine Kennung. */
export async function zustaendigkeitsnamen(benutzerId: string): Promise<Map<string, string>> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string; name: string }>(
      'select id, name from rolle union all select id, name from gruppe union all select id, name from spezialgebiet',
    )
    return new Map(rows.map((z) => [z.id, z.name]))
  })
}
