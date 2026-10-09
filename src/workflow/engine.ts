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
import { systemaktionAusfuehren } from './systemaktion'

/** Wo der Abdruck hin soll, in PDF-Punkten -- vom Menschen gewaehlt (ADR 0009). */
export interface Stempelplatz {
  seite: number
  x: number
  y: number
  breite: number
  hoehe: number
}

export interface Stempelvorgang {
  laufId: string
  stufeId: string
  benutzerId: string
  stempeltypId?: string | null
  entscheidung: 'freigabe' | 'ablehnung' | 'rueckgabe' | 'klaerung'
  kommentar?: string | null
  /** Ohne Lage waehlt die Datenbank den Platz (dms.stempelplatz). */
  lage?: Stempelplatz | null
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
            d.hat_umlagefaehige_zeile, d.wichtig,
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
    wichtig: z['wichtig'],
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
            lateral dms.vertretung_fuer($2, d.objekt_id, d.ordnungsgruppe_id, $3) v
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

async function objektverantwortlicher(c: PoolClient, dokumentId: string): Promise<Traeger> {
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

async function spezialgebietTraeger(c: PoolClient, dokumentId: string): Promise<Traeger> {
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

async function zustaendigkeitAufloesen(
  c: PoolClient,
  blatt: Knoten,
  dokumentId: string,
): Promise<Traeger> {
  const stufe = blatt.stufe
  if (stufe === null) return LEER

  if (stufe.zustaendigkeitTyp === 'objektverantwortlich') {
    return objektverantwortlicher(c, dokumentId)
  }

  if (stufe.zustaendigkeitTyp === 'gruppe') {
    return { ...LEER, gruppeId: stufe.zustaendigkeitRef }
  }

  if (stufe.zustaendigkeitTyp === 'spezialgebiet') {
    return spezialgebietTraeger(c, dokumentId)
  }

  /*
   * Der ermittelte Empfaenger (Migration 20261006170000): Person im
   * Schreiben oder Absenderregel, vom Worker an den Beleg geschrieben
   * (src/schriftverkehr/verteilung.ts) -- sonst Spezialgebiet, sonst
   * Objektverantwortliche. Die Rangfolge ist die Entscheidung des Hauses;
   * der Grund steht am Beleg (empfaenger_begruendung).
   */
  if (stufe.zustaendigkeitTyp === 'ermittelt') {
    const { rows } = await c.query<{ b: string | null; g: string | null }>(
      'select empfaenger_benutzer_id as b, empfaenger_gruppe_id as g from dokument where id = $1',
      [dokumentId],
    )
    if (rows[0]?.b) return { ...LEER, benutzerId: rows[0].b }
    if (rows[0]?.g) return { ...LEER, gruppeId: rows[0].g }
    const spezial = await spezialgebietTraeger(c, dokumentId)
    if (spezial.benutzerId !== null || spezial.gruppeId !== null) return spezial
    return objektverantwortlicher(c, dokumentId)
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
  wurzel: Knoten,
  blaetter: Knoten[],
  kontext: Kontext,
): Promise<string[]> {
  const angelegt: string[] = []

  // Faelligkeit aus dem Zahlungsziel (Migration 20261009100000): nur holen,
  // wenn eine Stufe sie braucht; ist es noch unbekannt, gilt die Frist, und
  // der Trigger rechnung_fakten_zahlungsziel_faelligkeit zieht nach.
  let zahlungsziel: string | null | undefined
  const zahlungszielLaden = async (): Promise<string | null> => {
    if (zahlungsziel === undefined) {
      const { rows } = await c.query<{ z: string | null }>(
        "select to_char(zahlungsziel, 'YYYY-MM-DD') as z from rechnung_fakten where dokument_id = $1",
        [dokumentId],
      )
      zahlungsziel = rows[0]?.z ?? null
    }
    return zahlungsziel
  }

  for (const blatt of blaetter) {
    const stufe = blatt.stufe
    if (stufe === null) continue

    const gilt = stufeGiltFuer(stufe, kontext)
    const faelligAus = gilt && stufe.faelligAus === 'zahlungsziel' ? await zahlungszielLaden() : null

    /*
     * Eine Systemaktion stempelt niemand: Die Aufgabe entsteht gleich als
     * erledigt (damit der Lauf sie als begonnen und durch zaehlt), die Engine
     * fuehrt die Aktion aus -- Ausgang im Ausgangsbuch oder Eintrag im
     * Fehlerkorb -- und rueckt sofort weiter. Kein Ereignis in der
     * Stempelkette: Die Kette haelt Entscheidungen von Menschen fest, und
     * der Nachweis der Aktion ist der Ausgang selbst.
     */
    if (gilt && stufe.stufentyp === 'systemaktion') {
      await c.query(
        `insert into aufgabe (lauf_id, stufe_id, status, erledigt_am)
         values ($1, $2, 'erledigt', now())`,
        [laufId, stufe.id],
      )
      await systemaktionAusfuehren(c, dokumentId, stufe)
      const folge = await vorruecken(c, laufId, dokumentId, wurzel, blatt, kontext)
      angelegt.push(...folge.neueAufgaben)
      continue
    }

    const zustaendig = gilt ? await zustaendigkeitAufloesen(c, blatt, dokumentId) : LEER
    const traeger = gilt
      ? await vertretungAnwenden(c, zustaendig, dokumentId, stufe.stufentyp)
      : zustaendig

    const { rows } = await c.query<{ id: string }>(
      `insert into aufgabe (lauf_id, stufe_id, zugewiesen_benutzer, zugewiesen_gruppe,
                            zugewiesen_rolle, wegen_delegation, faellig_am, status,
                            erledigt_am)
       values ($1, $2, $3, $4, $5, $6,
               coalesce($9::date::timestamptz,
                        case when $7::integer is null then null
                             else now() + ($7::integer * interval '1 hour') end),
               $8, case when $8 = 'entfallen' then now() else null end)
       returning id`,
      [laufId, stufe.id, traeger.benutzerId, traeger.gruppeId, traeger.rolleId,
       traeger.delegationId ?? null,
       gilt ? stufe.slaStunden : null, gilt ? 'offen' : 'entfallen', faelligAus],
    )
    const id = rows[0]?.id
    if (id !== undefined) angelegt.push(id)
  }

  return angelegt
}

/**
 * Rueckt den Lauf hinter einer erledigten Stufe vor: naechste Blaetter
 * oeffnen, oder -- wenn nichts mehr kommt und alles Begonnene durch ist --
 * den Lauf schliessen und archivieren. Aus `stempeln` herausgeloest, weil
 * eine Systemaktion denselben Schritt geht, nur ohne Stempel.
 */
async function vorruecken(
  c: PoolClient,
  laufId: string,
  dokumentId: string,
  wurzel: Knoten,
  blatt: Knoten,
  kontext: Kontext,
): Promise<Stempelergebnis> {
  const stand = await standLaden(c, laufId)
  const weiter = naechsteBlaetter(blatt, kontext, abschlussPruefer(stand.erledigt, stand.begonnen))

  if (weiter.length === 0) {
    const alleFertig = alleBlaetter(wurzel)
      .filter((b) => b.stufe !== null && stand.begonnen.has(b.stufe.id))
      .every((b) => b.stufe !== null && stand.erledigt.has(b.stufe.id))

    if (alleFertig) {
      await c.query(
        `update dokument_lauf set status = 'abgeschlossen', beendet_am = now(),
                                  aktuelle_stufe_id = null
          where id = $1`,
        [laufId],
      )
      // Der Lauf ist durch, also ist der Beleg fertig: archivieren
      // (Konzept 19). Hier und nicht in einem Nachtlauf -- ein Beleg, der
      // zwischen "letzter Freigabe" und "Archivierung" liegt, ist noch
      // aenderbar, und niemand weiss, wie lange dieses Fenster ist.
      await c.query('select dms.dokument_archivieren($1)', [dokumentId])
      return { laufAbgeschlossen: true, neueAufgaben: [] }
    }
    // Ein paralleler Block wartet noch auf seinen anderen Zweig.
    return { laufAbgeschlossen: false, neueAufgaben: [] }
  }

  const neueAufgaben = await aufgabenAnlegen(c, laufId, dokumentId, wurzel, weiter, kontext)

  // Eine Systemaktion unter den naechsten Blaettern kann den Lauf schon
  // geschlossen haben (sie rueckt selbst vor, bis zum Ende). Dann gibt es
  // keine aktuelle Stufe mehr, und der Aufrufer soll es erfahren.
  const { rows: laufstand } = await c.query<{ status: string }>(
    'select status from dokument_lauf where id = $1',
    [laufId],
  )
  if (laufstand[0]?.status === 'abgeschlossen') return { laufAbgeschlossen: true, neueAufgaben }

  await c.query(`update dokument_lauf set aktuelle_stufe_id = $2 where id = $1`, [
    laufId,
    weiter[0]?.stufe?.id ?? null,
  ])
  return { laufAbgeschlossen: false, neueAufgaben }
}

/**
 * Offene Aufgaben ohne Traeger noch einmal aufloesen -- nachdem jemand das
 * Objekt nachgetragen hat (`belege/nachtragen.ts`).
 *
 * Dieselbe Aufloesung wie beim Anlegen, mit Vertretung. Nur Aufgaben, die
 * niemanden haben: Eine Aufgabe, die schon bei jemandem liegt, wandert
 * nicht, weil ein Objekt dazukam -- das waere ein stiller Wechsel des
 * Bearbeiters. Gibt die Zahl der neu zugewiesenen zurueck.
 */
export async function aufgabenNeuZuweisen(c: PoolClient, dokumentId: string): Promise<number> {
  const { rows } = await c.query<{ id: string; stufe_id: string; definition_id: string }>(
    `select a.id, a.stufe_id, l.definition_id
       from aufgabe a join dokument_lauf l on l.id = a.lauf_id
      where l.dokument_id = $1 and a.status in ('offen','in_arbeit')
        and a.zugewiesen_benutzer is null and a.zugewiesen_gruppe is null and a.zugewiesen_rolle is null`,
    [dokumentId],
  )
  let zugewiesen = 0
  for (const a of rows) {
    const wurzel = await baumLaden(c, a.definition_id)
    if (wurzel === null) continue
    const blatt = alleBlaetter(wurzel).find((b) => b.stufe?.id === a.stufe_id)
    if (blatt === undefined || blatt.stufe === null) continue
    const zustaendig = await zustaendigkeitAufloesen(c, blatt, dokumentId)
    const traeger = await vertretungAnwenden(c, zustaendig, dokumentId, blatt.stufe.stufentyp)
    if (traeger.benutzerId === null && traeger.gruppeId === null && traeger.rolleId === null) continue
    await c.query(
      `update aufgabe set zugewiesen_benutzer = $2, zugewiesen_gruppe = $3, zugewiesen_rolle = $4,
                          wegen_delegation = $5
        where id = $1`,
      [a.id, traeger.benutzerId, traeger.gruppeId, traeger.rolleId, traeger.delegationId ?? null],
    )
    zugewiesen += 1
  }
  return zugewiesen
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
/**
 * Welcher Ablauf gilt fuer einen Beleg -- **die eine Stelle** dafuer
 * (Migration 20261009100000). Laufstart, Belegartwechsel und Ablagewechsel
 * fragen hier; drei Stellen, die denselben Ablauf waehlen, waeren drei
 * Stellen, die ihn verschieden waehlen.
 *
 * Rangfolge, Entscheidung des Hauses:
 *   1. ein Ablauf der **Ablage** fuer diese Belegart (Ablage vor Kategorie),
 *      darin eine Kategorie, die ihn benennt oder ihm zugeordnet ist;
 *   2. sonst der Hausstandard der Belegart -- wieder mit Kategorie davor.
 * Ein Ablauf einer **fremden** Ablage kommt nie in Frage, auch wenn eine
 * Kategorie ihn benennt. `vorgabe` erlaubt, fuer eine andere Belegart oder
 * Ablage zu fragen, bevor der Beleg umgestellt wird.
 *
 * Die Kategorie benennt ihren Ablauf (`ordnungsgruppe.prozessdefinition_id`)
 * -- die einfachste denkbare Steuerung, ein Auswahlfeld statt
 * ueberlappender Filter (docs/analyse-amagno-bestand.md). Bedingungen
 * bleiben als Verzweigung **innerhalb** eines Ablaufs.
 */
export async function ablaufWaehlen(
  c: PoolClient,
  dokumentId: string,
  vorgabe: { belegart?: string | null; ablageId?: string | null } = {},
): Promise<{ id: string; version: number } | null> {
  const { rows } = await c.query<{ id: string; version: number }>(
    `select p.id, p.version
       from dokument d
       left join ordnungsgruppe og
              on og.id = d.ordnungsgruppe_id
             and og.mandant_id = d.mandant_id
       join prozessdefinition p
         on p.mandant_id = d.mandant_id
        and p.belegart = coalesce($2, d.belegart)
        and p.status = 'aktiv'
        and (p.ablage_id = coalesce($3, d.ablage_id) or p.ablage_id is null)
        and (p.id = og.prozessdefinition_id
             or p.ordnungsgruppe_id = d.ordnungsgruppe_id
             or p.ordnungsgruppe_id is null)
      where d.id = $1
      order by (p.ablage_id is not null) desc,
               coalesce(p.id = og.prozessdefinition_id, false) desc,
               p.ordnungsgruppe_id nulls last, p.version desc
      limit 1`,
    [dokumentId, vorgabe.belegart ?? null, vorgabe.ablageId ?? null],
  )
  return rows[0] ?? null
}

export async function laufStarten(
  c: PoolClient,
  dokumentId: string,
): Promise<{ laufId: string; aufgaben: string[] } | null> {
  /*
   * Welcher Ablauf gilt -- und warum.
   *
   * **Die Kategorie benennt ihren Ablauf.** `ordnungsgruppe.prozessdefinition_id`
   * steht seit dem Kernschema und wurde nie gelesen. Sie ist die einfachste
   * denkbare Steuerung: ein Auswahlfeld je Kategorie, keine Bedingung, kein
   * Filter. Genau das war die Kritik am abzuloesenden System -- dort ergibt
   * sich der Ablauf aus ueberlappenden Filtern, die niemand als Ganzes lesen
   * kann (docs/analyse-amagno-bestand.md, Abschnitt 1).
   *
   * Bedingungen bleiben da, wo sie hingehoeren: als Verzweigung **innerhalb**
   * eines Ablaufs ("ab 5.000 EUR zusaetzlich die Geschaeftsleitung"). Dort
   * stehen sie an einer Stelle und werden mitsimuliert.
   *
   * Die bisherige Auswahl ueber Belegart und Kategorie bleibt als Rueckfall
   * gueltig -- ein Haus, das `prozessdefinition_id` nicht pflegt, laeuft
   * unveraendert weiter.
   *
   * Die Belegart muss in **beiden** Wegen passen: Eine Kategorie, die auf
   * einen Schriftverkehrsablauf zeigt, waere ein Konfigurationsfehler, und
   * ein Beleg im falschen Ablauf faellt erst drei Stufen spaeter auf.
   */
  const definition = await ablaufWaehlen(c, dokumentId)
  if (definition === null) return null

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

  const aufgaben = await aufgabenAnlegen(c, laufId, dokumentId, wurzel, blaetter, kontext)
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
                                   entscheidung, kommentar, wegen_delegation, lage)
     values ($1, $2, $3, $4, $5, $6,
             (select a.wegen_delegation from aufgabe a
               where a.lauf_id = $1 and a.stufe_id = $2
               order by a.erstellt_am desc limit 1),
             $7::jsonb)`,
    [
      vorgang.laufId,
      vorgang.stufeId,
      vorgang.benutzerId,
      vorgang.stempeltypId ?? null,
      vorgang.entscheidung,
      vorgang.kommentar ?? null,
      vorgang.lage == null ? null : JSON.stringify(vorgang.lage),
    ],
  )

  if (vorgang.entscheidung === 'ablehnung') {
    await c.query(
      `update klaerung set erledigt_am = now(), ergebnis = 'abgelehnt'
        where dokument_id = $1 and erledigt_am is null`,
      [lauf.dokument_id],
    )
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
    await c.query('select dms.dokument_archivieren($1)', [lauf.dokument_id])
    return { laufAbgeschlossen: true, neueAufgaben: [] }
  }

  if (vorgang.entscheidung === 'klaerung') {
    await c.query(`update dokument_lauf set status = 'klaerung' where id = $1`, [vorgang.laufId])
    // Die Stufe wird gemerkt, die Aufgabe bleibt offen: bestehende Stempel
    // behalten ihre Gültigkeit (Konzept 8.5).
    return { laufAbgeschlossen: false, neueAufgaben: [] }
  }

  /*
   * Der Weg aus der Klaerung: der naechste Stempel an der gemerkten Stufe.
   *
   * Bis Migration 20260927100000 gab es ihn nicht -- der Lauf blieb fuer
   * immer auf "klaerung", der Eintrag im Klaerungspostfach fuer immer offen,
   * auch wenn der Beleg laengst weitergestempelt war. Jetzt schliesst jede
   * Entscheidung, die keine Klaerung ist, die offenen Klaerungen des Belegs
   * mit dem Kommentar des Stempels als Ergebnis und stellt den Lauf zurueck
   * auf laufend. Nicht als eigene Handlung "Klaerung beenden": Die Klaerung
   * ist zu Ende, wenn entschieden wurde -- eine zweite Schaltflaeche waere
   * ein zweiter Zustand, den jemand vergessen kann.
   */
  await c.query(
    `update klaerung set erledigt_am = now(), ergebnis = coalesce($2, 'weiter bearbeitet')
      where dokument_id = $1 and erledigt_am is null`,
    [lauf.dokument_id, vorgang.kommentar ?? null],
  )
  await c.query(
    `update dokument_lauf set status = 'laufend' where id = $1 and status = 'klaerung'`,
    [vorgang.laufId],
  )

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

  return vorruecken(c, vorgang.laufId, lauf.dokument_id, wurzel, blatt, kontext)
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

export type Belegartwechsel = 'gewechselt' | 'unveraendert' | 'entschieden' | 'kein_ablauf'

/**
 * Die Belegart eines Belegs umstellen -- und den Lauf mit ihr.
 *
 * Der Lauf startet beim Eingang, bevor der Worker den Text gelesen hat
 * (damit ein Beleg auch dann sichtbar ist, wenn der Worker faellt). Stellt
 * sich danach heraus, dass die Rechnung eine Mahnung ist, gehoert sie in den
 * Mahnungsablauf -- aber nur, solange niemand entschieden hat: Ein Stempel
 * ist eine Entscheidung ueber genau diesen Beleg in genau diesem Ablauf,
 * und die wird nicht dadurch entwertet, dass ein Wort im Text steht.
 *
 * Gibt es fuer die neue Belegart keinen aktiven Ablauf, bleibt alles, und
 * der Beleg traegt den Hinweis: Ein Beleg ohne Lauf staende in keinem
 * Postfach -- das waere schlimmer als der falsche Ablauf.
 *
 * Der alte Lauf wird storniert, seine Aufgaben entfallen; nichts wird
 * geloescht. Eine Quelle `mensch` ist fest: Die Erkennung stellt nichts
 * mehr um, was jemand gewaehlt hat.
 */
export async function belegartWechseln(
  c: PoolClient,
  dokumentId: string,
  neu: string,
  quelle: 'erkannt' | 'mensch',
  begruendung: string,
): Promise<Belegartwechsel> {
  const { rows } = await c.query<{
    belegart: string
    belegart_quelle: string
    mandant_id: string
    ablage_id: string
    ablage_quelle: string
    ablage_name: string
    ablage_belegarten: string[]
  }>(
    `select d.belegart, d.belegart_quelle, d.mandant_id, d.ablage_id, d.ablage_quelle,
            a.name as ablage_name, a.belegarten as ablage_belegarten
       from dokument d join ablage a on a.id = d.ablage_id
      where d.id = $1`,
    [dokumentId],
  )
  const d = rows[0]
  if (d === undefined) return 'unveraendert'
  if (quelle === 'erkannt' && d.belegart_quelle === 'mensch') return 'unveraendert'

  /*
   * Die Ablage begrenzt die Belegart (Migration 20261009100000): Hat ein
   * Mensch den Beleg in "Kundenrechnungen" gelegt, macht die Erkennung aus
   * ihm keine Lieferantenrechnung -- sie saehe eine Rechnungsnummer und
   * stellte um, und der Beleg liefe im falschen Ablauf in der richtigen
   * Ablage. Ein Mensch darf die Belegart trotzdem aendern; dann folgt die
   * Ablage, wenn sie aus dem Eingang stammt.
   */
  if (quelle === 'erkannt' && d.ablage_quelle === 'mensch' && !d.ablage_belegarten.includes(neu)) {
    await c.query('update dokument set belegart_begruendung = $2 where id = $1', [
      dokumentId,
      `${begruendung} — nicht umgestellt, die Ablage „${d.ablage_name}“ kennt diese Belegart nicht`,
    ])
    return 'unveraendert'
  }

  if (d.belegart === neu) {
    await c.query('update dokument set belegart_quelle = $2, belegart_begruendung = $3 where id = $1', [
      dokumentId,
      quelle,
      begruendung,
    ])
    return 'unveraendert'
  }

  const { rows: entschieden } = await c.query<{ n: number }>(
    `select count(*)::int n from stempel_ereignis e
       join dokument_lauf l on l.id = e.lauf_id
      where l.dokument_id = $1`,
    [dokumentId],
  )
  if ((entschieden[0]?.n ?? 0) > 0) {
    await c.query('update dokument set belegart_begruendung = $2 where id = $1', [
      dokumentId,
      `${begruendung} — nicht umgestellt, der Beleg trägt schon Entscheidungen`,
    ])
    return 'entschieden'
  }

  // Wohin der Beleg kommt: Die Ablage folgt der Belegart, solange sie aus
  // dem Eingang stammt (Migration 20261006150000); eine gewaehlte bleibt.
  const { rows: ziel } = await c.query<{ ablage_id: string | null }>(
    `select case when $3 = 'eingang' then dms.ablage_fuer($1, $2) else null end as ablage_id`,
    [d.mandant_id, neu, d.ablage_quelle],
  )
  const zielAblage = ziel[0]?.ablage_id ?? d.ablage_id

  // Der Ablauf der Zielablage fuer die neue Belegart -- dieselbe Wahl wie
  // beim Laufstart (ablaufWaehlen). Ein Ablauf ohne Stufenbaum ist keiner:
  // Gefunden am Schriftverkehr, dessen Stufen ohne Knoten dastanden.
  const ablauf = await ablaufWaehlen(c, dokumentId, { belegart: neu, ablageId: zielAblage })
  const wurzel = ablauf === null ? null : await baumLaden(c, ablauf.id)
  if (ablauf === null || wurzel === null) {
    await c.query('update dokument set belegart_begruendung = $2 where id = $1', [
      dokumentId,
      `${begruendung} — nicht umgestellt, für diese Belegart gibt es keinen aktiven Ablauf`,
    ])
    return 'kein_ablauf'
  }

  await c.query(
    `update dokument
        set belegart = $2, belegart_quelle = $3, belegart_begruendung = $4, ablage_id = $5
      where id = $1`,
    [dokumentId, neu, quelle, begruendung, zielAblage],
  )

  /*
   * Der Lauf wechselt seine Definition -- ein Beleg hat genau einen Lauf
   * (eindeutiger Index), und ohne Ereignis darin gibt es nichts, was ein
   * zweiter Lauf festhalten muesste. Die alten Aufgaben entfallen, die
   * neuen entstehen wie beim Start. Ein Bestandsbeleg (Uebernahme) hat
   * keinen Lauf und bekommt durch die Belegart auch keinen.
   */
  await laufNeuAufsetzen(c, dokumentId, ablauf.id)
  return 'gewechselt'
}

/**
 * Setzt die offenen Aufgaben eines Laufs neu auf -- mit dem Stand, den der
 * Beleg **jetzt** hat: Verzweigungen werden neu entschieden, Zustaendigkeiten
 * neu aufgeloest. Gebraucht, wenn sich nach dem Start etwas aendert, das
 * den Weg bestimmt: die Belegart (belegartWechseln) oder die Verteilung
 * eines Schriftstuecks (wichtig, Empfaenger -- Migration 20261006170000).
 *
 * Nur, solange keine Entscheidung im Lauf liegt: Ein Stempel ist ein
 * Ereignis in der Kette, und eine Stufe, die jemand schon entschieden hat,
 * laesst sich nicht nachtraeglich fuer entfallen erklaeren. Die alten
 * Aufgaben werden `entfallen`, nichts geloescht; der Lauf bleibt derselbe.
 */
export async function laufNeuAufsetzen(
  c: PoolClient,
  dokumentId: string,
  definitionId?: string,
): Promise<'neu' | 'entschieden' | 'kein_lauf'> {
  const { rows: laeufe } = await c.query<{ id: string; definition_id: string }>(
    `select id, definition_id from dokument_lauf where dokument_id = $1 and status in ('laufend','klaerung')`,
    [dokumentId],
  )
  const lauf = laeufe[0]
  if (lauf === undefined) return 'kein_lauf'

  const { rows: entschieden } = await c.query<{ n: number }>(
    'select count(*)::int as n from stempel_ereignis where lauf_id = $1',
    [lauf.id],
  )
  if ((entschieden[0]?.n ?? 0) > 0) return 'entschieden'

  const defId = definitionId ?? lauf.definition_id
  const wurzel = await baumLaden(c, defId)
  if (wurzel === null) return 'kein_lauf'

  const kontext = await kontextLaden(c, dokumentId)
  const blaetter = einstiegsblaetter(wurzel, kontext)
  const { rows: fassung } = await c.query<{ version: number }>(
    'select version from prozessdefinition where id = $1',
    [defId],
  )

  await c.query(
    `update aufgabe set status = 'entfallen', erledigt_am = now()
      where lauf_id = $1 and status in ('offen','in_arbeit')`,
    [lauf.id],
  )
  await c.query(
    `update dokument_lauf
        set definition_id = $2, definition_version = $3, aktuelle_stufe_id = $4,
            status = 'laufend', beendet_am = null, freigabe_hash = null, kontierungs_hash = null
      where id = $1`,
    [lauf.id, defId, fassung[0]?.version ?? 1, blaetter[0]?.stufe?.id ?? null],
  )
  await aufgabenAnlegen(c, lauf.id, dokumentId, wurzel, blaetter, kontext)
  return 'neu'
}
