/**
 * Externe Belegeinsicht.
 *
 * Konzept 17. Ein Zugang für jemanden, der keinen Benutzer im DMS hat und
 * keinen bekommen soll — Eigentümer, Beirat, Mieter.
 *
 * **Es gibt keine Sitzung.** Der Token *ist* der Zugang, und deshalb wird bei
 * jedem Aufruf alles neu geprüft: Gültigkeit, Widerruf, Umfang. Eine Sitzung
 * würde genau die Frage verschieben, auf die es ankommt — „gilt das jetzt
 * noch?" —, und der harte Ablauf aus dem Konzept wäre keiner mehr.
 *
 * Die Regeln stehen in SQL. Diese Datei reicht durch und rechnet nichts nach:
 * Eine zweite Wahrheit über die Sichtbarkeit wäre eine zu viel.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { alsDatum, alsZeitpunkt } from '@/datum'
import { alsAnmeldung, alsBenutzer } from '@/db'
import { postAnlegen } from '@/postausgang'

export type Empfaengertyp = 'eigentuemer' | 'beirat' | 'mieter'
export type Umfang = 'vorgang' | 'wirtschaftsjahr' | 'belegliste'
export type Recht = 'ansicht' | 'kommentar' | 'stempel' | 'download'
export type Aktion = 'liste' | 'ansicht' | 'seite' | 'download' | 'abgelehnt'

export interface Gewaehrung {
  gewaehrungId: string
  objektId: string
  objektnummer: string
  objektName: string
  empfaengerTyp: Empfaengertyp
  personName: string
  umfang: Umfang
  rechte: Recht[]
  wasserzeichen: boolean
  gueltigBis: string
}

export interface Einsichtsbeleg {
  dokumentId: string
  eingangAm: string
  belegart: string
  rechnungsnummer: string | null
  brutto: number | null
  kreditor: string | null
  leistungVon: string | null
  leistungBis: string | null
}

function hash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/**
 * 32 Byte aus dem Zufallsgenerator des Betriebssystems.
 *
 * Der Token steht in einer URL, die per Mail verschickt wird — er ist damit
 * anfälliger als ein Cookie und muss entsprechend lang sein. Eine kurze,
 * „merkbare" Kennung wäre hier grob fahrlässig.
 */
export function tokenErzeugen(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Löst einen Token auf, oder `null`.
 *
 * `null` heißt: unbekannt, abgelaufen oder widerrufen. Der Unterschied wird
 * dem Empfänger **nicht** mitgeteilt — „abgelaufen" wäre bereits die
 * Auskunft, dass es diesen Zugang gab.
 */
export async function einsichtAufloesen(token: string): Promise<Gewaehrung | null> {
  if (token === '') return null

  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select * from app.einsicht_aufloesen($1)',
      [hash(token)],
    )
    const g = rows[0]
    if (g === undefined) return null

    return {
      gewaehrungId: String(g['gewaehrung_id']),
      objektId: String(g['objekt_id']),
      objektnummer: String(g['objektnummer']),
      objektName: String(g['objekt_name']),
      empfaengerTyp: String(g['empfaenger_typ']) as Empfaengertyp,
      personName: String(g['person_name']),
      umfang: String(g['umfang']) as Umfang,
      rechte: (g['rechte'] as string[]) as Recht[],
      wasserzeichen: Boolean(g['wasserzeichen']),
      gueltigBis: alsDatum(g['gueltig_bis']) ?? '',
    }
  })
}

export async function einsichtBelege(
  gewaehrungId: string,
  optionen: { limit?: number; versatz?: number } = {},
): Promise<Einsichtsbeleg[]> {
  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      'select * from app.einsicht_belege($1, $2, $3)',
      [gewaehrungId, optionen.limit ?? 50, optionen.versatz ?? 0],
    )
    return rows.map((z) => ({
      dokumentId: String(z['dokument_id']),
      eingangAm: alsZeitpunkt(z['eingang_am']) ?? '',
      belegart: String(z['belegart']),
      rechnungsnummer: z['rechnungsnummer'] == null ? null : String(z['rechnungsnummer']),
      brutto: z['brutto'] == null ? null : Number(z['brutto']),
      kreditor: z['kreditor'] == null ? null : String(z['kreditor']),
      leistungVon: alsDatum(z['leistung_von']),
      leistungBis: alsDatum(z['leistung_bis']),
    }))
  })
}

/**
 * Darf dieser Beleg unter dieser Gewährung ausgeliefert werden?
 *
 * Wird bei **jeder** Seite und jedem Download neu gefragt — nicht einmal für
 * die Liste. Sonst wäre der 51. Beleg unsichtbar und trotzdem abrufbar.
 */
export async function einsichtDarfBeleg(
  gewaehrungId: string,
  dokumentId: string,
): Promise<boolean> {
  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<{ einsicht_darf_beleg: boolean }>(
      'select app.einsicht_darf_beleg($1, $2)',
      [gewaehrungId, dokumentId],
    )
    return rows[0]?.einsicht_darf_beleg === true
  })
}

/**
 * Die Datei zu einem Beleg -- Umfangspruefung inbegriffen.
 *
 * Bewusst nicht "pruefen, dann holen": Die SQL-Funktion tut beides in einem
 * Zug. Zwei Schritte waeren zwei Stellen, an denen jemand den ersten
 * vergisst.
 */
export async function einsichtDatei(
  gewaehrungId: string,
  dokumentId: string,
  variante: 'ansicht_webp' | 'original',
  seite: number | null = null,
): Promise<{ storageKey: string; mime: string } | null> {
  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<{ storage_key: string; mime: string }>(
      'select * from app.einsicht_datei($1, $2, $3, $4)',
      [gewaehrungId, dokumentId, variante, seite],
    )
    const d = rows[0]
    return d === undefined ? null : { storageKey: d.storage_key, mime: d.mime }
  })
}

export async function einsichtProtokollieren(
  gewaehrungId: string,
  dokumentId: string | null,
  aktion: Aktion,
  ip: string | null = null,
): Promise<void> {
  await alsAnmeldung((c) =>
    c.query('select app.einsicht_protokollieren($1, $2, $3, $4)', [
      gewaehrungId,
      dokumentId,
      aktion,
      ip,
    ]),
  )
}

/* ---------------------------------------------------------------------------
 * Aus dem Haus heraus
 * ------------------------------------------------------------------------ */

export interface Gewaehrungswunsch {
  objektId: string
  personId: string
  empfaengerTyp: Empfaengertyp
  umfang: Umfang
  /** Tage ab heute. Für Mieter typischerweise sieben (Konzept 17). */
  tage: number
  rechte?: Recht[]
  vorgangId?: string | null
  wirtschaftsjahr?: number | null
  wasserzeichen?: boolean
  /**
   * Den Link per Mail versenden statt ihn nur anzuzeigen.
   *
   * `basisUrl` ist Pflicht, wenn gesendet wird — der Link muss vollständig
   * sein, und wie die Anwendung von außen heißt, weiß dieses Modul nicht.
   */
  mailAn?: { adresse: string; basisUrl: string } | null
}

export class EinsichtAbgelehnt extends Error {}

/**
 * „42 WEG Lindenweg 3" für die Mail.
 *
 * Läuft unter der RLS auf derselben Verbindung — wer das Objekt nicht sieht,
 * bekommt einen leeren Namen und keine Zeile aus einem fremden Mandanten.
 */
async function objektbezeichnung(c: PoolClient, objektId: string): Promise<string> {
  const { rows } = await c.query<{ objektnummer: string; bezeichnung: string }>(
    'select objektnummer, bezeichnung from objekt where id = $1',
    [objektId],
  )
  const o = rows[0]
  return o === undefined ? '' : `${o.objektnummer} ${o.bezeichnung}`
}

/**
 * Gewährt Einsicht und liefert den Token — **einmal**.
 *
 * Danach steht in der Datenbank nur noch sein Hash. Wer ihn verliert, bekommt
 * keinen zweiten: Es wird eine neue Gewährung angelegt und die alte
 * widerrufen. Das ist kein Schikane, sondern der Grund, warum ein Auszug aus
 * der Datenbank keinen Zugang öffnet.
 */
export async function einsichtGewaehren(
  benutzerId: string,
  wunsch: Gewaehrungswunsch,
): Promise<{ gewaehrungId: string; token: string }> {
  if (wunsch.tage < 1 || wunsch.tage > 365) {
    throw new EinsichtAbgelehnt('Die Gültigkeit muss zwischen 1 und 365 Tagen liegen.')
  }

  const token = tokenErzeugen()
  const gewaehrungId = await alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ einsicht_gewaehren: string | null }>(
      `select app.einsicht_gewaehren($1, $2, $3, $4, $5,
                                     current_date + $6::integer,
                                     $7::text[], $8, $9, $10)`,
      [
        wunsch.objektId,
        wunsch.personId,
        wunsch.empfaengerTyp,
        wunsch.umfang,
        hash(token),
        wunsch.tage,
        wunsch.rechte ?? ['ansicht'],
        wunsch.vorgangId ?? null,
        wunsch.wirtschaftsjahr ?? null,
        wunsch.wasserzeichen ?? true,
      ],
    )
    const id = rows[0]?.einsicht_gewaehren ?? null
    if (id === null || wunsch.mailAn == null) return id

    /*
     * Der Ausgangseintrag liegt in derselben Transaktion wie die Gewährung.
     * Andernfalls gäbe es zwei Fehlerfälle, die beide schlecht sind: eine
     * Gewährung, deren Link nie hinausgeht, oder eine Mail mit einem Link
     * auf eine Gewährung, die es nicht gibt.
     *
     * `fluechtig`: Der Token steht im Text. Nach erfolgreichem Versand
     * ersetzt ihn die Datenbank durch einen Vermerk — sonst läge er im
     * Klartext im Ausgangsbuch, so lange die Gewährung gilt.
     */
    const { rows: empfaenger } = await c.query<{ name: string }>(
      'select name from person where id = $1',
      [wunsch.personId],
    )
    const bis = new Date(Date.now() + wunsch.tage * 86_400_000)
    await postAnlegen(c, {
      schluessel: 'einsicht_link',
      anlass: 'einsicht',
      empfaenger: wunsch.mailAn.adresse,
      fluechtig: true,
      werte: {
        empfaenger: empfaenger[0]?.name ?? '',
        link: `${wunsch.mailAn.basisUrl.replace(/\/$/, '')}/einsicht/${token}`,
        gueltig_bis: alsDatum(bis) ?? '',
        objekt: await objektbezeichnung(c, wunsch.objektId),
      },
    })
    return id
  })

  if (gewaehrungId === null) {
    throw new EinsichtAbgelehnt('Das Objekt ist nicht erreichbar.')
  }
  return { gewaehrungId, token }
}

export async function einsichtWiderrufen(
  benutzerId: string,
  gewaehrungId: string,
): Promise<boolean> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ einsicht_widerrufen: boolean }>(
      'select app.einsicht_widerrufen($1)',
      [gewaehrungId],
    )
    return rows[0]?.einsicht_widerrufen === true
  })
}

export interface Gewaehrungszeile {
  id: string
  objektnummer: string
  personName: string
  empfaengerTyp: string
  umfang: string
  rechte: string[]
  gueltigBis: string
  widerrufen: boolean
  abgelaufen: boolean
  zugriffe: number
  letzterZugriff: string | null
}

/** Die Gewährungen, die der Angemeldete sehen darf. */
export async function gewaehrungenLaden(benutzerId: string): Promise<Gewaehrungszeile[]> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select g.id, o.objektnummer, p.name as person_name, g.empfaenger_typ,
              g.umfang, g.rechte,
              to_char(g.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
              g.widerrufen_am is not null as widerrufen,
              g.gueltig_bis < current_date as abgelaufen,
              (select count(*) from zugriff_protokoll z
                where z.gewaehrung_id = g.id) as zugriffe,
              (select max(z.zeitpunkt) from zugriff_protokoll z
                where z.gewaehrung_id = g.id) as letzter
         from einsicht_gewaehrung g
         join objekt o on o.id = g.objekt_id
         join person p on p.id = g.person_id
        order by g.erstellt_am desc`,
    )
    return rows.map((z) => ({
      id: String(z['id']),
      objektnummer: String(z['objektnummer']),
      personName: String(z['person_name']),
      empfaengerTyp: String(z['empfaenger_typ']),
      umfang: String(z['umfang']),
      rechte: z['rechte'] as string[],
      gueltigBis: String(z['gueltig_bis']),
      widerrufen: Boolean(z['widerrufen']),
      abgelaufen: Boolean(z['abgelaufen']),
      zugriffe: Number(z['zugriffe']),
      letzterZugriff: alsZeitpunkt(z['letzter']),
    }))
  })
}

/** Das Protokoll einer Gewährung — der Nachweis, dass Einsicht bestand. */
export async function protokollLaden(
  benutzerId: string,
  gewaehrungId: string,
): Promise<Array<{ zeitpunkt: string; aktion: string; dokumentId: string | null }>> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select zeitpunkt, aktion, dokument_id from zugriff_protokoll
        where gewaehrung_id = $1 order by zeitpunkt desc limit 200`,
      [gewaehrungId],
    )
    return rows.map((z) => ({
      zeitpunkt: (z['zeitpunkt'] as Date).toISOString(),
      aktion: String(z['aktion']),
      dokumentId: z['dokument_id'] == null ? null : String(z['dokument_id']),
    }))
  })
}

/** Nur für Tests und den Versand: der Client-seitige Hash des Tokens. */
export function tokenHash(token: string): Buffer {
  return hash(token)
}

export async function einsichtBelegeMitClient(
  c: PoolClient,
  gewaehrungId: string,
): Promise<Einsichtsbeleg[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    'select * from app.einsicht_belege($1, 50, 0)',
    [gewaehrungId],
  )
  return rows.map((z) => ({
    dokumentId: String(z['dokument_id']),
    eingangAm: alsZeitpunkt(z['eingang_am']) ?? '',
    belegart: String(z['belegart']),
    rechnungsnummer: z['rechnungsnummer'] == null ? null : String(z['rechnungsnummer']),
    brutto: z['brutto'] == null ? null : Number(z['brutto']),
    kreditor: z['kreditor'] == null ? null : String(z['kreditor']),
    leistungVon: alsDatum(z['leistung_von']),
    leistungBis: alsDatum(z['leistung_bis']),
  }))
}
