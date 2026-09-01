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
 * Die Reihenfolge ist keine Formsache: Der Seitentext traegt Suche,
 * Extraktion und Zuordnung. Deshalb faellt die OCR-Entscheidung ganz oben
 * und nicht am Ende -- wer den Text nachtraeglich ersetzt, muss alles
 * dahinter noch einmal rechnen.
 *
 * Was noch fehlt, steht unten als benannter offener Punkt.
 */

import type { PoolClient } from 'pg'
import type { Ablage } from '../ablage'
import { extrahierenUndUebernehmen, type Extraktionsbericht } from '../extraktion'
import { istXmlRechnung } from '../extraktion/zugferd'
import { objektVorschlagen, type Zuordnungsvorschlag } from '../lernen/zuordnung'
import { plausibilitaetPruefen, type Pruefergebnis } from '../pruefung/plausibilitaet'
import { hatTextlayer, seitenLesen, seiteRendern, type Seiteninhalt } from '../ingest/pdf'
import { mailtext } from '../eingang/mail'
import { freieBloecke } from '../layer/platzierung'
import { texterkennung, type Texterkennung } from '../ocr'
import { AUFBEREITUNG } from '../queue'

/** Breite der Vorschau in der Trefferliste. */
export const BREITE_MINIATUR = 240
/** Breite der Leseansicht. Das PDF selbst wird erst beim Zoomen geholt. */
export const BREITE_LESEN = 1240

/**
 * Wie der Text gewonnen wurde.
 *
 * `ocr` und `ocr_noetig` sind der Unterschied zwischen getan und liegen
 * geblieben -- vorher gab es nur den zweiten Wert, und er hiess in beiden
 * Faellen dasselbe.
 */
export type Verarbeitungsweg =
  | 'zugferd'
  | 'textlayer'
  | 'ocr'
  | 'ocr_noetig'
  | 'mail'
  | 'kein_pdf'

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

/**
 * Texterkennung anwenden — oder den Beleg sichtbar liegen lassen.
 *
 * Drei Ausgänge, und die Unterscheidung ist der Kern der Sache:
 *
 *   * **Keine Erkennung eingerichtet.** Kein Fehler, den man wiederholen
 *     könnte — Tesseract installiert sich nicht durch einen zweiten Versuch.
 *     Deshalb wird hier *gemeldet* statt geworfen: Der Beleg steht im
 *     Fehlerkorb, und ein Mensch entscheidet („von Hand" oder warten).
 *   * **Eingerichtet, aber gescheitert.** Das kann vorübergehend sein
 *     (Speicher, kaputte Seite). Also geworfen — die Warteschlange versucht
 *     es dreimal und legt es danach selbst in den Korb, mit dem echten Grund.
 *   * **Gelaufen.** Das Ergebnis wird als `pdfa_derivat` abgelegt. Das
 *     Original bleibt unberührt (Projektregel); ocrmypdf schreibt PDF/A, das
 *     Derivat aus Konzept 19 entsteht also im selben Durchlauf.
 *
 * Rückgabe `null` heißt: kein Text gewonnen, weiter mit dem, was da ist.
 */
async function texterkennungAnwenden(
  c: PoolClient,
  ablage: Ablage,
  dokumentId: string,
  praefix: string,
  original: Buffer,
  texterkenner: Texterkennung | null,
): Promise<Seiteninhalt[] | null> {
  if (texterkenner === null || !(await texterkenner.verfuegbar())) {
    const grund =
      texterkenner === null
        ? 'Kein Textlayer, und es ist keine Texterkennung eingerichtet (DMS_OCR).'
        : `Kein Textlayer, und ${texterkenner.name} ist auf diesem Rechner nicht aufrufbar.`

    // Direkt auf der laufenden Verbindung, nicht ueber `fehlerMelden`: Der
    // Eintrag soll mit der Aufbereitung zusammen festgeschrieben werden.
    // Die Funktion ist `security definer` und braucht dafuer keine Rolle.
    await c.query('select app.verarbeitungsfehler_melden($1, null, $2, $3, 0, null)', [
      dokumentId,
      AUFBEREITUNG,
      grund,
    ])
    return null
  }

  const ergebnis = await texterkenner.erkennen(original)

  const schluessel = `${praefix}/pdfa/original-ocr.pdf`
  await ablage.schreiben(schluessel, ergebnis.pdf)
  await c.query(
    `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
     values ($1, 'pdfa_derivat', $2, 'application/pdf', $3)`,
    [dokumentId, schluessel, ergebnis.pdf.byteLength],
  )

  return seitenLesen(ergebnis.pdf)
}

export async function aufbereiten(
  c: PoolClient,
  ablage: Ablage,
  dokumentId: string,
  /**
   * Welche Texterkennung. Vorgabe ist die eingestellte -- der Parameter ist
   * fuer Tests da, die keine Tesseract-Installation voraussetzen duerfen,
   * und fuer den Fall, dass einmal je Mandant etwas anderes gilt.
   */
  texterkenner: Texterkennung | null = texterkennung(),
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
    if (istXmlRechnung(inhalt)) {
      await c.query(`update dokument set seitenzahl = 0, status = 'laufend' where id = $1`, [
        dokumentId,
      ])
      return { seiten: 0, weg: 'zugferd' }
    }

    /*
     * Eine Mail ohne verwertbaren Anhang.
     *
     * Es gibt nichts zu rendern, aber sehr wohl etwas zu lesen: Betreff,
     * Absender und Text. Ohne diesen Zweig laege die Nachricht mit null
     * Seiten und leerem Text im Posteingang -- unauffindbar, obwohl jemand
     * geschrieben hat.
     *
     * Konzept 1: "Kein zweites Modul fuer Schriftverkehr; ein Posteingang."
     */
    if (istMail(inhalt)) {
      const text = await mailtext(inhalt)
      await c.query(
        `insert into dokument_seite (dokument_id, seite, text)
         values ($1, 1, $2)
         on conflict (dokument_id, seite) do update set text = excluded.text`,
        [dokumentId, text],
      )
      await c.query(`update dokument set seitenzahl = 1, status = 'laufend' where id = $1`, [
        dokumentId,
      ])
      return { seiten: 1, weg: 'mail' }
    }

    await c.query(`update dokument set seitenzahl = 0, status = 'laufend' where id = $1`, [
      dokumentId,
    ])
    return { seiten: 0, weg: 'kein_pdf' }
  }

  /*
   * Fruehere Derivate wegraeumen, bevor neue entstehen.
   *
   * Eine Aufbereitung kann ein zweites Mal laufen -- seit dem Fehlerkorb
   * sogar auf Knopfdruck. Ohne diese Zeile bekaeme das Dokument bei jedem
   * Durchlauf einen weiteren Satz `ansicht_webp`-Zeilen und ein weiteres
   * `pdfa_derivat`; `dokument_datei` hat darauf nur einen Index, keine
   * Eindeutigkeit. Der Viewer nimmt dann irgendeine der Zeilen.
   *
   * Die Dateien selbst bleiben unberuehrt: Ihre Schluessel sind aus Praefix
   * und Seitennummer gebildet und damit bei jedem Lauf dieselben -- es wird
   * ueberschrieben, nichts verwaist. Das Original steht nicht in dieser
   * Liste und wird nie angefasst.
   */
  await c.query(
    `delete from dokument_datei
      where dokument_id = $1 and variante in ('ansicht_webp','pdfa_derivat')`,
    [dokumentId],
  )

  /*
   * Texterkennung, falls noetig -- und **vor** allem Weiteren.
   *
   * Der Seitentext ist die Grundlage von Suche, Extraktion und Zuordnung.
   * Wer ihn nachtraeglich ersetzt, muss alles dahinter noch einmal rechnen.
   * Deshalb steht die Entscheidung hier oben, nicht am Ende.
   */
  let seiten = await seitenLesen(inhalt)
  let weg: Verarbeitungsweg = hatTextlayer(seiten) ? 'textlayer' : 'ocr_noetig'

  if (weg === 'ocr_noetig') {
    const erkannt = await texterkennungAnwenden(
      c, ablage, dokumentId, praefix, inhalt, texterkenner,
    )
    if (erkannt !== null) {
      seiten = erkannt
      weg = 'ocr'
    }
  }

  /*
   * Seitentext -- und fuer die erste Seite die freien Stempelplaetze.
   *
   * Die Fundstellen der einzelnen Textstuecke werden **nicht** gespeichert,
   * sondern nur das, was aus ihnen folgt: eine Handvoll Rechtecke, in die
   * ein Stempel passt, ohne Text zu ueberdecken (Konzept 16). Die
   * Fundstellen selbst waeren bei einer Million Dokumenten zweistellige
   * Gigabytes -- und sie werden nach dieser Rechnung nie wieder gebraucht.
   *
   * Nur Seite 1, weil der Stempel dorthin gehoert. Reicht der Platz nicht,
   * haengt der Export eine Leerseite an.
   */
  for (const seite of seiten) {
    const bloecke =
      seite.seite === 1
        ? JSON.stringify(freieBloecke(seite.breite, seite.hoehe, seite.stuecke))
        : null

    await c.query(
      `insert into dokument_seite (dokument_id, seite, text, breite, hoehe, freie_bloecke)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (dokument_id, seite) do update
          set text = excluded.text, breite = excluded.breite,
              hoehe = excluded.hoehe, freie_bloecke = excluded.freie_bloecke`,
      [dokumentId, seite.seite, seite.text, seite.breite, seite.hoehe, bloecke],
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

  // Wer sein XML mitbringt, ist eine strukturierte Rechnung -- unabhaengig
  // davon, wie das PDF innen aussieht. Das schlaegt jeden anderen Weg.
  //
  // Frueher wurde `weg` erst hier bestimmt, mit `hatTextlayer(seiten)`. Das
  // geht nicht mehr: Nach einer erfolgreichen Erkennung haben die Seiten
  // Text, und der Weg hiesse `textlayer` -- als waere nie ein OCR gelaufen.
  if (erkennung.quelle === 'zugferd') weg = 'zugferd'

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
  //   * PDF/A fuer Belege, die *keinen* OCR-Lauf brauchen. Heute entsteht das
  //     Derivat nur als Nebenprodukt der Erkennung -- ein Beleg mit Textlayer
  //     bekommt keines (Konzept 19).
  //   * Lernspeicher: Objekt- und Kontierungsvorschlag (Konzept 15)
  //   * Wirtschaftsjahr offen und Budgetgrenze -- beides braucht Daten, die
  //     es noch nicht gibt (Jahresabschluss, verbrauchtes Budget)

  return { seiten: seiten.length, weg, erkennung, pruefung, zuordnung }
}

/**
 * Sieht das nach einer Mail aus?
 *
 * Absichtlich grob: ein paar Kopfzeilen am Anfang. Eine strenge Prüfung wäre
 * ein zweiter Parser, und der einzige Zweck hier ist, `mailparser` nicht auf
 * beliebige Bytes loszulassen. Was durchrutscht, ergibt leeren Text — kein
 * Schaden.
 */
function istMail(inhalt: Buffer): boolean {
  const anfang = inhalt.subarray(0, 2048).toString('latin1')
  return /^(from|received|message-id|subject|to|date|mime-version):/im.test(anfang)
}
