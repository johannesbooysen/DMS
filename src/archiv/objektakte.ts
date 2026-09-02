/**
 * Objektakte für den Verwalterwechsel.
 *
 * Konzept 19: „Das ist eine Funktion, kein Migrationsprojekt — vorausgesetzt,
 * sie steht von Anfang an im Schema."
 *
 * Genau darum steht sie jetzt hier und nicht später. Eine Übergabe, die erst
 * geschrieben wird, wenn sie gebraucht wird, wird unter Zeitdruck geschrieben
 * — von jemandem, der den Nachfolger nicht kennt und das Konzept nicht mehr
 * im Kopf hat.
 *
 * Erzeugt wird ein Verzeichnis je Objekt: Originaldateien, je Dokument eine
 * Metadatendatei, dazu ein Manifest mit Hashwerten. Wer die Akte übernimmt,
 * kann prüfen, dass sie vollständig und unverändert ist — ohne unser System.
 */

import { createHash } from 'node:crypto'
import { belegExportierenMit } from '@/export'
import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'

export interface Aktendokument {
  dokumentId: string
  dateiname: string
  metadaten: Record<string, unknown>
  inhalt: Buffer | null
  /**
   * Dieselbe Seite mit den Stempeln darauf (Konzept 16).
   *
   * **Der Grund, warum es das gibt:** Bis hierher bekam ein
   * Nachfolgeverwalter das rohe Original — ein Blatt ohne eine einzige
   * Freigabe. Die Stempelhistorie lag daneben im JSON, die Information war
   * also nicht weg; aber wer die Rechnung öffnet, sah nicht, dass sie
   * jemals geprüft wurde.
   *
   * Das Original bleibt trotzdem in der Akte: Nur es hat den Hash, der im
   * Archiv steht. Die gestempelte Fassung ist zum Lesen, das Original zum
   * Nachweisen.
   */
  gestempelt: Buffer | null
}

export interface Objektakte {
  objektnummer: string
  bezeichnung: string
  erzeugtAm: string
  dokumente: Aktendokument[]
  /** Belege, deren Originaldatei fehlt — benannt statt verschwiegen. */
  ohneDatei: string[]
  /**
   * Belege ohne gestempelte Lesefassung.
   *
   * Aus demselben Grund benannt wie `ohneDatei`: Eine Akte mit einer stillen
   * Luecke ist schlimmer als eine mit einer bekannten. Vorkommen kann es bei
   * einem geschwaerzten Beleg ohne Seitenbilder oder bei einer Datei, die
   * sich nicht als PDF lesen laesst.
   */
  ohneLesefassung: string[]
  manifest: string
}

/**
 * Ein Dokument mit allem, was zu ihm gehört.
 *
 * Bewusst als eine Abfrage je Dokument statt als ein großer Join: Die Akte
 * wird selten erzeugt, und ein Join über Kontierung und Stempelhistorie
 * multipliziert die Zeilen, bis niemand mehr sieht, was fehlt.
 */
async function dokumentSammeln(
  c: PoolClient,
  dokumentId: string,
): Promise<Record<string, unknown>> {
  const { rows: kopf } = await c.query<Record<string, unknown>>(
    /*
     * Alle Datumsfelder als Text und nicht als `date`.
     *
     * pg macht aus einem `date` ein Date-Objekt in der Zeitzone des Servers.
     * In der Akte stuende dann `2026-03-13T23:00:00Z` fuer den 14. Maerz --
     * ein Rechnungsdatum, das je nach Zeitzone einen Tag danebenliegt. In
     * einer Uebergabe an den Nachfolger ist das kein Schoenheitsfehler.
     */
    `select d.id, d.belegart, d.eingangskanal,
            to_json(d.eingang_am)#>>'{}' as eingang_am,
            d.status, d.inhalt_hash, d.seitenzahl,
            og.name as ordnungsgruppe, sg.name as spezialgebiet,
            f.rechnungsnummer,
            to_char(f.rechnungsdatum, 'YYYY-MM-DD') as rechnungsdatum,
            f.netto, f.steuer, f.brutto,
            to_char(f.leistung_von, 'YYYY-MM-DD') as leistung_von,
            to_char(f.leistung_bis, 'YYYY-MM-DD') as leistung_bis,
            f.wirtschaftsjahr,
            k.name as kreditor,
            to_char(a.archiviert_am, 'YYYY-MM-DD') as archiviert_am,
            to_char(a.aufbewahrung_bis, 'YYYY-MM-DD') as aufbewahrung_bis,
            a.aufbewahrungsgrund, a.hash_sha256
       from dokument d
       left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
       left join spezialgebiet sg on sg.id = d.spezialgebiet_id
       left join rechnung_fakten f on f.dokument_id = d.id
       left join kreditor k on k.id = f.kreditor_id
       left join archiv_eintrag a on a.dokument_id = d.id
      where d.id = $1`,
    [dokumentId],
  )

  const { rows: kontierung } = await c.query<Record<string, unknown>>(
    `select kt.zeile_nr, ko.kontonummer, ko.bezeichnung, kt.betrag_netto,
            kt.steuersatz, kt.betrag_brutto, kt.umlagefaehig,
            u.name as umlageschluessel, kt.ruecklage_entnahme
       from kontierung kt
       join konto ko on ko.id = kt.konto_id
       left join umlageschluessel u on u.id = kt.umlageschluessel_id
      where kt.dokument_id = $1
      order by kt.zeile_nr`,
    [dokumentId],
  )

  const { rows: stempel } = await c.query<Record<string, unknown>>(
    `select e.folge,
            to_json(e.zeitpunkt)#>>'{}' as zeitpunkt,
            e.entscheidung, e.kommentar,
            s.bezeichnung as stufe, st.name as stempel,
            b.name as benutzer, e.eintrag_hash
       from stempel_ereignis e
       join dokument_lauf l on l.id = e.lauf_id
       left join prozessstufe s on s.id = e.stufe_id
       left join stempeltyp st on st.id = e.stempeltyp_id
       left join benutzer b on b.id = e.benutzer_id
      where l.dokument_id = $1
      order by e.folge`,
    [dokumentId],
  )

  const { rows: zahlungen } = await c.query<Record<string, unknown>>(
    `select art, betrag, status,
            to_char(faellig_am, 'YYYY-MM-DD') as faellig_am,
            to_json(uebergeben_am)#>>'{}' as uebergeben_am,
            protokoll
       from zahlung where dokument_id = $1 order by erstellt_am`,
    [dokumentId],
  )

  return {
    beleg: kopf[0] ?? null,
    kontierung,
    // Die Stempelhistorie samt Hashkette: Ohne sie ist die Akte eine
    // Sammlung von Dateien, mit ihr ein Nachweis.
    stempelhistorie: stempel,
    zahlungen,
  }
}

/**
 * Stellt die Akte eines Objekts zusammen.
 *
 * Läuft unter der RLS des Aufrufenden — wer das Objekt nicht sehen darf,
 * bekommt eine leere Akte und keinen Fehler. Das ist richtig: Eine
 * Fehlermeldung „Objekt existiert, Sie dürfen aber nicht" wäre bereits eine
 * Auskunft.
 */
export async function objektakteZusammenstellen(
  c: PoolClient,
  ablage: Ablage,
  objektId: string,
  jetzt: string,
): Promise<Objektakte | null> {
  const { rows: objekte } = await c.query<{ objektnummer: string; bezeichnung: string }>(
    'select objektnummer, bezeichnung from objekt where id = $1',
    [objektId],
  )
  const objekt = objekte[0]
  if (objekt === undefined) return null

  const { rows: belege } = await c.query<{
    id: string
    storage_key: string | null
    storage_fassung: string | null
  }>(
    `select d.id,
            (select f.storage_key from dokument_datei f
              where f.dokument_id = d.id and f.variante = 'original' limit 1)
              as storage_key,
            -- Die archivierte Fassung. Hier faellt eine untergeschobene
            -- Datei am laengsten nicht auf: Die Akte geht an den Nachfolger,
            -- und der hat keinen Vergleich.
            (select a.storage_fassung from archiv_eintrag a
              where a.dokument_id = d.id) as storage_fassung
       from dokument d
      where d.objekt_id = $1
      order by d.eingang_am`,
    [objektId],
  )

  const dokumente: Aktendokument[] = []
  const ohneDatei: string[] = []
  const ohneLesefassung: string[] = []
  const manifestzeilen: string[] = []

  for (const b of belege) {
    const metadaten = await dokumentSammeln(c, b.id)

    let inhalt: Buffer | null = null
    if (b.storage_key !== null) {
      try {
        inhalt = await ablage.lesen(b.storage_key, b.storage_fassung)
      } catch {
        // Die Datei fehlt in der Ablage. Sie wird benannt, nicht verschwiegen
        // -- eine Akte mit einer stillen Luecke ist schlimmer als eine mit
        // einer bekannten.
        inhalt = null
      }
    }
    if (inhalt === null) ohneDatei.push(b.id)

    const dateiname = `${b.id}.pdf`
    const metadatenText = JSON.stringify(metadaten, null, 2)

    /*
     * Die gestempelte Fassung daneben.
     *
     * Scheitert sie, ist das kein Grund, die Akte abzubrechen -- etwa bei
     * einem geschwaerzten Beleg ohne Seitenbilder. Dann fehlt eben die
     * Lesefassung; das Original und die Stempelhistorie im JSON sind
     * trotzdem da.
     */
    let gestempelt: Buffer | null = null
    if (inhalt !== null) {
      gestempelt = await belegExportierenMit(c, ablage, {
        dokumentId: b.id,
        variante: 'stempel',
      })
        .then((e) => e.pdf)
        .catch(() => null)
      if (gestempelt === null) ohneLesefassung.push(b.id)
    }

    dokumente.push({
      dokumentId: b.id,
      dateiname,
      metadaten,
      inhalt,
      gestempelt,
    })

    if (inhalt !== null) {
      manifestzeilen.push(
        `${createHash('sha256').update(inhalt).digest('hex')}  ${dateiname}`,
      )
    }
    if (gestempelt !== null) {
      manifestzeilen.push(
        `${createHash('sha256').update(gestempelt).digest('hex')}  ${b.id}-gestempelt.pdf`,
      )
    }
    manifestzeilen.push(
      `${createHash('sha256').update(metadatenText, 'utf8').digest('hex')}  ${b.id}.json`,
    )
  }

  const kopf = [
    `# Objektakte ${objekt.objektnummer} — ${objekt.bezeichnung}`,
    `# erzeugt am ${jetzt}`,
    `# ${dokumente.length} Dokumente, ${ohneDatei.length} ohne Originaldatei,` +
      ` ${ohneLesefassung.length} ohne gestempelte Lesefassung`,
    '# Zu jedem Beleg: <id>.pdf (das Original, mit dem Hash aus dem Archiv),',
    '# <id>-gestempelt.pdf (dasselbe mit den Stempeln darauf) und <id>.json.',
    '#',
    // Keine Leerzeile danach: "sha256sum -c" warnt bei leeren Zeilen, und
    // eine Warnung beim Pruefen entwertet den Zweck des Manifests.
    '# Pruefen mit: sha256sum -c manifest.txt',
  ]

  return {
    objektnummer: objekt.objektnummer,
    bezeichnung: objekt.bezeichnung,
    erzeugtAm: jetzt,
    dokumente,
    ohneDatei,
    ohneLesefassung,
    manifest: [...kopf, ...manifestzeilen, ''].join('\n'),
  }
}

/**
 * Schreibt die Akte in die Ablage.
 *
 * Getrennt vom Zusammenstellen, damit dasselbe Ergebnis auch anders
 * ausgeliefert werden kann — als ZIP, über einen anderen Speicher, oder gar
 * nicht, wenn nur geprüft werden soll, was drin wäre.
 */
export async function objektakteSchreiben(
  ablage: Ablage,
  akte: Objektakte,
  praefix: string,
): Promise<string[]> {
  const geschrieben: string[] = []

  for (const d of akte.dokumente) {
    if (d.inhalt !== null) {
      const schluessel = `${praefix}/${d.dateiname}`
      await ablage.schreiben(schluessel, d.inhalt)
      geschrieben.push(schluessel)
    }
    if (d.gestempelt !== null) {
      // Die Lesefassung neben dem Original -- gleicher Name, klarer Zusatz.
      const schluessel = `${praefix}/${d.dokumentId}-gestempelt.pdf`
      await ablage.schreiben(schluessel, d.gestempelt)
      geschrieben.push(schluessel)
    }
    const metaSchluessel = `${praefix}/${d.dokumentId}.json`
    await ablage.schreiben(
      metaSchluessel,
      Buffer.from(JSON.stringify(d.metadaten, null, 2), 'utf8'),
    )
    geschrieben.push(metaSchluessel)
  }

  const manifest = `${praefix}/manifest.txt`
  await ablage.schreiben(manifest, Buffer.from(akte.manifest, 'utf8'))
  geschrieben.push(manifest)

  return geschrieben
}
