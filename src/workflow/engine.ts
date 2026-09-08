/**
 * Workflow-Engine.
 *
 * Sie erzeugt Aufgaben, nimmt Stempel entgegen und bestimmt daraus, wohin ein
 * Beleg als Nächstes geht. Der Stempel trägt nur die Entscheidung — das Ziel
 * leitet die Engine aus dem Blockbaum ab (Konzept 8.7, ADR 0002).
 *
 * Zwei Regeln, die hier nicht verhandelbar sind:
 *
 *   * Nie einen Status setzen, ohne das zugehörige Ereignis zu schreiben.
 *     `dokument_lauf` ist Cache, `stempel_ereignis` ist die Wahrheit.
 *   * Vor der Zahlung muss jede Pflichtstufe einen gültigen Stempel haben.
 */

import type { PoolClient } from 'pg'
import type { Kontext } from './bedingung'
import {
  alleBlaetter,
  baumLaden,
  einstiegsblaetter,
  naechsteBlaetter,
  stufeGiltFuer,
  type Knoten,
} from './baum'

export interface Stempelvorgang {
  laufId: string
  stufeId: string
  benutzerId: string
  stempeltypId?: string | null
  entscheidung: 'freigabe' | 'ablehnung' | 'rueckgabe' | 'klaerung'
  kommentar?: string | null
}

export interface Stempelergebnis {
  laufAbgeschlossen: boolean
  neueAufgaben: string[]
}

/**
 * Die Werte, gegen die Bedingungen und Betragsgrenzen geprüft werden.
 * Feldnamen entsprechen der Weißliste in bedingung.ts.
 */
export async function kontextLaden(c: PoolClient, dokumentId: string): Promise<Kontext> {
  const { rows } = await c.query<Record<string, string | number | boolean | null>>(
    `select d.belegart,
            d.hat_umlagefaehige_zeile,
            f.brutto, f.netto, f.wirtschaftsjahr,
            og.kurzcode        as ordnungsgruppe_kurzcode,
            sg.name            as spezialgebiet_name,
            o.objektnummer     as objekt_objektnummer,
            o.verwaltungsart   as objekt_verwaltungsart,
            kr.name            as kreditor_name,
            coalesce(f.zahlungsart, v.zahlungsart) as zahlungsart
       from dokument d
       left join rechnung_fakten f on f.dokument_id = d.id
       left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
       left join spezialgebiet sg on sg.id = d.spezialgebiet_id
       left join objekt o on o.id = d.objekt_id
       left join kreditor kr on kr.id = f.kreditor_id
       left join vertrag v on v.kreditor_id = f.kreditor_id
                          and v.objekt_id = d.objekt_id and v.aktiv
      where d.id = $1`,
    [dokumentId],
  )

  const z = rows[0]
  if (z === undefined) return {}

  const zahl = (wert: unknown): number | null =>
    wert === null || wert === undefined ? null : Number(wert)

  return {
    belegart: z['belegart'],
    hat_umlagefaehige_zeile: z['hat_umlagefaehige_zeile'],
    brutto: zahl(z['brutto']),
    netto: zahl(z['netto']),
    wirtschaftsjahr: zahl(z['wirtschaftsjahr']),
    'ordnungsgruppe.kurzcode': z['ordnungsgruppe_kurzcode'],
    'spezialgebiet.name': z['spezialgebiet_name'],
    'objekt.objektnummer': z['objekt_objektnummer'],
    'objekt.verwaltungsart': z['objekt_verwaltungsart'],
    'kreditor.name': z['kreditor_name'],
    zahlungsart: z['zahlungsart'],
  }
}

/**
 * Wer bekommt die Aufgabe? Die Zuständigkeit steht an der Stufe, aufgelöst
 * wird sie gegen die Stammdaten des Belegs.
 *
 * OFFEN: zustaendigkeit_typ 'extern' und 'system' bleiben vorerst ohne
 * Zuweisung -- die Aufgabe entsteht, hat aber niemanden. Für 'system'
 * fehlen die Systemaktionen.
 *
 * 'rolle' ist erledigt: Die Aufgabe traegt `zugewiesen_rolle`, und das
 * Postfach loest sie ueber `benutzer_rolle_objekt` auf (siehe
 * `src/app/lib/postfach.ts`). Der Hinweis stand hier noch, nachdem die
 * Aufloesung laengst gebaut war -- gefunden beim Durchsehen der offenen
 * Punkte.
 */
interface Traeger {
  benutzerId: string | null
  gruppeId: string | null
  rolleId: string | null
  /** Gesetzt, wenn eine Vertretung die Aufgabe umgelenkt hat. */
  delegationId?: string | null
}

const LEER: Traeger = { benutzerId: null, gruppeId: null, rolleId: null, delegationId: null }

/**
 * Lenkt eine persönlich zugewiesene Aufgabe um, wenn für den Zuständigen eine
 * Vertretung gilt.
 *
 * Wirkt ausschließlich hier — beim Zuweisen. Rechte wandern nicht mit: Wer
 * vertritt, bekommt die Aufgabe, darf aber nur, was seine eigenen Rollen
 * hergeben. Kann er die Stufe nicht abschließen, eskaliert sie regulär.
 */
async function vertretungAnwenden(
  c: PoolClient,
  traeger: Traeger,
  dokumentId: string,
  stufentyp: string,
): Promise<Traeger> {
  if (traeger.benutzerId === null) return traeger

  const { rows } = await c.query<{ delegation_id: string; an_benutzer: string }>(
    `select v.delegation_id, v.an_benutzer
       from dokument d,
            lateral app.vertretung_fuer($2, d.objekt_id, d.ordnungsgruppe_id, $3) v
      where d.id = $1`,
    [dokumentId, traeger.benutzerId, stufentyp],
  )
  const vertretung = rows[0]
  if (vertretung === undefined) return traeger

  return {
    ...traeger,
    benutzerId: vertretung.an_benutzer,
    delegationId: vertretung.delegation_id,
  }
}

async function zustaendigkeitAufloesen(
  c: PoolClient,
  blatt: Knoten,
  dokumentId: string,
): Promise<Traeger> {
  const stufe = blatt.stufe
  if (stufe === null) return LEER

  if (stufe.zustaendigkeitTyp === 'objektverantwortlich') {
    const { rows } = await c.query<{ benutzer_id: string }>(
      `select z.benutzer_id
         from dokument d
         join objekt_zustaendigkeit z on z.objekt_id = d.objekt_id
        where d.id = $1
          and z.art = 'hauptverantwortlich'
          and z.gueltig_von <= current_date
          and (z.gueltig_bis is null or z.gueltig_bis >= current_date)
        order by z.gueltig_von desc
        limit 1`,
      [dokumentId],
    )
    return { ...LEER, benutzerId: rows[0]?.benutzer_id ?? null }
  }

  if (stufe.zustaendigkeitTyp === 'gruppe') {
    return { ...LEER, gruppeId: stufe.zustaendigkeitRef }
  }

  if (stufe.zustaendigkeitTyp === 'spezialgebiet') {
    const { rows } = await c.query<{ benutzer_id: string | null; gruppe_id: string | null }>(
      `select sz.benutzer_id, sz.gruppe_id
         from dokument d
         join spezialgebiet_zustaendigkeit sz on sz.spezialgebiet_id = d.spezialgebiet_id
        where d.id = $1
          and (sz.objekt_id is null or sz.objekt_id = d.objekt_id)
        limit 1`,
      [dokumentId],
    )
    return {
      ...LEER,
      benutzerId: rows[0]?.benutzer_id ?? null,
      gruppeId: rows[0]?.gruppe_id ?? null,
    }
  }

  if (stufe.zustaendigkeitTyp === 'rolle') {
    return { ...LEER, rolleId: stufe.zustaendigkeitRef }
  }

  // OFFEN: 'extern' und 'system' bleiben ohne Traeger. Die Aufgabe
  // entsteht sichtbar, hat aber niemanden -- besser als ein stiller Sprung.
  return LEER
}

/**
 * Legt für die angegebenen Blätter Aufgaben an. Eine Stufe, deren
 * Betragsgrenze nicht greift, wird als `entfallen` vermerkt statt
 * stillschweigend übersprungen -- sonst fehlt später die Erklärung, warum
 * die Freigabe der Geschäftsleitung im Lauf nicht auftaucht.
 */
async function aufgabenAnlegen(
  c: PoolClient,
  laufId: string,
  dokumentId: string,
  blaetter: Knoten[],
  kontext: Kontext,
): Promise<string[]> {
  const angelegt: string[] = []

  for (const blatt of blaetter) {
    const stufe = blatt.stufe
    if (stufe === null) continue

    const gilt = stufeGiltFuer(stufe, kontext)
    const zustaendig = gilt ? await zustaendigkeitAufloesen(c, blatt, dokumentId) : LEER
    const traeger = gilt
      ? await vertretungAnwenden(c, zustaendig, dokumentId, stufe.stufentyp)
      : zustaendig

    const { rows } = await c.query<{ id: string }>(
      `insert into aufgabe (lauf_id, stufe_id, zugewiesen_benutzer, zugewiesen_gruppe,
                            zugewiesen_rolle, wegen_delegation, faellig_am, status,
                            erledigt_am)
       values ($1, $2, $3, $4, $5, $6,
               case when $7::integer is null then null
                    else now() + ($7::integer * interval '1 hour') end,
               $8, case when $8 = 'entfallen' then now() else null end)
       returning id`,
      [laufId, stufe.id, traeger.benutzerId, traeger.gruppeId, traeger.rolleId,
       traeger.delegationId ?? null,
       gilt ? stufe.slaStunden : null, gilt ? 'offen' : 'entfallen'],
    )
    const id = rows[0]?.id
    if (id !== undefined) angelegt.push(id)
  }

  return angelegt
}

/** Ist der Teilbaum durch? Entfallene Stufen zählen als erledigt. */
function abschlussPruefer(
  erledigteStufen: Set<string>,
  begonneneStufen: Set<string>,
): (knoten: Knoten) => boolean {
  return (knoten: Knoten) => {
    const blaetter = alleBlaetter(knoten)
    const begonnen = blaetter.filter((b) => b.stufe !== null && begonneneStufen.has(b.stufe.id))
    // Ein Zweig, der nie begonnen hat -- etwa der nicht gewählte Zweig einer
    // Verzweigung -- blockiert den parallelen Block nicht.
    if (begonnen.length === 0) return true
    return begonnen.every((b) => b.stufe !== null && erledigteStufen.has(b.stufe.id))
  }
}

async function standLaden(
  c: PoolClient,
  laufId: string,
): Promise<{ erledigt: Set<string>; begonnen: Set<string> }> {
  const { rows } = await c.query<{ stufe_id: string; status: string }>(
    'select stufe_id, status from aufgabe where lauf_id = $1',
    [laufId],
  )
  const erledigt = new Set<string>()
  const begonnen = new Set<string>()
  for (const z of rows) {
    begonnen.add(z.stufe_id)
    if (z.status === 'erledigt' || z.status === 'entfallen') erledigt.add(z.stufe_id)
  }
  return { erledigt, begonnen }
}

/**
 * Startet den Lauf: Prozessdefinition suchen, Lauf anlegen, Einstiegsblätter
 * aktivieren. Ohne aktive Definition entsteht kein Lauf -- das Dokument
 * bleibt liegen, statt in einem undefinierten Zustand zu landen.
 */
export async function laufStarten(
  c: PoolClient,
  dokumentId: string,
): Promise<{ laufId: string; aufgaben: string[] } | null> {
  const { rows: def } = await c.query<{ id: string; version: number }>(
    `select p.id, p.version
       from dokument d
       join prozessdefinition p
         on p.mandant_id = d.mandant_id
        and p.belegart = d.belegart
        and p.status = 'aktiv'
        and (p.ordnungsgruppe_id = d.ordnungsgruppe_id or p.ordnungsgruppe_id is null)
      where d.id = $1
      order by p.ordnungsgruppe_id nulls last, p.version desc
      limit 1`,
    [dokumentId],
  )
  const definition = def[0]
  if (definition === undefined) return null

  const wurzel = await baumLaden(c, definition.id)
  if (wurzel === null) return null

  const kontext = await kontextLaden(c, dokumentId)
  const blaetter = einstiegsblaetter(wurzel, kontext)

  const { rows } = await c.query<{ id: string }>(
    `insert into dokument_lauf (dokument_id, definition_id, definition_version,
                                aktuelle_stufe_id)
     values ($1, $2, $3, $4)
     returning id`,
    [dokumentId, definition.id, definition.version, blaetter[0]?.stufe?.id ?? null],
  )
  const laufId = rows[0]?.id
  if (laufId === undefined) return null

  const aufgaben = await aufgabenAnlegen(c, laufId, dokumentId, blaetter, kontext)
  return { laufId, aufgaben }
}

/**
 * Nimmt einen Stempel entgegen und rückt den Lauf vor.
 *
 * Die Reihenfolge ist wesentlich: erst das Ereignis, dann die Aufgabe, dann
 * der nächste Schritt. Bricht etwas ab, fehlt kein Ereignis zu einem bereits
 * veränderten Status.
 */
export async function stempeln(
  c: PoolClient,
  vorgang: Stempelvorgang,
): Promise<Stempelergebnis> {
  const { rows: laufZeilen } = await c.query<{
    dokument_id: string
    definition_id: string
  }>('select dokument_id, definition_id from dokument_lauf where id = $1', [vorgang.laufId])
  const lauf = laufZeilen[0]
  if (lauf === undefined) throw new Error('Lauf nicht gefunden')

  // Die Vertretung wandert von der Aufgabe in das Ereignis: Sonst stünde
  // später ein Name im Protokoll, dessen Zuständigkeit sich aus den
  // Stammdaten nicht erklärt (ADR 0002).
  await c.query(
    `insert into stempel_ereignis (lauf_id, stufe_id, benutzer_id, stempeltyp_id,
                                   entscheidung, kommentar, wegen_delegation)
     values ($1, $2, $3, $4, $5, $6,
             (select a.wegen_delegation from aufgabe a
               where a.lauf_id = $1 and a.stufe_id = $2
               order by a.erstellt_am desc limit 1))`,
    [
      vorgang.laufId,
      vorgang.stufeId,
      vorgang.benutzerId,
      vorgang.stempeltypId ?? null,
      vorgang.entscheidung,
      vorgang.kommentar ?? null,
    ],
  )

  if (vorgang.entscheidung === 'ablehnung') {
    await c.query(
      `update aufgabe set status = 'erledigt', erledigt_am = now()
        where lauf_id = $1 and status in ('offen','in_arbeit')`,
      [vorgang.laufId],
    )
    await c.query(
      `update dokument_lauf set status = 'abgeschlossen', beendet_am = now(),
                                aktuelle_stufe_id = null
        where id = $1`,
      [vorgang.laufId],
    )
    // Der abgelehnte Beleg bleibt bestehen und wird archiviert; die
    // Ersatzrechnung ist ein neues Dokument (Konzept 5). Der Status bleibt
    // dabei `abgelehnt` -- der Archiveintrag sagt, dass archiviert wurde.
    await c.query(`update dokument set status = 'abgelehnt' where id = $1`, [lauf.dokument_id])
    await c.query('select app.dokument_archivieren($1)', [lauf.dokument_id])
    return { laufAbgeschlossen: true, neueAufgaben: [] }
  }

  if (vorgang.entscheidung === 'klaerung') {
    await c.query(`update dokument_lauf set status = 'klaerung' where id = $1`, [vorgang.laufId])
    // Die Stufe wird gemerkt, die Aufgabe bleibt offen: bestehende Stempel
    // behalten ihre Gültigkeit (Konzept 8.5).
    return { laufAbgeschlossen: false, neueAufgaben: [] }
  }

  await c.query(
    `update aufgabe set status = 'erledigt', erledigt_am = now()
      where lauf_id = $1 and stufe_id = $2 and status in ('offen','in_arbeit')`,
    [vorgang.laufId, vorgang.stufeId],
  )

  const wurzel = await baumLaden(c, lauf.definition_id)
  if (wurzel === null) throw new Error('Kein Blockbaum zur Definition')

  const kontext = await kontextLaden(c, lauf.dokument_id)
  const blatt = alleBlaetter(wurzel).find((b) => b.stufe?.id === vorgang.stufeId)
  if (blatt === undefined) throw new Error('Stufe gehoert nicht zu diesem Ablauf')

  const stand = await standLaden(c, vorgang.laufId)
  const weiter = naechsteBlaetter(
    blatt,
    kontext,
    abschlussPruefer(stand.erledigt, stand.begonnen),
  )

  if (weiter.length === 0) {
    const alleFertig = alleBlaetter(wurzel)
      .filter((b) => b.stufe !== null && stand.begonnen.has(b.stufe.id))
      .every((b) => b.stufe !== null && stand.erledigt.has(b.stufe.id))

    if (alleFertig) {
      await c.query(
        `update dokument_lauf set status = 'abgeschlossen', beendet_am = now(),
                                  aktuelle_stufe_id = null
          where id = $1`,
        [vorgang.laufId],
      )
      // Der Lauf ist durch, also ist der Beleg fertig: archivieren
      // (Konzept 19). Hier und nicht in einem Nachtlauf -- ein Beleg, der
      // zwischen "letzter Freigabe" und "Archivierung" liegt, ist noch
      // aenderbar, und niemand weiss, wie lange dieses Fenster ist.
      await c.query('select app.dokument_archivieren($1)', [lauf.dokument_id])
      return { laufAbgeschlossen: true, neueAufgaben: [] }
    }
    // Ein paralleler Block wartet noch auf seinen anderen Zweig.
    return { laufAbgeschlossen: false, neueAufgaben: [] }
  }

  const neueAufgaben = await aufgabenAnlegen(
    c,
    vorgang.laufId,
    lauf.dokument_id,
    weiter,
    kontext,
  )
  await c.query(`update dokument_lauf set aktuelle_stufe_id = $2 where id = $1`, [
    vorgang.laufId,
    weiter[0]?.stufe?.id ?? null,
  ])

  return { laufAbgeschlossen: false, neueAufgaben }
}

/**
 * Harte Sperre vor der Zahlung: jede Pflichtstufe braucht einen gültigen
 * Stempel (Konzept 8.2). Liefert die Bezeichnungen der Stufen, die fehlen —
 * leer heißt zahlbar.
 */
export async function fehlendePflichtstempel(
  c: PoolClient,
  laufId: string,
): Promise<string[]> {
  const { rows } = await c.query<{ bezeichnung: string }>(
    `select s.bezeichnung
       from dokument_lauf l
       join prozessstufe s on s.definition_id = l.definition_id
       left join aufgabe a on a.lauf_id = l.id and a.stufe_id = s.id
      where l.id = $1
        and s.pflicht
        and (a.id is null or a.status not in ('erledigt','entfallen'))
      order by s.reihenfolge`,
    [laufId],
  )
  return rows.map((r) => r.bezeichnung)
}
