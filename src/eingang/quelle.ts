/**
 * Was eine Eingangsquelle ist.
 *
 * Konzept 13 nennt drei Wege herein — Postfach, Scan, Upload. Upload und Scan
 * beginnen bei einem Menschen, der etwas anfasst. Die beiden hier laufen von
 * selbst, und daraus folgt alles Weitere:
 *
 *   * **Niemand sieht zu.** Was schiefgeht, muss aufgeschrieben werden, sonst
 *     merkt es erst der, dem eine Rechnung fehlt — und dann ist die Mahnung
 *     schon da.
 *   * **Zweimal holen ist der Normalfall**, nicht die Ausnahme. Eine Mail
 *     bleibt im Postfach liegen, eine Datei im Ordner. Ohne Merkliste füllt
 *     sich der Posteingang mit Dubletten.
 *   * **Die Quelle entscheidet nichts.** Sie liefert Bytes und eine
 *     Herkunftskennung. Ob daraus ein Beleg wird, was für einer und wohin er
 *     gehört, bestimmt der Ingest — es gibt einen Weg herein, nicht drei.
 */

/** Ein Fundstück: eine Datei, die ein Beleg werden könnte. */
export interface Fundstueck {
  /**
   * Eindeutig **innerhalb der Quelle** und über Durchgänge hinweg stabil.
   *
   * Ordner: Pfad plus Änderungszeit. Postfach: `Message-Id` plus Name des
   * Anhangs. Wird in `eingang_geholt` vermerkt; eine Kennung, die sich bei
   * jedem Durchgang ändert, macht die Merkliste wertlos.
   */
  herkunft: string
  dateiname: string
  mime: string
  inhalt: Buffer
  /** Für die Anzeige und das Protokoll — nie für eine Entscheidung. */
  hinweis?: string
}

export interface Quelleneinstellungen {
  [feld: string]: unknown
}

export interface Eingangsquelle {
  readonly art: 'ordner' | 'mail'

  /**
   * Was seit dem letzten Durchgang dazugekommen ist.
   *
   * `bereitsGeholt` beantwortet, ob eine Herkunft schon einmal da war — die
   * Quelle fragt selbst, statt alles zu liefern und den Aufrufer aussieben
   * zu lassen. Bei einem Postfach mit dreitausend Mails ist das der
   * Unterschied zwischen einem Durchgang und einem Vormittag.
   */
  holen(
    einstellungen: Quelleneinstellungen,
    bereitsGeholt: (herkunft: string) => Promise<boolean>,
  ): Promise<Fundstueck[]>

  /**
   * Nach erfolgreicher Aufnahme aufräumen — verschieben, markieren, löschen.
   *
   * Getrennt vom Holen und **nach** dem Aufnehmen, nie davor: Wer zuerst
   * verschiebt und dann aufnimmt, verliert die Datei, wenn die Aufnahme
   * scheitert.
   */
  erledigen?(einstellungen: Quelleneinstellungen, stueck: Fundstueck): Promise<void>
}

export class QuelleAbgelehnt extends Error {}

/** Pflichtfeld aus den Einstellungen, mit verständlicher Meldung. */
export function pflichtfeld(
  einstellungen: Quelleneinstellungen,
  name: string,
): string {
  const wert = einstellungen[name]
  if (typeof wert !== 'string' || wert.trim() === '') {
    throw new QuelleAbgelehnt(`Die Einstellung „${name}" fehlt.`)
  }
  return wert.trim()
}

export function zahlenfeld(
  einstellungen: Quelleneinstellungen,
  name: string,
  vorgabe: number,
): number {
  const wert = einstellungen[name]
  if (wert === undefined || wert === null || wert === '') return vorgabe
  const zahl = Number(wert)
  if (!Number.isFinite(zahl)) {
    throw new QuelleAbgelehnt(`Die Einstellung „${name}" ist keine Zahl.`)
  }
  return zahl
}

/**
 * Ein Geheimnis aus der Umgebung — nie aus der Datenbank.
 *
 * In `eingangsquelle.einstellungen` steht der **Name** der Variablen. Ein
 * Datenbankauszug gibt damit keinen Postfachzugang her, und wer die Quelle in
 * der Oberfläche einrichtet, sieht nie ein Passwort, das er weiterreichen
 * könnte.
 */
export function geheimnis(
  einstellungen: Quelleneinstellungen,
  feld = 'passwort_variable',
): string {
  const name = pflichtfeld(einstellungen, feld)
  const wert = process.env[name]
  if (wert === undefined || wert === '') {
    throw new QuelleAbgelehnt(
      `Die Umgebungsvariable „${name}" ist auf diesem Rechner nicht gesetzt.`,
    )
  }
  return wert
}
