/**
 * Aufbereitung eines eingegangenen Dokuments.
 *
 * Reihenfolge nach Konzept 13:
 *   Formaterkennung (ZUGFeRD/XRechnung -> XML-Pfad, kein OCR)
 *   -> Textlayer vorhanden? pdfjs : ocrmypdf
 *   -> dokument_seite (Text)
 *   -> WebP-Derivate (Trefferliste und Lesegroesse)
 *   -> Extraktion, Lernspeicher, Ampel
 *
 * Die letzten drei Schritte folgen spaeter. Was noch nicht da ist, steht
 * unten als benannter offener Punkt.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'
import { extrahierenUndUebernehmen, type Extraktionsbericht } from '../extraktion'
import { istXmlRechnung } from '../extraktion/zugferd'
import { objektVorschlagen, type Zuordnungsvorschlag } from '../lernen/zuordnung'
import { plausibilitaetPruefen, type Pruefergebnis } from '../pruefung/plausibilitaet'
import { hatTextlayer, seitenLesen, seiteRendern } from '../ingest/pdf'

/** Breite der Vorschau in der Trefferliste. */
export const BREITE_MINIATUR = 240
/** Breite der Leseansicht. Das PDF selbst wird erst beim Zoomen geholt. */
export const BREITE_LESEN = 1240

export type Verarbeitungsweg = 'zugferd' | 'textlayer' | 'ocr_noetig' | 'kein_pdf'

export interface Aufbereitungsergebnis {
  seiten: number
  weg: Verarbeitungsweg
  erkennung?: Extraktionsbericht
  pruefung?: Pruefergebnis
  zuordnung?: Zuordnungsvorschlag
}

/*
 * Frueher stand hier `istStrukturierteRechnung`, das im PDF nach der
 * Zeichenkette "factur-x.xml" suchte. Das war unzuverlaessig: Ein PDF legt
 * Dateinamen komprimiert ab, die Zeichenkette steht dort gar nicht im
 * Klartext. Ein Test hat es aufgedeckt -- eine echte ZUGFeRD-Rechnung galt
 * als gewoehnliches PDF.
 *
 * Zustaendig ist jetzt der Anbieter selbst: `istXmlRechnung` fuer die reine
 * XRechnung, und fuer PDFs liest die Erkennung die Anhaenge richtig aus.
 * Der Verarbeitungsweg ergibt sich damit aus dem Ergebnis der Erkennung,
 * nicht aus einer Vermutung ueber die Bytes.
 */

export async function aufbereiten(
  c: PoolClient,
  ablage: Ablage,
  dokumentId: string,
): Promise<Aufbereitungsergebnis> {
  const { rows } = await c.query<{ storage_praefix: string; storage_key: string | null }>(
    `select d.storage_praefix,
            (select f.storage_key from dokument_datei f
              where f.dokument_id = d.id and f.variante = 'original'
              limit 1) as storage_key
       from dokument d
      where d.id = $1`,
    [dokumentId],
  )

  if (rows.length === 0 || rows[0].storage_key === null) {
    // Kein Fehler: das Dokument kann storniert worden sein, oder die RLS
    // blendet es aus. Beides ist kein Grund, den Auftrag zu wiederholen.
    return { seiten: 0, weg: 'kein_pdf' }
  }

  const praefix = rows[0].storage_praefix
  const inhalt = await ablage.lesen(rows[0].storage_key)

  if (inhalt.subarray(0, 4).toString('latin1') !== '%PDF') {
    // XRechnung ohne PDF-Huelle: nichts zu rendern, das XML fuehrt.
    const weg: Verarbeitungsweg = istXmlRechnung(inhalt) ? 'zugferd' : 'kein_pdf'
    await c.query(`update dokument set seitenzahl = 0, status = 'laufend' where id = $1`, [
      dokumentId,
    ])
    return { seiten: 0, weg }
  }

  const seiten = await seitenLesen(inhalt)

  // Die Fundstellen der einzelnen Textstuecke bleiben vorerst im Speicher.
  // Persistiert werden sie erst, wenn die Stempelplatzierung sie braucht --
  // sie sucht den groessten freien Block auf der Seite (Konzept 16). Bis
  // dahin waere eine Spalte dafuer eine Vorfestlegung ohne Nutzer.
  for (const seite of seiten) {
    await c.query(
      `insert into dokument_seite (dokument_id, seite, text, breite, hoehe)
       values ($1, $2, $3, $4, $5)
       on conflict (dokument_id, seite) do update
          set text = excluded.text, breite = excluded.breite, hoehe = excluded.hoehe`,
      [dokumentId, seite.seite, seite.text, seite.breite, seite.hoehe],
    )
  }

  // Vorrendern beim Eingang, nicht bei der Anzeige -- das ist der Grund,
  // warum der Viewer schnell ist (Konzept 1).
  for (const seite of seiten) {
    const bild = await seiteRendern(inhalt, seite.seite, BREITE_LESEN)
    const schluessel = `${praefix}/ansicht/${seite.seite}-lesen.webp`
    await ablage.schreiben(schluessel, bild)
    await c.query(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse, seite)
       values ($1, 'ansicht_webp', $2, 'image/webp', $3, $4)`,
      [dokumentId, schluessel, bild.byteLength, seite.seite],
    )
  }

  if (seiten.length > 0) {
    const miniatur = await seiteRendern(inhalt, 1, BREITE_MINIATUR)
    const schluessel = `${praefix}/ansicht/1-miniatur.webp`
    await ablage.schreiben(schluessel, miniatur)
    await c.query(
      `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse, seite)
       values ($1, 'ansicht_webp', $2, 'image/webp', $3, 1)`,
      [dokumentId, schluessel, miniatur.byteLength],
    )
  }

  await c.query(`update dokument set seitenzahl = $2, status = 'laufend' where id = $1`, [
    dokumentId,
    seiten.length,
  ])

  // Erkennung. Der strukturierte Weg geht vor; ohne eingebettetes XML
  // entscheidet die Einstellung, ob ein Modell befragt wird (Konzept 13).
  const { rows: gruppen } = await c.query<{ ki_beschreibung: string | null }>(
    `select og.ki_beschreibung from dokument d
       left join ordnungsgruppe og on og.id = d.ordnungsgruppe_id
      where d.id = $1`,
    [dokumentId],
  )

  const erkennung = await extrahierenUndUebernehmen(c, {
    dokumentId,
    inhalt,
    seiten: seiten.map((s) => ({ seite: s.seite, text: s.text })),
    kiBeschreibung: gruppen[0]?.ki_beschreibung ?? null,
  })

  // Der Weg ergibt sich aus dem Ergebnis der Erkennung: Wer sein XML
  // mitbringt, ist eine strukturierte Rechnung -- unabhaengig davon, wie das
  // PDF innen aussieht.
  const weg: Verarbeitungsweg =
    erkennung.quelle === 'zugferd'
      ? 'zugferd'
      : hatTextlayer(seiten)
        ? 'textlayer'
        : 'ocr_noetig'

  // Zuordnung aus gelernten Merkmalen -- nur, wenn der Beleg noch kein
  // Objekt hat. Eine vorhandene Zuordnung wird nicht ueberschrieben: Wer
  // den Beleg eingeliefert hat, wusste womoeglich mehr als der Lernspeicher.
  const { rows: ohneObjekt } = await c.query<{ objekt_id: string | null }>(
    'select objekt_id from dokument where id = $1',
    [dokumentId],
  )
  let zuordnung: Zuordnungsvorschlag | undefined
  if (ohneObjekt[0]?.objekt_id == null) {
    zuordnung = await objektVorschlagen(c, dokumentId)
    if (zuordnung.sicherheit === 'gruen' && zuordnung.objektId !== null) {
      await c.query('select app.dokument_zuordnen($1, $2)', [
        dokumentId,
        zuordnung.objektId,
      ])
    }
  }

  // Plausibilitaet: der zweite Vertrauenswert. Er beantwortet eine andere
  // Frage als die Extraktion -- nicht wie sicher gelesen wurde, sondern ob
  // das Gelesene fachlich Sinn ergibt (Konzept 14).
  const pruefung = await plausibilitaetPruefen(c, dokumentId)

  // OFFEN, in dieser Reihenfolge:
  //   * weg = 'ocr_noetig' -> ocrmypdf aufrufen und den Seitentext ersetzen.
  //     Braucht Python, Tesseract mit deutschem Sprachpaket und Ghostscript.
  //   * Lernspeicher: Objekt- und Kontierungsvorschlag (Konzept 15)
  //   * Wirtschaftsjahr offen und Budgetgrenze -- beides braucht Daten, die
  //     es noch nicht gibt (Jahresabschluss, verbrauchtes Budget)

  return { seiten: seiten.length, weg, erkennung, pruefung, zuordnung }
}
