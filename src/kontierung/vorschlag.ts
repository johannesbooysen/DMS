/**
 * Kontierungsvorschlag aus dem Lernspeicher.
 *
 * Grundlage: Konzept 15. `kontierungs_muster` stand seit dem Kernschema mit
 * Konto, Umlageschluessel, Umlagefaehigkeit und Kategorie -- und hatte bis
 * hierher keine Zeile Code. Der Buchhalter kontierte jede Rechnung des
 * Hausmeisters zum hundertsten Mal von Hand auf dasselbe Konto.
 *
 * **Die Reihenfolge ist die Aussage**, wie bei Objekt und Kategorie:
 *
 *   1. **Gelerntes Muster fuer Kreditor und Objekt** -- die genaueste
 *      Quelle: So wurde *dieser* Lieferant bei *diesem* Haus bisher gebucht.
 *      Gruen ab drei Bestaetigungen, davor orange: Eine einzelne Kontierung
 *      kann ein Irrtum gewesen sein, drei sind eine Gewohnheit.
 *   2. **Gelerntes Muster nur fuer den Kreditor** (Objekt unbekannt oder
 *      noch nie dort) -- orange, denn ein anderes Haus hat womoeglich einen
 *      anderen Kontenrahmen.
 *   3. **Kontovorschlag der Kategorie** (`ordnungsgruppe.konto_vorschlag_id`)
 *      -- orange: eine Stammdatenangabe, kein Nachweis aus dem eigenen Haus.
 *
 * **Ein Vorschlag wird nie still uebernommen.** Anders als bei Objekt und
 * Kategorie schreibt hier niemand automatisch: Eine Kontierung ist eine
 * Buchung, und der Summenzwang verlangt, dass ein Mensch sie abschliesst.
 * Der Vorschlag steht in der Maske und wird mit **einem** Klick zur Zeile --
 * das ist der Ertrag, nicht die Automatik.
 *
 * **Gelernt wird die Regel, nicht die Ausnahme.** Nur eine Kontierung auf
 * **ein** Konto wird zum Muster; ein Split ist eine Entscheidung je Beleg.
 * `kontierung` kennt keine Positionstexte, deshalb steht im Muster der
 * feste Schluessel `gesamt` -- die Spalte ist fuer spaetere Einzelpositionen
 * angelegt und bleibt dafuer frei.
 */

import type { PoolClient } from 'pg'

/** Ab so vielen Bestaetigungen gilt ein Muster als Gewohnheit. */
export const GEWOHNHEIT_AB = 3

/** Positionsschluessel fuer eine Kontierung des ganzen Belegs. */
export const GESAMT = 'gesamt'

export interface Kontierungsvorschlag {
  kontoId: string
  kontonummer: string
  kontobezeichnung: string
  umlageschluesselId: string | null
  umlagefaehig: boolean
  /** Aus dem Beleg abgeleitet; 19, wenn sich nichts ableiten laesst. */
  steuersatz: number
  begruendung: string
  sicherheit: 'gruen' | 'orange'
  quelle: 'muster_objekt' | 'muster_kreditor' | 'kategorie'
}

interface Musterzeile {
  konto_id: string
  kontonummer: string
  bezeichnung: string
  umlageschluessel_id: string | null
  umlagefaehig: boolean
  trefferzahl: number
  objekt_id: string | null
}

/**
 * Steuersatz aus Netto und Brutto des Belegs.
 *
 * `kontierungs_muster` traegt keinen Steuersatz -- er gehoert zum Beleg,
 * nicht zur Gewohnheit. Auf ganze Prozent gerundet, damit aus 1.000 / 1.190
 * die 19 wird und nicht 18,999.
 */
async function steuersatzDesBelegs(c: PoolClient, dokumentId: string): Promise<number> {
  const { rows } = await c.query<{ netto: string | null; brutto: string | null }>(
    'select netto, brutto from rechnung_fakten where dokument_id = $1',
    [dokumentId],
  )
  const netto = Number(rows[0]?.netto)
  const brutto = Number(rows[0]?.brutto)
  if (!Number.isFinite(netto) || !Number.isFinite(brutto) || netto <= 0) return 19
  const satz = Math.round((brutto / netto - 1) * 100)
  return satz >= 0 && satz <= 30 ? satz : 19
}

export async function kontierungVorschlagen(
  c: PoolClient,
  dokumentId: string,
): Promise<Kontierungsvorschlag | null> {
  /*
   * Nur Konten aus dem Kontenrahmen des Objekts (Konzept 20): Ein Muster,
   * das an einem anderen Haus gelernt wurde, kann auf ein Konto zeigen, das
   * es hier nicht gibt -- der Vorschlag wuerde beim Uebernehmen abgewiesen,
   * und ein Vorschlag, der nicht geht, ist schlechter als keiner.
   */
  const { rows: muster } = await c.query<Musterzeile>(
    `select m.konto_id, ko.kontonummer, ko.bezeichnung, m.umlageschluessel_id,
            m.umlagefaehig, m.trefferzahl, m.objekt_id
       from dokument d
       join rechnung_fakten f on f.dokument_id = d.id
       join objekt o on o.id = d.objekt_id
       join kontierungs_muster m on m.mandant_id = d.mandant_id
                                and m.kreditor_id = f.kreditor_id
                                and m.aktiv
                                and (m.objekt_id = d.objekt_id or m.objekt_id is null)
       join konto ko on ko.id = m.konto_id
                    and ko.kontenrahmen_id = o.kontenrahmen_id
                    and ko.aktiv
      where d.id = $1
      order by (m.objekt_id is not null) desc, m.trefferzahl desc`,
    [dokumentId],
  )

  const steuersatz = await steuersatzDesBelegs(c, dokumentId)
  const erstes = muster[0]

  if (erstes !== undefined && erstes.objekt_id !== null) {
    const gewohnheit = erstes.trefferzahl >= GEWOHNHEIT_AB
    return {
      kontoId: erstes.konto_id,
      kontonummer: erstes.kontonummer,
      kontobezeichnung: erstes.bezeichnung,
      umlageschluesselId: erstes.umlageschluessel_id,
      umlagefaehig: erstes.umlagefaehig,
      steuersatz,
      begruendung: gewohnheit
        ? `Dieser Kreditor wurde bei diesem Objekt ${erstes.trefferzahl}-mal so kontiert.`
        : `Dieser Kreditor wurde bei diesem Objekt bisher ${erstes.trefferzahl}-mal so ` +
          `kontiert — noch keine Gewohnheit.`,
      sicherheit: gewohnheit ? 'gruen' : 'orange',
      quelle: 'muster_objekt',
    }
  }

  if (erstes !== undefined) {
    return {
      kontoId: erstes.konto_id,
      kontonummer: erstes.kontonummer,
      kontobezeichnung: erstes.bezeichnung,
      umlageschluesselId: erstes.umlageschluessel_id,
      umlagefaehig: erstes.umlagefaehig,
      steuersatz,
      begruendung:
        `Dieser Kreditor wurde bei anderen Objekten so kontiert ` +
        `(${erstes.trefferzahl}-mal) — hier noch nie.`,
      sicherheit: 'orange',
      quelle: 'muster_kreditor',
    }
  }

  const { rows: kategorie } = await c.query<{
    konto_id: string
    kontonummer: string
    bezeichnung: string
    umlageschluessel_id: string | null
    umlagefaehig: boolean
    name: string
  }>(
    `select ko.id as konto_id, ko.kontonummer, ko.bezeichnung,
            ko.umlageschluessel_default_id as umlageschluessel_id,
            ko.umlagefaehig_default as umlagefaehig, og.name
       from dokument d
       join objekt o on o.id = d.objekt_id
       join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
       join konto ko on ko.id = og.konto_vorschlag_id
                    and ko.kontenrahmen_id = o.kontenrahmen_id
                    and ko.aktiv
      where d.id = $1`,
    [dokumentId],
  )
  const k = kategorie[0]
  if (k !== undefined) {
    return {
      kontoId: k.konto_id,
      kontonummer: k.kontonummer,
      kontobezeichnung: k.bezeichnung,
      umlageschluesselId: k.umlageschluessel_id,
      umlagefaehig: k.umlagefaehig,
      steuersatz,
      begruendung: `Kontovorschlag der Kategorie „${k.name}“.`,
      sicherheit: 'orange',
      quelle: 'kategorie',
    }
  }

  return null
}

/**
 * Lernt aus einer abgeschlossenen Kontierung.
 *
 * Aufgerufen, wenn die Kontierungsstufe gestempelt wird -- in derselben
 * Transaktion, nach dem Summenzwang: Ein Muster aus einer Kontierung, die
 * nie abgeschlossen wurde, waere gelernter Irrtum. Scheitert der Stempel,
 * rollt das Lernen mit zurueck.
 *
 * **Bestaetigen zaehlt hoch, Abweichen setzt neu.** Kontiert jemand denselben
 * Kreditor beim selben Objekt auf ein anderes Konto, wird das Muster auf das
 * neue Konto gesetzt und die Trefferzahl beginnt bei eins -- die alte
 * Gewohnheit ist damit sichtbar nicht mehr gruen. Die Historie liegt in den
 * Kontierungen selbst; das Muster ist nur die Verdichtung.
 *
 * `where not exists` statt `on conflict`: Der eindeutige Index enthaelt
 * `objekt_id`, und `null` ist von `null` verschieden (dieselbe Falle wie bei
 * den Presets).
 */
export async function musterLernen(c: PoolClient, dokumentId: string): Promise<void> {
  const { rows: zeilen } = await c.query<{
    mandant_id: string
    kreditor_id: string | null
    objekt_id: string | null
    ordnungsgruppe_id: string | null
    konto_id: string
    umlageschluessel_id: string | null
    umlagefaehig: boolean
    anzahl: number
  }>(
    `select d.mandant_id, f.kreditor_id, d.objekt_id, d.ordnungsgruppe_id,
            k.konto_id, k.umlageschluessel_id, k.umlagefaehig,
            (select count(*)::int from kontierung x where x.dokument_id = d.id) as anzahl
       from dokument d
       join rechnung_fakten f on f.dokument_id = d.id
       join kontierung k on k.dokument_id = d.id
      where d.id = $1
      order by k.zeile_nr
      limit 1`,
    [dokumentId],
  )
  const z = zeilen[0]
  // Kein Kreditor: nichts, woran sich ein Muster festmachen liesse.
  // Mehr als eine Zeile: ein Split -- eine Entscheidung je Beleg, keine Regel.
  if (z === undefined || z.kreditor_id === null || z.anzahl !== 1) return

  const { rowCount } = await c.query(
    `update kontierungs_muster
        set trefferzahl = case when konto_id = $5 then trefferzahl + 1 else 1 end,
            konto_id = $5,
            umlageschluessel_id = $6,
            umlagefaehig = $7,
            ordnungsgruppe_id = $8,
            letzte_bestaetigung = now(),
            aktiv = true
      where mandant_id = $1
        and kreditor_id = $2
        and objekt_id is not distinct from $3
        and positionstext_normalisiert = $4`,
    [
      z.mandant_id,
      z.kreditor_id,
      z.objekt_id,
      GESAMT,
      z.konto_id,
      z.umlageschluessel_id,
      z.umlagefaehig,
      z.ordnungsgruppe_id,
    ],
  )
  if (rowCount !== 0) return

  await c.query(
    `insert into kontierungs_muster (mandant_id, kreditor_id, objekt_id,
                                     positionstext_normalisiert, konto_id,
                                     umlageschluessel_id, umlagefaehig,
                                     ordnungsgruppe_id, trefferzahl, letzte_bestaetigung)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 1, now())`,
    [
      z.mandant_id,
      z.kreditor_id,
      z.objekt_id,
      GESAMT,
      z.konto_id,
      z.umlageschluessel_id,
      z.umlagefaehig,
      z.ordnungsgruppe_id,
    ],
  )
}
