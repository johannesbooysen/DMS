/**
 * Bestandsuebernahme aus dem abzuloesenden System (Konzept 24.12).
 *
 * Amagno exportiert Dateien (PDF) und die Eigenschaften als CSV. Welche
 * Spalte was bedeutet, weiss nur, wer den Export gemacht hat -- deshalb
 * steht die Zuordnung in einer JSON-Datei neben dem Export und nicht im
 * Code. Der Code kennt **unsere** Felder; die Datei sagt, woher sie kommen.
 *
 * **Uebernommen wird archiviert.** Ein Beleg von 2019 laeuft nicht noch
 * einmal durch die sachliche Pruefung. Er nimmt denselben Weg wie jeder
 * Eingang -- Hash, Dublettenpruefung, Ablage, Aufbereitung -- und wird am
 * Ende der Transaktion archiviert, mit den Fakten aus dem Export und dem
 * Eingangsdatum von damals. Der Eingangskanal `uebernahme` sagt fuer immer,
 * dass er so hereinkam.
 *
 * **Erst die Probe, dann der Lauf.** `bestandPruefen` sagt je Zeile, was
 * fehlt (Datei, Objekt, Kreditor) und was schon uebernommen ist -- ohne
 * etwas zu schreiben. Ein Export mit 25.000 Zeilen wird nicht auf Verdacht
 * eingelesen.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'
import { alsBenutzer } from '../db'
import { archivieren } from '../archiv'
import { betragLesen } from '../extraktion/zahlen'
import { dokumentAufnehmen } from '../ingest/aufnehmen'
import { aufbereiten } from '../worker/aufbereitung'
import { plausibilitaetPruefen } from '../pruefung/plausibilitaet'

export const BELEGARTEN = ['rechnung', 'gutschrift', 'mahnung', 'schriftverkehr', 'sonstiges'] as const
type Belegart = (typeof BELEGARTEN)[number]

/** Die Zuordnung der Exportspalten zu unseren Feldern -- `uebernahme.json`. */
export interface Zuordnung {
  /** Woher der Bestand stammt; steht am Protokoll. Vorgabe `amagno`. */
  quelle: string
  /** Die CSV-Datei mit den Eigenschaften, relativ zum Exportordner. */
  index: string
  /** Trennzeichen der CSV. Ohne Angabe: Semikolon, wenn die Kopfzeile mehr davon hat als Kommas. */
  trennzeichen?: ';' | ',' | '\t'
  /** Unterordner, in dem die Dateien liegen, relativ zum Exportordner. */
  dateibasis?: string
  datumsformat: 'DD.MM.YYYY' | 'YYYY-MM-DD'
  /** Belegart, wenn der Export keine Spalte dafuer hat. */
  belegart: Belegart
  /** Exportwert -> unsere Belegart, wenn es eine Spalte gibt. */
  belegarten?: Record<string, Belegart>
  spalten: {
    datei: string
    altKennung: string
    belegart?: string
    kreditor?: string
    rechnungsnummer?: string
    rechnungsdatum?: string
    brutto?: string
    netto?: string
    objektnummer?: string
    ordnungsgruppe?: string
    eingangAm?: string
    betreff?: string
  }
}

export class ZuordnungUngueltig extends Error {}

/** Liest und prueft die Zuordnung streng -- ein Tippfehler im Spaltennamen faellt hier auf, nicht in Zeile 4.000. */
export function zuordnungPruefen(roh: unknown, kopf?: string[]): Zuordnung {
  if (typeof roh !== 'object' || roh === null) throw new ZuordnungUngueltig('uebernahme.json ist kein Objekt.')
  const z = roh as Record<string, unknown>
  const text = (name: string, pflicht = false): string | undefined => {
    const w = z[name]
    if (w === undefined || w === null || w === '') {
      if (pflicht) throw new ZuordnungUngueltig(`uebernahme.json: "${name}" fehlt.`)
      return undefined
    }
    if (typeof w !== 'string') throw new ZuordnungUngueltig(`uebernahme.json: "${name}" muss Text sein.`)
    return w
  }
  const index = text('index', true) as string
  const datumsformat = text('datumsformat') ?? 'DD.MM.YYYY'
  if (datumsformat !== 'DD.MM.YYYY' && datumsformat !== 'YYYY-MM-DD') {
    throw new ZuordnungUngueltig('uebernahme.json: "datumsformat" ist DD.MM.YYYY oder YYYY-MM-DD.')
  }
  const belegart = text('belegart') ?? 'rechnung'
  if (!(BELEGARTEN as readonly string[]).includes(belegart)) {
    throw new ZuordnungUngueltig(`uebernahme.json: "belegart" ${belegart} ist unbekannt.`)
  }
  const trennzeichen = text('trennzeichen')
  if (trennzeichen !== undefined && ![';', ',', '\t'].includes(trennzeichen)) {
    throw new ZuordnungUngueltig('uebernahme.json: "trennzeichen" ist ; oder , oder Tabulator.')
  }

  const spaltenRoh = z['spalten']
  if (typeof spaltenRoh !== 'object' || spaltenRoh === null) {
    throw new ZuordnungUngueltig('uebernahme.json: "spalten" fehlt.')
  }
  const spalten: Record<string, string> = {}
  for (const [name, wert] of Object.entries(spaltenRoh as Record<string, unknown>)) {
    if (typeof wert !== 'string' || wert === '') {
      throw new ZuordnungUngueltig(`uebernahme.json: Spalte "${name}" muss ein Spaltenname sein.`)
    }
    spalten[name] = wert
  }
  for (const pflicht of ['datei', 'altKennung']) {
    if (spalten[pflicht] === undefined) throw new ZuordnungUngueltig(`uebernahme.json: spalten.${pflicht} fehlt.`)
  }
  if (kopf !== undefined) {
    for (const [name, spalte] of Object.entries(spalten)) {
      if (!kopf.includes(spalte)) {
        throw new ZuordnungUngueltig(
          `uebernahme.json: spalten.${name} = "${spalte}", aber die CSV hat keine solche Spalte. Vorhanden: ${kopf.join(', ')}`,
        )
      }
    }
  }

  let belegarten: Record<string, Belegart> | undefined
  if (z['belegarten'] !== undefined) {
    belegarten = {}
    for (const [von, zu] of Object.entries(z['belegarten'] as Record<string, unknown>)) {
      if (typeof zu !== 'string' || !(BELEGARTEN as readonly string[]).includes(zu)) {
        throw new ZuordnungUngueltig(`uebernahme.json: belegarten.${von} zeigt auf eine unbekannte Belegart.`)
      }
      belegarten[von] = zu as Belegart
    }
  }

  return {
    quelle: text('quelle') ?? 'amagno',
    index,
    ...(trennzeichen === undefined ? {} : { trennzeichen: trennzeichen as ';' | ',' | '\t' }),
    ...(text('dateibasis') === undefined ? {} : { dateibasis: text('dateibasis') as string }),
    datumsformat,
    belegart: belegart as Belegart,
    ...(belegarten === undefined ? {} : { belegarten }),
    spalten: spalten as Zuordnung['spalten'],
  }
}

/**
 * CSV lesen -- mit Anfuehrungszeichen, Zeilenumbruechen in Feldern, BOM.
 *
 * Kein Paket dafuer: Der Amagno-Export ist regelmaessig gebaut, und ein
 * Parser von zwanzig Zeilen ist leichter zu pruefen als eine Abhaengigkeit
 * mit vierzig Optionen.
 */
export function csvLesen(text: string, trennzeichen?: ';' | ',' | '\t'): Array<Record<string, string>> {
  const roh = text.startsWith('﻿') ? text.slice(1) : text
  const kopfzeile = roh.split(/\r?\n/, 1)[0] ?? ''
  const t =
    trennzeichen ??
    (kopfzeile.split(';').length >= kopfzeile.split(',').length ? ';' : ',')

  const zeilen: string[][] = []
  let zeile: string[] = []
  let feld = ''
  let inAnfuehrung = false
  for (let i = 0; i < roh.length; i += 1) {
    const zeichen = roh[i] as string
    if (inAnfuehrung) {
      if (zeichen === '"') {
        if (roh[i + 1] === '"') {
          feld += '"'
          i += 1
        } else {
          inAnfuehrung = false
        }
      } else {
        feld += zeichen
      }
    } else if (zeichen === '"') {
      inAnfuehrung = true
    } else if (zeichen === t) {
      zeile.push(feld)
      feld = ''
    } else if (zeichen === '\n' || zeichen === '\r') {
      if (zeichen === '\r' && roh[i + 1] === '\n') i += 1
      zeile.push(feld)
      zeilen.push(zeile)
      zeile = []
      feld = ''
    } else {
      feld += zeichen
    }
  }
  if (feld !== '' || zeile.length > 0) {
    zeile.push(feld)
    zeilen.push(zeile)
  }

  const kopf = (zeilen.shift() ?? []).map((k) => k.trim())
  return zeilen
    .filter((z) => z.some((f) => f.trim() !== ''))
    .map((z) => Object.fromEntries(kopf.map((k, i) => [k, (z[i] ?? '').trim()])))
}

export interface Bestandsbeleg {
  zeile: number
  datei: string
  altKennung: string
  belegart: Belegart
  kreditor: string | null
  rechnungsnummer: string | null
  /** ISO, JJJJ-MM-TT */
  rechnungsdatum: string | null
  brutto: number | null
  netto: number | null
  objektnummer: string | null
  ordnungsgruppe: string | null
  /** ISO; sonst das Rechnungsdatum, sonst heute. */
  eingangAm: string | null
  betreff: string | null
}

export function datumLesen(roh: string | undefined, format: Zuordnung['datumsformat']): string | null {
  const s = (roh ?? '').trim()
  if (s === '') return null
  // Ein Zeitanteil ("14.03.2026 09:12") wird abgeschnitten -- gefragt ist der Tag.
  const nurTag = s.split(/[ T]/, 1)[0] ?? s
  const treffer =
    format === 'DD.MM.YYYY'
      ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(nurTag)
      : /^(\d{4})-(\d{2})-(\d{2})$/.exec(nurTag)
  if (treffer === null) return null
  const [jahr, monat, tag] =
    format === 'DD.MM.YYYY' ? [treffer[3], treffer[2], treffer[1]] : [treffer[1], treffer[2], treffer[3]]
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
}

export function zeileLesen(z: Record<string, string>, zuordnung: Zuordnung, nr: number): Bestandsbeleg {
  const s = zuordnung.spalten
  const wert = (spalte: string | undefined): string | null => {
    if (spalte === undefined) return null
    const w = (z[spalte] ?? '').trim()
    return w === '' ? null : w
  }
  const datei = wert(s.datei)
  const altKennung = wert(s.altKennung)
  if (datei === null || altKennung === null) {
    throw new ZuordnungUngueltig(`Zeile ${nr}: Datei oder Kennung fehlt.`)
  }
  let belegart: Belegart = zuordnung.belegart
  const artRoh = wert(s.belegart)
  if (artRoh !== null) {
    const zu = zuordnung.belegarten?.[artRoh]
    if (zu !== undefined) belegart = zu
    else if ((BELEGARTEN as readonly string[]).includes(artRoh.toLowerCase())) {
      belegart = artRoh.toLowerCase() as Belegart
    }
  }
  return {
    zeile: nr,
    datei,
    altKennung,
    belegart,
    kreditor: wert(s.kreditor),
    rechnungsnummer: wert(s.rechnungsnummer),
    rechnungsdatum: datumLesen(wert(s.rechnungsdatum) ?? undefined, zuordnung.datumsformat),
    brutto: betragLesen(wert(s.brutto)),
    netto: betragLesen(wert(s.netto)),
    objektnummer: wert(s.objektnummer),
    ordnungsgruppe: wert(s.ordnungsgruppe),
    eingangAm: datumLesen(wert(s.eingangAm) ?? undefined, zuordnung.datumsformat),
    betreff: wert(s.betreff),
  }
}

export interface Probezeile {
  zeile: number
  altKennung: string
  datei: string
  /** Harte Befunde -- so wird die Zeile nicht uebernommen. */
  fehler: string[]
  /** Weiche -- wird uebernommen, aber mit Luecke. */
  hinweise: string[]
  schonUebernommen: boolean
}

/**
 * Die Probe: Was wuerde passieren, ohne dass es passiert.
 *
 * Objekte und Ordnungsgruppen muessen da sein -- sie sind Stammdaten, und
 * ein Beleg an einem Objekt, das niemand angelegt hat, waere ein Beleg im
 * Nirgendwo. Ein unbekannter Kreditor ist nur ein Hinweis: Er wird beim
 * Uebernehmen angelegt, sofern der Uebernehmende Stammdaten pflegen darf.
 */
export async function bestandPruefen(
  c: PoolClient,
  quelle: string,
  belege: Bestandsbeleg[],
  dateiVorhanden: (datei: string) => Promise<boolean>,
): Promise<Probezeile[]> {
  const { rows: objekte } = await c.query<{ objektnummer: string }>('select objektnummer from objekt')
  const { rows: gruppen } = await c.query<{ name: string; kurzcode: string }>(
    'select name, kurzcode from ordnungsgruppe where aktiv',
  )
  const { rows: kreditoren } = await c.query<{ name: string }>('select name from kreditor')
  const { rows: uebernommen } = await c.query<{ alt_kennung: string }>(
    `select alt_kennung from uebernahme_eintrag where quelle = $1 and ergebnis = 'uebernommen'`,
    [quelle],
  )
  const objektnummern = new Set(objekte.map((o) => o.objektnummer))
  const gruppennamen = new Set(gruppen.flatMap((g) => [g.name.toLowerCase(), g.kurzcode.toLowerCase()]))
  const kreditornamen = new Set(kreditoren.map((k) => k.name.toLowerCase()))
  const schon = new Set(uebernommen.map((u) => u.alt_kennung))
  const gesehen = new Set<string>()

  const ergebnis: Probezeile[] = []
  for (const b of belege) {
    const fehler: string[] = []
    const hinweise: string[] = []
    if (!(await dateiVorhanden(b.datei))) fehler.push('Datei nicht gefunden')
    if (gesehen.has(b.altKennung)) fehler.push('Kennung kommt im Export doppelt vor')
    gesehen.add(b.altKennung)
    if (b.objektnummer !== null && !objektnummern.has(b.objektnummer)) {
      fehler.push(`Objekt ${b.objektnummer} gibt es nicht`)
    }
    if (b.objektnummer === null) hinweise.push('ohne Objekt')
    if (b.ordnungsgruppe !== null && !gruppennamen.has(b.ordnungsgruppe.toLowerCase())) {
      fehler.push(`Ordnungsgruppe „${b.ordnungsgruppe}“ gibt es nicht`)
    }
    if (b.kreditor !== null && !kreditornamen.has(b.kreditor.toLowerCase())) {
      hinweise.push(`Kreditor „${b.kreditor}“ wird angelegt`)
    }
    if (b.belegart !== 'schriftverkehr' && b.belegart !== 'sonstiges') {
      if (b.rechnungsdatum === null) hinweise.push('ohne Rechnungsdatum')
      if (b.brutto === null) hinweise.push('ohne Betrag')
    }
    ergebnis.push({
      zeile: b.zeile,
      altKennung: b.altKennung,
      datei: b.datei,
      fehler,
      hinweise,
      schonUebernommen: schon.has(b.altKennung),
    })
  }
  return ergebnis
}

export class UebernahmeAbgelehnt extends Error {}

export interface Uebernahmeergebnis {
  ergebnis: 'uebernommen' | 'dublette' | 'fehler'
  dokumentId: string | null
  grund: string | null
}

async function kreditorFinden(c: PoolClient, name: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'select id from kreditor where lower(name) = lower($1) order by status limit 1',
    [name],
  )
  if (rows[0] !== undefined) return rows[0].id
  // Anlegen -- unter der Schreibpolicy der Stammdaten. Ohne das Recht kommt
  // ein RLS-Fehler zurueck, und der sagt, was fehlt.
  try {
    const { rows: neu } = await c.query<{ id: string }>(
      'insert into kreditor (mandant_id, name) values (app.mein_mandant(), $1) returning id',
      [name],
    )
    const id = neu[0]?.id
    if (id === undefined) throw new Error('kein Ergebnis')
    return id
  } catch {
    throw new UebernahmeAbgelehnt(
      `Kreditor „${name}“ ist unbekannt und darf von diesem Benutzer nicht angelegt werden (stammdaten_pflegen).`,
    )
  }
}

/**
 * Ein Altbeleg wird ein archivierter Beleg -- in **einer** Transaktion.
 *
 * Reihenfolge: Aufnehmen (ohne Lauf, ohne Auftrag) -> Aufbereiten (Seiten,
 * Bilder, Text) -> Fakten und Eingangsdatum setzen -> archivieren ->
 * vermerken. Die Fakten kommen **nach** der Aufbereitung, damit der Export
 * gewinnt, wenn die Extraktion etwas anderes gelesen hat -- und **vor** dem
 * Archivieren, weil danach nichts mehr am Beleg geaendert werden darf.
 */
export async function bestandUebernehmen(
  c: PoolClient,
  ablage: Ablage,
  benutzerId: string,
  mandantId: string,
  beleg: Bestandsbeleg,
  inhalt: Buffer,
  lauf: { kennung: string; quelle: string },
  texterkenner: Parameters<typeof aufbereiten>[3] = null,
): Promise<Uebernahmeergebnis> {
  let objektId: string | null = null
  if (beleg.objektnummer !== null) {
    const { rows } = await c.query<{ id: string }>('select id from objekt where objektnummer = $1', [
      beleg.objektnummer,
    ])
    objektId = rows[0]?.id ?? null
    if (objektId === null) throw new UebernahmeAbgelehnt(`Objekt ${beleg.objektnummer} gibt es nicht.`)
  }
  let ordnungsgruppeId: string | null = null
  if (beleg.ordnungsgruppe !== null) {
    const { rows } = await c.query<{ id: string }>(
      'select id from ordnungsgruppe where aktiv and (lower(name) = lower($1) or lower(kurzcode) = lower($1)) limit 1',
      [beleg.ordnungsgruppe],
    )
    ordnungsgruppeId = rows[0]?.id ?? null
    if (ordnungsgruppeId === null) throw new UebernahmeAbgelehnt(`Ordnungsgruppe „${beleg.ordnungsgruppe}“ gibt es nicht.`)
  }
  const kreditorId = beleg.kreditor === null ? null : await kreditorFinden(c, beleg.kreditor)

  const aufnahme = await dokumentAufnehmen(
    c,
    ablage,
    {
      mandantId,
      objektId,
      belegart: beleg.belegart,
      // Aus der CSV, also von einem Menschen: Die Erkennung aus dem
      // Inhalt stellt einen Bestandsbeleg nicht um.
      belegartFest: true,
      eingangskanal: 'uebernahme',
      dateiname: beleg.datei,
      mime: 'application/pdf',
      inhalt,
    },
    benutzerId,
    { bestand: true },
  )

  const vermerken = async (ergebnis: Uebernahmeergebnis['ergebnis'], grund: string | null) => {
    await c.query(
      `insert into uebernahme_eintrag
         (mandant_id, lauf, quelle, alt_kennung, datei, dokument_id, ergebnis, grund, benutzer_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [mandantId, lauf.kennung, lauf.quelle, beleg.altKennung, beleg.datei, aufnahme.dokumentId, ergebnis, grund, benutzerId],
    )
  }

  if (aufnahme.dublette.istDublette) {
    // Dieselben Bytes liegen schon da -- etwa aus einem frueheren Lauf oder
    // weil der Export einen Beleg zweimal enthaelt. Die Dublette bleibt
    // als abgelehnter Beleg stehen, verkettet mit dem Original.
    await vermerken('dublette', 'Dieselbe Datei ist bereits vorhanden.')
    return { ergebnis: 'dublette', dokumentId: aufnahme.dokumentId, grund: 'Dieselbe Datei ist bereits vorhanden.' }
  }

  await aufbereiten(c, ablage, aufnahme.dokumentId, texterkenner)

  const eingangAm = beleg.eingangAm ?? beleg.rechnungsdatum
  await c.query(
    `update dokument
        set ordnungsgruppe_id = coalesce($2, ordnungsgruppe_id),
            eingang_am = coalesce($3::date::timestamptz, eingang_am)
      where id = $1`,
    [aufnahme.dokumentId, ordnungsgruppeId, eingangAm],
  )

  if (beleg.belegart === 'schriftverkehr') {
    await c.query(
      `insert into schriftverkehr_fakten (dokument_id, richtung, korrespondent, betreff)
       values ($1, 'eingehend', $2, $3)
       on conflict (dokument_id) do update
         set korrespondent = coalesce(excluded.korrespondent, schriftverkehr_fakten.korrespondent),
             betreff = coalesce(excluded.betreff, schriftverkehr_fakten.betreff)`,
      [aufnahme.dokumentId, beleg.kreditor, beleg.betreff],
    )
  } else if (beleg.belegart !== 'sonstiges') {
    const wirtschaftsjahr = beleg.rechnungsdatum === null ? null : Number(beleg.rechnungsdatum.slice(0, 4))
    await c.query(
      `insert into rechnung_fakten
         (dokument_id, kreditor_id, rechnungsnummer, rechnungsdatum, netto, brutto, wirtschaftsjahr)
       values ($1, $2, $3, $4::date, $5, $6, $7)
       on conflict (dokument_id) do update
         set kreditor_id     = coalesce(excluded.kreditor_id, rechnung_fakten.kreditor_id),
             rechnungsnummer = coalesce(excluded.rechnungsnummer, rechnung_fakten.rechnungsnummer),
             rechnungsdatum  = coalesce(excluded.rechnungsdatum, rechnung_fakten.rechnungsdatum),
             netto           = coalesce(excluded.netto, rechnung_fakten.netto),
             brutto          = coalesce(excluded.brutto, rechnung_fakten.brutto),
             wirtschaftsjahr = coalesce(excluded.wirtschaftsjahr, rechnung_fakten.wirtschaftsjahr)`,
      [
        aufnahme.dokumentId,
        kreditorId,
        beleg.rechnungsnummer,
        beleg.rechnungsdatum,
        beleg.netto,
        beleg.brutto,
        wirtschaftsjahr,
      ],
    )
  }

  /*
   * Die Ampel nach den uebernommenen Fakten, nicht nach dem Geratenen.
   *
   * Die Aufbereitung hat extrahiert und geprueft, bevor die Fakten aus dem
   * Altsystem standen: Extraktion rot (nichts sicher gelesen), Befund
   * "Kreditor unbekannt". Beides beschreibt einen Zustand, den es nach dem
   * Upsert nicht mehr gibt. Die Fakten kommen aus dem Altsystem -- nichts
   * geraten, wie bei ZUGFeRD steht die Extraktion auf Gruen --, und die
   * Pruefung laeuft noch einmal gegen das, was jetzt am Beleg steht. Sonst
   * traegt jeder Altbeleg im Archiv eine rote Ampel, und Rot hiesse dort
   * nichts mehr.
   */
  await c.query(`update dokument set ampel_extraktion = 'gruen' where id = $1`, [aufnahme.dokumentId])
  await plausibilitaetPruefen(c, aufnahme.dokumentId)

  const bis = await archivieren(c, aufnahme.dokumentId)
  if (bis === null) throw new UebernahmeAbgelehnt('Der Beleg liess sich nicht archivieren.')

  await vermerken('uebernommen', null)
  return { ergebnis: 'uebernommen', dokumentId: aufnahme.dokumentId, grund: null }
}

/**
 * Ein Altbeleg, eine Transaktion -- und bei einem Fehler ein Vermerk in
 * einer zweiten. Die erste ist dann zurueckgerollt (kein halber Beleg), der
 * Vermerk bleibt: Ein Lauf ueber 25.000 Zeilen muss danach sagen koennen,
 * welche zwoelf nicht gingen und warum.
 */
export async function belegUebernehmen(
  ablage: Ablage,
  benutzerId: string,
  mandantId: string,
  beleg: Bestandsbeleg,
  inhalt: Buffer,
  lauf: { kennung: string; quelle: string },
  texterkenner: Parameters<typeof aufbereiten>[3] = null,
): Promise<Uebernahmeergebnis> {
  try {
    return await alsBenutzer(benutzerId, (c) =>
      bestandUebernehmen(c, ablage, benutzerId, mandantId, beleg, inhalt, lauf, texterkenner),
    )
  } catch (fehler) {
    // Kein Rohtext aus dem Beleg, keine Verbindungsdaten: der Grund ist
    // eine unserer Meldungen oder die Fehlerklasse.
    const grund =
      fehler instanceof UebernahmeAbgelehnt
        ? fehler.message
        : `Abgebrochen: ${fehler instanceof Error ? fehler.name : 'Fehler'}`
    await alsBenutzer(benutzerId, (c) =>
      c.query(
        `insert into uebernahme_eintrag
           (mandant_id, lauf, quelle, alt_kennung, datei, ergebnis, grund, benutzer_id)
         values ($1, $2, $3, $4, $5, 'fehler', $6, $7)`,
        [mandantId, lauf.kennung, lauf.quelle, beleg.altKennung, beleg.datei, grund, benutzerId],
      ),
    )
    return { ergebnis: 'fehler', dokumentId: null, grund }
  }
}

/** Das Protokoll eines Laufs -- fuer die Zusammenfassung und fuer Tests. */
export async function laufProtokoll(
  c: PoolClient,
  kennung: string,
): Promise<Array<{ altKennung: string; ergebnis: string; grund: string | null; dokumentId: string | null }>> {
  const { rows } = await c.query<{
    alt_kennung: string
    ergebnis: string
    grund: string | null
    dokument_id: string | null
  }>('select alt_kennung, ergebnis, grund, dokument_id from uebernahme_eintrag where lauf = $1 order by zeitpunkt', [
    kennung,
  ])
  return rows.map((z) => ({
    altKennung: z.alt_kennung,
    ergebnis: z.ergebnis,
    grund: z.grund,
    dokumentId: z.dokument_id,
  }))
}
