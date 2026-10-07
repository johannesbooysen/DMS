/**
 * Interne Belegeinsicht: Akte, Feed, gefilterte Liste, Volltext.
 *
 * Bis hierher war ein Beleg nur über eine offene Aufgabe erreichbar. Sobald
 * der Ablauf durch war, verschwand er aus jeder Sicht — archiviert und
 * unauffindbar. Das ist die Lücke, die diese Datei schließt.
 *
 * **Die drei Fallen aus Konzept 21 stehen hier alle nebeneinander.** Sie
 * fallen beim Entwickeln mit Seed-Daten nicht auf, weil dort alles schnell
 * ist:
 *
 *   1. Die RLS löst die Objektsichtbarkeit über `dms.meine_objekte()` auf.
 *      **Aber `stable` allein genügt nicht** — die Funktion muss als
 *      unkorrelierte Unterabfrage `(select dms.meine_objekte())` stehen, sonst
 *      ruft PostgreSQL sie je Zeile auf. Beim eigenen Messen kostete das
 *      92 Sekunden statt 140 Millisekunden; die Begründung steht in der
 *      Migration `20260831210000_policies_initplan.sql`. Aus demselben Grund
 *      steht `dms.meine_objekte()` unten im **FROM** und nicht im WHERE.
 *   2. Der objektübergreifende Feed braucht **Top-N je Objekt** über LATERAL.
 *      `objekt_id = any(array) order by … limit` materialisiert erst alle
 *      Treffer: 64 ms gegen 13 ms.
 *   3. Der zusammengesetzte Index `(objekt_id, eingang_am desc)` genügt. Ein
 *      zusätzlicher Index auf `eingang_am` allein verschlechterte den Feed
 *      von 13 auf 30 ms — der Planer verlor die Objektselektivität.
 *
 * Wer eine dieser Abfragen „vereinfacht", macht sie unter Last kaputt, ohne
 * dass ein Test rot wird. Die eigenen Messwerte stehen in
 * [docs/messungen.md](../../docs/messungen.md).
 */

import type { PoolClient } from 'pg'
import { betragLesen } from '../extraktion/zahlen'

export interface Belegzeile {
  id: string
  belegart: string
  eingangAm: string
  status: string
  ampel: string | null
  kreditor: string | null
  rechnungsnummer: string | null
  brutto: number | null
  /** Zweite Belegart: Wer geschrieben hat und worum es geht. */
  korrespondent: string | null
  betreff: string | null
  objektId: string | null
  objektnummer: string | null
  /** § 18: farbcodierte Marken, Farbe aus den Stammdaten. */
  ordnungsgruppe: { name: string; farbe: string | null } | null
  spezialgebiet: { name: string; farbe: string | null } | null
  seitenzahl: number | null
  /** Fortlaufende Eingangsnummer, vergeben beim Abschluss des Posteingangs. */
  paginiernummer: string | null
  /** Wo der Beleg liegt (Migration 20261006150000). */
  ablage: { id: string; name: string } | null
  /** Schriftverkehr: wichtig (Migration 20261006170000). */
  wichtig: boolean
  /** Nur bei Volltextsuche gefüllt. */
  fundstelle: { seite: number; auszug: string } | null
}

export interface Belegfilter {
  objektId?: string | null
  ordnungsgruppeId?: string | null
  ablageId?: string | null
  belegart?: string | null
  ampel?: string | null
  status?: string | null
  /** Eingang ab / bis, als YYYY-MM-DD. */
  von?: string | null
  bis?: string | null
  volltext?: string | null
  limit?: number
  versatz?: number
}

/**
 * Die Spaltenliste steht einmal.
 *
 * Nicht aus Bequemlichkeit: Drei Abfragen liefern dieselben Zeilen, und drei
 * Stellen, an denen eine Spalte fehlen kann, sind drei Stellen, an denen die
 * Trefferliste anders aussieht als die Akte.
 */
/*
 * `eingang_am` bleibt ein Zeitstempel und wird **nicht** über `to_char`
 * geformt.
 *
 * Die Regel „Datumsfelder als Text" gilt für `date`-Spalten: Dort macht pg
 * ein Date-Objekt in Serverzeitzone daraus, und der 31.12. wird zum 30.12.
 * Ein `timestamptz` ist dagegen ein Punkt auf der Zeitachse — die Umwandlung
 * ist richtig, und pg liefert ein brauchbares Date.
 *
 * Der erste Versuch formte auch hier mit `to_char(…, 'OF')`. Das ergibt
 * `2026-08-31T13:09:04+00` — gültiges Postgres, aber kein gültiges ISO-8601:
 * `new Date(…)` liefert `Invalid Date`, und die Seite bricht mit einem
 * Serverfehler ab. Beim Bedienen gefunden.
 */
const SPALTEN = `
  d.id, d.belegart, d.eingang_am, d.paginiernummer,
  d.status, d.ampel_gesamt, d.seitenzahl, d.objekt_id,
  d.ablage_id, ab.name as ablage_name, d.wichtig,
  o.objektnummer,
  og.name as og_name, og.farbe as og_farbe,
  sg.name as sg_name, sg.farbe as sg_farbe,
  k.name as kreditor, f.rechnungsnummer, f.brutto,
  sv.korrespondent, sv.betreff
`

const VERBINDUNGEN = `
  left join objekt o on o.id = d.objekt_id
  left join ablage ab on ab.id = d.ablage_id
  left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
  left join spezialgebiet sg on sg.id = d.spezialgebiet_id
  left join rechnung_fakten f on f.dokument_id = d.id
  left join kreditor k on k.id = f.kreditor_id
  left join schriftverkehr_fakten sv on sv.dokument_id = d.id
`

function zeile(z: Record<string, unknown>): Belegzeile {
  const text = (wert: unknown): string | null => (wert == null ? null : String(wert))
  return {
    id: String(z['id']),
    belegart: String(z['belegart']),
    korrespondent: text(z['korrespondent']),
    betreff: text(z['betreff']),
    // Über toISOString, damit die Zeile unabhängig davon ist, wie pg den
    // Zeitstempel gerade darstellt.
    eingangAm:
      z['eingang_am'] instanceof Date
        ? z['eingang_am'].toISOString()
        : String(z['eingang_am']),
    status: String(z['status']),
    ampel: text(z['ampel_gesamt']),
    kreditor: text(z['kreditor']),
    rechnungsnummer: text(z['rechnungsnummer']),
    brutto: z['brutto'] == null ? null : Number(z['brutto']),
    objektId: text(z['objekt_id']),
    objektnummer: text(z['objektnummer']),
    ordnungsgruppe:
      z['og_name'] == null
        ? null
        : { name: String(z['og_name']), farbe: text(z['og_farbe']) },
    spezialgebiet:
      z['sg_name'] == null
        ? null
        : { name: String(z['sg_name']), farbe: text(z['sg_farbe']) },
    seitenzahl: z['seitenzahl'] == null ? null : Number(z['seitenzahl']),
    paginiernummer: text(z['paginiernummer']),
    ablage: z['ablage_id'] == null ? null : { id: String(z['ablage_id']), name: String(z['ablage_name'] ?? '') },
    wichtig: z['wichtig'] === true,
    fundstelle:
      z['treffer_seite'] == null
        ? null
        : { seite: Number(z['treffer_seite']), auszug: String(z['treffer_auszug'] ?? '') },
  }
}

/**
 * Der objektübergreifende Feed: das Neueste über alle eigenen Objekte.
 *
 * **Top-N je Objekt über LATERAL.** Die naheliegende Form
 * `where objekt_id = any(...) order by eingang_am desc limit 50` sammelt
 * erst alle sichtbaren Belege ein und sortiert dann — bei 100.000 sichtbaren
 * Belegen 64 ms gegen 13 ms. Die Zeit wächst hier mit der **Zahl der
 * Objekte** eines Benutzers, nicht mit der Belegzahl.
 *
 * `jeObjekt` muss mindestens so groß sein wie `limit`, sonst kann ein Objekt
 * mit vielen frischen Belegen die anderen nicht verdrängen.
 */
export async function feed(
  c: PoolClient,
  optionen: { limit?: number; jeObjekt?: number } = {},
): Promise<Belegzeile[]> {
  const limit = optionen.limit ?? 50
  const jeObjekt = Math.max(optionen.jeObjekt ?? limit, limit)

  /*
   * Zwei Quellen, und die zweite ist beim Bedienen aufgefallen.
   *
   * Der LATERAL-Teil läuft über die eigenen Objekte — und findet deshalb
   * **keinen Beleg ohne Objekt**. Genau die sind aber frisch eingegangen und
   * warten auf ihre Zuordnung; sie ausgerechnet dann unsichtbar zu machen,
   * wenn sie Aufmerksamkeit brauchen, wäre der falsche Zeitpunkt.
   *
   * Sie kommen deshalb als zweiter Zweig dazu. Er braucht kein Top-N je
   * Objekt: Belege ohne Objekt sind wenige, und ihre Zahl ist eine
   * Warnleuchte — bleiben sie liegen, sieht man es hier.
   */
  const { rows } = await c.query<Record<string, unknown>>(
    `with sichtbar as (
       select d.* from unnest(dms.meine_objekte()) as mein(objekt_id)
         cross join lateral (
           select dd.* from dokument dd
            where dd.objekt_id = mein.objekt_id
            order by dd.eingang_am desc
            limit $2
         ) d
       union all
       select d.* from dokument d where d.objekt_id is null
     )
     select ${SPALTEN}, null::integer as treffer_seite, null::text as treffer_auszug
       from sichtbar d
       ${VERBINDUNGEN}
      order by d.eingang_am desc
      limit $1`,
    [limit, jeObjekt],
  )
  return rows.map(zeile)
}

/**
 * Die Akte eines Objekts.
 *
 * Der Regelfall und mit Abstand die häufigste Abfrage — 0,7 ms bei einer
 * Million Belegen, weil der zusammengesetzte Index genau darauf passt.
 */
export async function objektakte(
  c: PoolClient,
  objektId: string,
  optionen: { limit?: number; versatz?: number } = {},
): Promise<Belegzeile[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select ${SPALTEN}, null::integer as treffer_seite, null::text as treffer_auszug
       from dokument d ${VERBINDUNGEN}
      where d.objekt_id = $1
      order by d.eingang_am desc
      limit $2 offset $3`,
    [objektId, optionen.limit ?? 50, optionen.versatz ?? 0],
  )
  return rows.map(zeile)
}

/**
 * Was ein Suchbegriff bedeutet: ein Betrag, eine Kennung oder Woerter.
 *
 * "3.226,03" ist ein Betrag und trifft Brutto oder Netto exakt. "DE20 5121
 * 0600 …" ist eine Kennung ohne Leerzeichen und trifft die IBAN. Alles
 * andere sind Woerter -- und Woerter trifft die Suche in **beidem**: in den
 * Feldern (Rechnungsnummer, Kreditor, Korrespondent, Betreff, Objektnummer)
 * als Teilstueck und im Seitentext als Volltext.
 */
export function suchbegriffLesen(roh: string): { begriff: string; betrag: number | null; kennung: string | null } {
  const begriff = roh.trim()
  const betrag = /^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+[.,]\d{2}$/.test(begriff) ? betragLesen(begriff) : null
  const kompakt = begriff.replace(/\s+/g, '')
  const kennung = /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{8,30}$/.test(kompakt) ? kompakt.toUpperCase() : null
  return { begriff, betrag, kennung }
}

/**
 * Die Bedingungen einer Suche -- **einmal**, fuer Treffer und Zaehlung.
 *
 * Vorher standen sie zweimal, und die Zaehlung haette bei der naechsten
 * Erweiterung etwas anderes gezaehlt als die Liste zeigt.
 *
 * Die Feldsuche laeuft ueber dms.suchtreffer -- je Feld sein Index
 * (Trigramm auf Nummer und Name, B-Baum auf IBAN und Betrag, GIN auf dem
 * Seitentext), ohne Zeilenrechte auf den Satelliten; die Sichtbarkeit
 * prueft die Policy auf dokument hier aussen.
 */
function bedingungenAus(filter: Belegfilter, p: (wert: unknown) => string): string[] {
  const bedingungen: string[] = []
  if (filter.objektId) bedingungen.push(`d.objekt_id = ${p(filter.objektId)}`)
  if (filter.ordnungsgruppeId) {
    bedingungen.push(`d.ordnungsgruppe_id = ${p(filter.ordnungsgruppeId)}`)
  }
  if (filter.ablageId) bedingungen.push(`d.ablage_id = ${p(filter.ablageId)}`)
  if (filter.belegart) bedingungen.push(`d.belegart = ${p(filter.belegart)}`)
  if (filter.ampel) bedingungen.push(`d.ampel_gesamt = ${p(filter.ampel)}`)
  if (filter.status) bedingungen.push(`d.status = ${p(filter.status)}`)
  if (filter.von) bedingungen.push(`d.eingang_am >= ${p(filter.von)}::date`)
  // `< bis + 1 Tag` statt `<= bis`: Sonst fehlen alle Belege des letzten Tages,
  // weil eingang_am ein Zeitstempel ist und 14:32 Uhr größer als 00:00 Uhr ist.
  if (filter.bis) bedingungen.push(`d.eingang_am < ${p(filter.bis)}::date + 1`)

  const roh = filter.volltext?.trim()
  if (roh) {
    /*
     * Die Treffer holt dms.suchtreffer (Migration 20261001130000): eine
     * security-definer-Funktion, die nur Belegkennungen zurueckgibt. Der
     * erste Entwurf stand hier als `d.id in (select … union …)` ueber die
     * Satellitentabellen -- und lief gegen eine Million Belege in 5 bis 8
     * Sekunden, weil unter der Zeilenrechte-Schranke von rechnung_fakten
     * kein `ilike` in einen Index darf (nicht leakproof). Welche der
     * Kennungen der Fragende sehen darf, entscheidet weiterhin die Policy
     * auf dokument, hier in der aeusseren Abfrage.
     */
    const { begriff, betrag, kennung } = suchbegriffLesen(roh)
    bedingungen.push(`d.id in (select dms.suchtreffer(${p(begriff)}, ${p(betrag)}, ${p(kennung)}))`)
  }
  return bedingungen
}

/**
 * Die Rangfolge der Treffer: exakte Nummer vor Nummernanfang vor Name vor
 * Betrag vor Textfund -- danach das Alter. Wer eine Rechnungsnummer tippt,
 * will genau diese Rechnung oben sehen, nicht die juengste, in deren Text
 * die Ziffernfolge zufaellig vorkommt.
 */
function rangAus(filter: Belegfilter, p: (wert: unknown) => string): string {
  const roh = filter.volltext?.trim()
  if (!roh) return ''
  const { begriff, betrag } = suchbegriffLesen(roh)
  const genau = p(begriff)
  const anfang = p(`${begriff}%`)
  const teil = p(`%${begriff}%`)
  const betragsrang = betrag === null ? '' : `when f.brutto = ${p(betrag)} or f.netto = ${p(betrag)} then 3`
  return `case when lower(f.rechnungsnummer) = lower(${genau}) or d.paginiernummer = ${genau} then 0
               when f.rechnungsnummer ilike ${anfang} then 1
               when k.name ilike ${teil} or sv.korrespondent ilike ${teil} then 2
               ${betragsrang}
               else 5 end,`
}

/**
 * Gefilterte Liste, wahlweise mit Suchbegriff.
 *
 * Ohne Objektfilter läuft sie über alle sichtbaren Belege — das ist die
 * teure Variante (gemessen 27,6 ms bei einer Million). Sie ist trotzdem
 * richtig so: Wer nach „alle roten Ampeln" fragt, will genau das, und Top-N
 * je Objekt gäbe hier ein falsches Ergebnis — die zehn ältesten roten Belege
 * eines Objekts wären unsichtbar, wenn ein anderes Objekt frischere hat.
 *
 * Der Suchbegriff trifft Felder **und** Text (`bedingungenAus`), die
 * Treffer stehen nach Rang (`rangAus`), dann nach Alter.
 */
export async function suchen(c: PoolClient, filter: Belegfilter): Promise<Belegzeile[]> {
  const werte: unknown[] = []
  const p = (wert: unknown): string => `$${werte.push(wert)}`
  const bedingungen = bedingungenAus(filter, p)
  const suchbegriff = filter.volltext?.trim()
  const wo = bedingungen.length === 0 ? '' : `where ${bedingungen.join(' and ')}`
  const rang = rangAus(filter, p)
  const limit = p(filter.limit ?? 50)
  const versatz = p(filter.versatz ?? 0)

  // Die Fundstelle wird nur bei einer Volltextsuche geholt: Sie kostet je
  // Zeile eine weitere Abfrage auf dokument_seite, und ohne Suchbegriff gäbe
  // es nichts hervorzuheben.
  const fundstelle = suchbegriff
    ? `(select s.seite from dokument_seite s
         where s.dokument_id = d.id
           and s.text_tsv @@ websearch_to_tsquery('german', ${p(suchbegriff)})
         order by s.seite limit 1) as treffer_seite,
       (select ts_headline('german', coalesce(s.text, ''),
                           websearch_to_tsquery('german', ${p(suchbegriff)}),
                           'MaxFragments=1,MaxWords=18,MinWords=6')
          from dokument_seite s
         where s.dokument_id = d.id
           and s.text_tsv @@ websearch_to_tsquery('german', ${p(suchbegriff)})
         order by s.seite limit 1) as treffer_auszug`
    : 'null::integer as treffer_seite, null::text as treffer_auszug'

  const { rows } = await c.query<Record<string, unknown>>(
    `select ${SPALTEN}, ${fundstelle}
       from dokument d ${VERBINDUNGEN}
       ${wo}
      order by ${rang} d.eingang_am desc
      limit ${limit} offset ${versatz}`,
    werte,
  )
  return rows.map(zeile)
}

/**
 * Wie viele Treffer hat der Filter?
 *
 * Getrennt von `suchen`, weil eine Zählung über eine große Menge teurer ist
 * als die erste Seite — und weil eine Liste, die auf die Zählung wartet,
 * langsamer ist als eine, die sie nachreicht.
 */
export async function zaehlen(c: PoolClient, filter: Belegfilter): Promise<number> {
  const werte: unknown[] = []
  const p = (wert: unknown): string => `$${werte.push(wert)}`
  const bedingungen = bedingungenAus(filter, p)
  const wo = bedingungen.length === 0 ? '' : `where ${bedingungen.join(' and ')}`
  const { rows } = await c.query<{ n: string }>(
    `select count(*) as n from dokument d ${wo}`,
    werte,
  )
  return Number(rows[0].n)
}

/**
 * Was jemand selbst hereingebracht hat -- zuletzt zuerst.
 *
 * Die Rueckmeldung des Posteingangs: Ein hochgeladener Beleg verschwindet in
 * die Warteschlange, und ohne diese Liste weiss niemand, ob er angekommen
 * ist, noch aufbereitet wird oder schon laeuft. Gefiltert ueber
 * `erfasst_von`, **zusaetzlich** zur RLS -- die bleibt die Grenze; hier
 * wird nur eingeengt, nie erweitert.
 */
export async function eigeneEingaenge(
  c: PoolClient,
  benutzerId: string,
  limit = 10,
): Promise<Belegzeile[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `select ${SPALTEN}, null::integer as treffer_seite, null::text as treffer_auszug
       from dokument d ${VERBINDUNGEN}
      where d.erfasst_von = $1
        and d.eingangskanal in ('upload', 'scan')
      order by d.eingang_am desc
      limit $2`,
    [benutzerId, limit],
  )
  return rows.map(zeile)
}
