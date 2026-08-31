/**
 * Plausibilitätsprüfungen und die Gesamtampel.
 *
 * Grundlage: Konzept 14. Zwei Vertrauenswerte, weil zwei verschiedene Fragen
 * dahinterstehen: Wie sicher wurde gelesen (Extraktion) — und ergibt das
 * Gelesene fachlich Sinn (Plausibilität)? „IBAN weicht ab" ist ein anderer
 * Fall als „Betrag unscharf gelesen", und ein Beleg kann perfekt gelesen und
 * trotzdem falsch sein.
 *
 * Wie nötig dieser zweite Blick ist, hat eine Messung gezeigt: Ein zu
 * kleines Modell lieferte netto 0,80, Steuer 0,19 und brutto 0,95 für einen
 * Beleg über 454,22 € — mit hohem Extraktionsvertrauen, denn es war sich
 * seiner Sache sicher. Die Summenprobe erledigt so etwas in einer Zeile
 * (siehe docs/messungen.md).
 *
 * Zwei Prüfungen sind **hart**: Sie färben nicht nur, sie halten die
 * Bearbeitung an. Bei beiden wäre der Schaden groß und die Korrektur teuer.
 */

import type { PoolClient } from 'pg'
import { mahnungPruefen } from './mahnung'

export type Schwere = 'hart' | 'orange' | 'hinweis'
export type Ampel = 'gruen' | 'orange' | 'rot'

export interface Befund {
  pruefung: string
  schwere: Schwere
  hinweis: string
}

interface Belegdaten {
  dokument_id: string
  belegart: string
  mandant_id: string
  objekt_id: string | null
  kreditor_id: string | null
  kreditor_name: string | null
  kreditor_ust_id: string | null
  rechnungsnummer: string | null
  rechnungsdatum: string | null
  netto: string | null
  steuer: string | null
  brutto: string | null
  iban_im_beleg: string | null
  ampel_extraktion: Ampel | null
}

/** Vergleicht IBANs ohne Rücksicht auf Leerzeichen und Schreibweise. */
function ibanGleich(a: string, b: string): boolean {
  const knapp = (x: string) => x.replace(/\s/g, '').toUpperCase()
  return knapp(a) === knapp(b)
}

function betrag(roh: string | null): number | null {
  if (roh === null) return null
  const zahl = Number(roh)
  return Number.isFinite(zahl) ? zahl : null
}

/**
 * IBAN gegen den bekannten Kreditor — hart.
 *
 * Der klassische Betrugsfall: Jemand fängt eine Rechnung ab und tauscht die
 * Bankverbindung. Der Beleg sieht makellos aus, alle Felder stimmen, nur das
 * Geld geht woanders hin. Deshalb hält diese Prüfung an, statt zu färben.
 *
 * Eine unbekannte IBAN bei bekanntem Kreditor ist der Verdachtsfall. Ist der
 * Kreditor selbst neu, gibt es nichts zu vergleichen — dann greift die
 * Prüfung nicht, und die Bankverbindung wird beim ersten Mal bestätigt.
 */
async function ibanPruefen(c: PoolClient, beleg: Belegdaten): Promise<Befund | null> {
  if (beleg.iban_im_beleg === null || beleg.kreditor_id === null) return null

  const { rows } = await c.query<{ iban: string; status: string }>(
    'select iban, status from kreditor_bankverbindung where kreditor_id = $1',
    [beleg.kreditor_id],
  )
  if (rows.length === 0) return null // Kreditor ohne hinterlegte Bankverbindung

  const treffer = rows.find((z) => ibanGleich(z.iban, beleg.iban_im_beleg as string))

  if (treffer === undefined) {
    return {
      pruefung: 'iban_unbekannt',
      schwere: 'hart',
      hinweis:
        'Die Bankverbindung im Beleg gehört nicht zu den hinterlegten dieses ' +
        'Kreditors. Vor jeder Zahlung telefonisch beim Kreditor rückfragen — ' +
        'nicht unter einer Nummer aus dem Beleg.',
    }
  }
  if (treffer.status === 'gesperrt') {
    return {
      pruefung: 'iban_gesperrt',
      schwere: 'hart',
      hinweis: 'Die Bankverbindung im Beleg ist als gesperrt gekennzeichnet.',
    }
  }
  if (treffer.status === 'neu') {
    return {
      pruefung: 'iban_unbestaetigt',
      schwere: 'orange',
      hinweis: 'Die Bankverbindung ist bekannt, aber noch nicht bestätigt.',
    }
  }
  return null
}

/**
 * Dublette über Kreditor, Rechnungsnummer und Betrag — hart.
 *
 * Die Prüfung über den Inhaltshash beim Eingang fängt dieselbe Datei ab.
 * Diese hier fängt dasselbe Papier: neu eingescannt, als Mailanhang
 * nachgereicht, vom Lieferanten erneut geschickt.
 */
async function dublettePruefen(c: PoolClient, beleg: Belegdaten): Promise<Befund | null> {
  if (
    beleg.kreditor_id === null ||
    beleg.rechnungsnummer === null ||
    beleg.brutto === null
  ) {
    return null
  }

  const { rows } = await c.query<{ id: string; eingang_am: string }>(
    `select d.id, d.eingang_am
       from dokument d
       join rechnung_fakten f on f.dokument_id = d.id
      where d.mandant_id = $1
        and d.id <> $2
        and d.dublette_von is null
        and d.status <> 'storniert'
        and f.kreditor_id = $3
        and f.rechnungsnummer = $4
        and f.brutto = $5
      order by d.eingang_am
      limit 1`,
    [
      beleg.mandant_id,
      beleg.dokument_id,
      beleg.kreditor_id,
      beleg.rechnungsnummer,
      beleg.brutto,
    ],
  )
  if (rows.length === 0) return null

  return {
    pruefung: 'dublette',
    schwere: 'hart',
    hinweis:
      `Kreditor, Rechnungsnummer und Betrag stimmen mit einem Beleg vom ` +
      `${new Date(rows[0].eingang_am).toLocaleDateString('de-DE')} überein. ` +
      'Vor der Zahlung klären, ob es dieselbe Rechnung ist.',
  }
}

/** Pflichtangaben nach § 14 UStG — orange, mit Reklamationsvorschlag. */
function pflichtangabenPruefen(beleg: Belegdaten): Befund | null {
  const fehlt: string[] = []
  if (beleg.rechnungsnummer === null) fehlt.push('Rechnungsnummer')
  if (beleg.rechnungsdatum === null) fehlt.push('Rechnungsdatum')
  if (beleg.kreditor_name === null) fehlt.push('Name des Rechnungsstellers')
  if (beleg.kreditor_ust_id === null) fehlt.push('USt-IdNr. oder Steuernummer')
  if (betrag(beleg.netto) === null) fehlt.push('Nettobetrag')
  if (betrag(beleg.steuer) === null) fehlt.push('Steuerbetrag')

  if (fehlt.length === 0) return null
  return {
    pruefung: 'pflichtangaben_ust',
    schwere: 'orange',
    hinweis:
      `Für den Vorsteuerabzug fehlen: ${fehlt.join(', ')}. ` +
      'Wenn die Angaben auf dem Beleg stehen, nachtragen; sonst beim ' +
      'Kreditor eine berichtigte Rechnung anfordern.',
  }
}

/**
 * Netto plus Steuer ergibt brutto — orange.
 *
 * Steht so nicht in der Liste des Konzepts und gehört trotzdem hierher: Es
 * ist die billigste Prüfung überhaupt und fängt genau den Fall ab, den eine
 * Messung zutage gefördert hat — sicher gelesene, aber unsinnige Beträge.
 * Ein Cent Abweichung ist Rundung, mehr nicht.
 */
function betragsprobePruefen(beleg: Belegdaten): Befund | null {
  const netto = betrag(beleg.netto)
  const steuer = betrag(beleg.steuer)
  const brutto = betrag(beleg.brutto)
  if (netto === null || steuer === null || brutto === null) return null

  const abweichung = Math.abs(netto + steuer - brutto)
  if (abweichung <= 0.02) return null

  return {
    pruefung: 'betragsprobe',
    schwere: 'orange',
    hinweis:
      `Netto ${netto.toFixed(2)} plus Steuer ${steuer.toFixed(2)} ergibt nicht ` +
      `den Rechnungsbetrag ${brutto.toFixed(2)} (Abweichung ` +
      `${abweichung.toFixed(2)}). Beträge am Beleg prüfen.`,
  }
}

/** Kreditor eindeutig zugeordnet — orange, wenn nicht. */
function kreditorPruefen(beleg: Belegdaten): Befund | null {
  if (beleg.kreditor_id !== null) return null
  return {
    pruefung: 'kreditor_unbekannt',
    schwere: 'orange',
    hinweis:
      beleg.kreditor_name === null
        ? 'Kein Rechnungssteller erkannt. Kreditor von Hand zuordnen.'
        : `Der Rechnungssteller „${beleg.kreditor_name}" ist keinem Kreditor ` +
          'zugeordnet. Vorhandenen auswählen oder neu anlegen.',
  }
}

/** Betrag innerhalb der Vertragstoleranz — orange bei Abweichung. */
async function vertragPruefen(c: PoolClient, beleg: Belegdaten): Promise<Befund | null> {
  const brutto = betrag(beleg.brutto)
  if (brutto === null || beleg.kreditor_id === null || beleg.objekt_id === null) return null

  const { rows } = await c.query<{
    bezeichnung: string
    erwarteter_betrag: string
    toleranz_prozent: string | null
  }>(
    `select bezeichnung, erwarteter_betrag, toleranz_prozent
       from vertrag
      where kreditor_id = $1 and objekt_id = $2 and aktiv
        and erwarteter_betrag is not null
      limit 1`,
    [beleg.kreditor_id, beleg.objekt_id],
  )
  const vertrag = rows[0]
  if (vertrag === undefined) return null

  const erwartet = Number(vertrag.erwarteter_betrag)
  const toleranz = Number(vertrag.toleranz_prozent ?? 0)
  const grenze = erwartet * (1 + toleranz / 100)
  if (brutto <= grenze) return null

  return {
    pruefung: 'vertragstoleranz',
    schwere: 'orange',
    hinweis:
      `Der Betrag ${brutto.toFixed(2)} liegt über dem für „${vertrag.bezeichnung}" ` +
      `erwarteten Betrag ${erwartet.toFixed(2)}` +
      (toleranz > 0 ? ` zuzüglich ${toleranz} % Toleranz` : '') +
      '. Preiserhöhung oder Zusatzleistung prüfen.',
  }
}

/**
 * Die Gesamtampel: der schlechtere der beiden Werte, und rot, sobald eine
 * harte Prüfung anschlägt (Konzept 14). Grün nur, wenn beide grün sind.
 */
export function gesamtampel(
  extraktion: Ampel | null,
  plausibilitaet: Ampel,
): Ampel {
  const rang: Record<Ampel, number> = { gruen: 0, orange: 1, rot: 2 }
  const links = extraktion ?? 'rot'
  return rang[links] >= rang[plausibilitaet] ? links : plausibilitaet
}

export function ampelAusBefunden(befunde: Befund[]): Ampel {
  if (befunde.some((b) => b.schwere === 'hart')) return 'rot'
  if (befunde.some((b) => b.schwere === 'orange')) return 'orange'
  return 'gruen'
}

export interface Pruefergebnis {
  befunde: Befund[]
  ampelPlausibilitaet: Ampel
  ampelGesamt: Ampel
  /** Harte Befunde halten die Bearbeitung an. */
  gestoppt: boolean
}

/**
 * Prüft einen Beleg und schreibt Befunde und Ampeln fort.
 *
 * Läuft die Prüfung erneut — etwa nachdem jemand den Kreditor zugeordnet hat
 * —, ersetzt sie ihre eigenen Befunde. Was behoben ist, verschwindet.
 */
export async function plausibilitaetPruefen(
  c: PoolClient,
  dokumentId: string,
): Promise<Pruefergebnis> {
  const { rows } = await c.query<Belegdaten>(
    `select d.id as dokument_id, d.mandant_id, d.objekt_id, d.ampel_extraktion, d.belegart,
            f.kreditor_id, f.rechnungsnummer, f.rechnungsdatum,
            f.netto, f.steuer, f.brutto, f.iban_im_beleg,
            k.name as kreditor_name, k.ust_id as kreditor_ust_id
       from dokument d
       left join rechnung_fakten f on f.dokument_id = d.id
       left join kreditor k on k.id = f.kreditor_id
      where d.id = $1`,
    [dokumentId],
  )
  const beleg = rows[0]
  if (beleg === undefined) {
    return { befunde: [], ampelPlausibilitaet: 'rot', ampelGesamt: 'rot', gestoppt: false }
  }

  // Der erkannte Name steht am Kreditor, wenn zugeordnet -- sonst im
  // Extraktionsfeld. Fuer die Pflichtangaben zaehlt beides.
  if (beleg.kreditor_name === null) {
    const { rows: erkannt } = await c.query<{ wert_text: string | null }>(
      `select wert_text from extraktion_feld
        where dokument_id = $1 and feldname = 'kreditor_name' limit 1`,
      [dokumentId],
    )
    beleg.kreditor_name = erkannt[0]?.wert_text ?? null
  }
  if (beleg.kreditor_ust_id === null) {
    const { rows: erkannt } = await c.query<{ wert_text: string | null }>(
      `select wert_text from extraktion_feld
        where dokument_id = $1 and feldname = 'kreditor_ust_id' limit 1`,
      [dokumentId],
    )
    beleg.kreditor_ust_id = erkannt[0]?.wert_text ?? null
  }

  // Nacheinander, nicht über Promise.all: Die Prüfungen teilen sich eine
  // Verbindung, und eine Verbindung führt genau eine Abfrage zur Zeit. pg
  // stellt sie zwar in eine Schlange, warnt aber davor -- ab pg 9 ist es ein
  // Fehler. Nebenläufig gewonnen wäre hier ohnehin nichts.
  const moegliche: Array<Befund | null> = [
    await ibanPruefen(c, beleg),
    await dublettePruefen(c, beleg),
    await vertragPruefen(c, beleg),
    kreditorPruefen(beleg),
    pflichtangabenPruefen(beleg),
    betragsprobePruefen(beleg),
  ]

  // Eine Mahnung laeuft nicht wie ein gewoehnlicher Beleg durch: Sie wird
  // gegen die Ursprungsrechnung geprueft und mit ihr verkettet (Konzept 14).
  if (beleg.belegart === 'mahnung') {
    moegliche.push(...(await mahnungPruefen(c, dokumentId)))
  }
  const befunde = moegliche.filter((b): b is Befund => b !== null)

  // Eigene Befunde ersetzen, nicht daneben legen: Was behoben ist, soll
  // verschwinden.
  await c.query('delete from plausibilitaet_befund where dokument_id = $1', [dokumentId])
  for (const befund of befunde) {
    await c.query(
      `insert into plausibilitaet_befund (dokument_id, pruefung, schwere, hinweis)
       values ($1, $2, $3, $4)`,
      [dokumentId, befund.pruefung, befund.schwere, befund.hinweis],
    )
  }

  const ampelPlausibilitaet = ampelAusBefunden(befunde)
  const ampelGesamt = gesamtampel(beleg.ampel_extraktion, ampelPlausibilitaet)
  const gestoppt = befunde.some((b) => b.schwere === 'hart')

  await c.query(
    `update dokument set ampel_plausibilitaet = $2, ampel_gesamt = $3 where id = $1`,
    [dokumentId, ampelPlausibilitaet, ampelGesamt],
  )

  if (gestoppt) {
    // Harte Befunde faerben nicht nur, sie halten an (Konzept 14). Der Lauf
    // geht in Klaerung: Damit sind keine Stempel mehr moeglich, und der Beleg
    // erscheint im Klaerungspostfach statt still liegen zu bleiben.
    const grund = befunde.find((b) => b.schwere === 'hart') as Befund
    const { rows: laeufe } = await c.query<{ id: string; stufe: string | null }>(
      `select id, aktuelle_stufe_id as stufe from dokument_lauf
        where dokument_id = $1 and status = 'laufend'`,
      [dokumentId],
    )
    for (const lauf of laeufe) {
      await c.query(`update dokument_lauf set status = 'klaerung' where id = $1`, [lauf.id])
      await c.query(
        `insert into klaerung (dokument_id, grund, kategorie, kommentar, eroeffnet_von,
                               verantwortlich_benutzer, stufe_beim_eintritt, wiedervorlage_am)
         select $1, 'Plausibilitaet', $2, $3,
                coalesce(d.erfasst_von, app.mein_benutzer()),
                coalesce(
                  (select z.benutzer_id from objekt_zustaendigkeit z
                    where z.objekt_id = d.objekt_id and z.art = 'hauptverantwortlich'
                      and z.gueltig_von <= current_date
                      and (z.gueltig_bis is null or z.gueltig_bis >= current_date)
                    limit 1),
                  d.erfasst_von, app.mein_benutzer()),
                $4, current_date + 7
           from dokument d where d.id = $1`,
        [dokumentId, grund.pruefung, grund.hinweis, lauf.stufe],
      )
    }
  }

  return { befunde, ampelPlausibilitaet, ampelGesamt, gestoppt }
}
