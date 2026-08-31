/**
 * Die Zahlungswege.
 *
 * Konzept 12: „scan2bank und SFirm sind Zeilen in `zahlungsweg`, kein
 * Sonderfall im Code — kommt ein dritter Weg dazu, wird er in den
 * Einstellungen angelegt und am Objekt hinterlegt."
 *
 * Wörtlich genommen heißt das: Hier steht **keine** Fallunterscheidung nach
 * Namen, sondern nach `art`. Ein neuer Weg derselben Art kostet eine Zeile in
 * den Stammdaten; eine neue *Art* — und nur die — kostet Code.
 *
 * Der Rückgabewert `protokoll` ist kurz und technisch: Dateischlüssel,
 * Empfängeradresse, Name des Fremdsystems. Keine Beträge, keine IBAN, keine
 * Namen — die Zeile wird gelesen, ohne dass jemand den Beleg sehen darf.
 */

import type { Ablage } from '../ablage'

export class UebergabeNichtMoeglich extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'UebergabeNichtMoeglich'
  }
}

/** Was der Weg braucht, um übergeben zu können. */
export interface Zahlungsauftrag {
  dokumentId: string
  storagePraefix: string
  empfaenger: string
  iban: string | null
  betrag: number
  verwendungszweck: string
  faelligAm: string | null
  /** Das Ziel aus dem Stammdatum: Mailadresse, Exportpfad, Systemname. */
  ziel: string | null
  wegname: string
}

export interface Zahlungsweg {
  /** Kurzer, technischer Vermerk für `zahlung.protokoll`. */
  uebergeben(auftrag: Zahlungsauftrag): Promise<string>
}

const euro = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, useGrouping: false })

/**
 * Der Zahlungssatz als eine Zeile.
 *
 * Semikolon und CRLF, weil die Datei in Excel geöffnet wird, bevor sie
 * irgendwo hochgeladen wird — das ist der Weg, den solche Dateien tatsächlich
 * nehmen. Felder werden gequotet, sonst zerlegt ein Semikolon im
 * Verwendungszweck die Zeile.
 */
export function exportzeile(auftrag: Zahlungsauftrag): string {
  // Über String(), nicht nur `?? ''`: Ein Datum kommt aus der Datenbank als
  // Date-Objekt zurück, und `.replace` gibt es darauf nicht. Der Test hat es
  // gefunden, der Typ nicht -- pg liefert `any`.
  const feld = (wert: unknown): string => `"${String(wert ?? '').replace(/"/g, '""')}"`
  return [
    feld(auftrag.empfaenger),
    feld(auftrag.iban),
    feld(euro.format(auftrag.betrag).replace('.', ',')),
    feld(auftrag.verwendungszweck),
    feld(auftrag.faelligAm),
  ].join(';')
}

export const EXPORT_KOPF = 'Empfaenger;IBAN;Betrag;Verwendungszweck;Faellig'

/**
 * Dateiexport: Der Zahlungssatz wird als Datei abgelegt.
 *
 * Die Datei liegt beim Beleg, nicht in einem gemeinsamen Ausgangsordner: So
 * ist auch Jahre später nachvollziehbar, was zu diesem Beleg übergeben wurde,
 * ohne dass jemand einen Sammelexport durchsuchen muss.
 */
export class Dateiexport implements Zahlungsweg {
  constructor(private readonly ablage: Ablage) {}

  async uebergeben(auftrag: Zahlungsauftrag): Promise<string> {
    const inhalt = `${EXPORT_KOPF}\r\n${exportzeile(auftrag)}\r\n`
    const schluessel = `${auftrag.storagePraefix}/zahlung/${auftrag.dokumentId}.csv`
    await this.ablage.schreiben(schluessel, Buffer.from(inhalt, 'utf8'))
    return `Datei ${schluessel}`
  }
}

/**
 * Extern (im Bestand: SFirm).
 *
 * Es gibt nichts zu senden — die Zahlung läuft in einem anderen System, und
 * das DMS hält nur fest, dass sie dorthin übergeben wurde. Genau deshalb ist
 * bei diesem Weg `archiviert_sofort` gesetzt: Auf eine Rückmeldung wird nicht
 * gewartet, weil keine kommt.
 */
export class ExternerWeg implements Zahlungsweg {
  async uebergeben(auftrag: Zahlungsauftrag): Promise<string> {
    return `extern an ${auftrag.ziel ?? auftrag.wegname}`
  }
}

/**
 * Versand per Mail (im Bestand: scan2bank).
 *
 * **Der Weg sendet nicht selbst.** Er legt den Zahlungsauftrag ab und einen
 * Eintrag ins Ausgangsbuch; gesendet wird später im Worker.
 *
 * Das kehrt eine frühere Entscheidung um, und zwar bewusst. Vorher stand
 * hier: lieber gar nicht übergeben, als eine Zahlung als übergeben zu
 * vermerken, die nie jemanden erreicht — sonst verschwindet der Beleg aus
 * allen Listen. Der zweite Halbsatz war das eigentliche Argument, und er
 * gilt nicht mehr: Mit dem Ausgangsbuch steht ein fehlgeschlagener Versand
 * sichtbar da, mit Grund und Anzahl der Versuche.
 *
 * Dafür verschwindet ein anderes Problem: Ein hängender Mailserver blockiert
 * keinen Stempel mehr.
 */
export interface Postablage {
  /** Legt einen Ausgang an — in derselben Transaktion wie die Zahlung. */
  anlegen(eingabe: {
    schluessel: string
    anlass: string
    empfaenger: string
    dokumentId: string
    werte: Record<string, string | undefined>
    anhang?: { schluessel: string; name: string } | null
  }): Promise<string>
}

export class MailWeg implements Zahlungsweg {
  constructor(
    private readonly ablage: Ablage,
    private readonly post: Postablage | null,
  ) {}

  async uebergeben(auftrag: Zahlungsauftrag): Promise<string> {
    if (this.post === null) {
      throw new UebergabeNichtMoeglich(
        `Der Zahlungsweg "${auftrag.wegname}" versendet per Mail, aber es ist ` +
          'kein Postausgang eingerichtet. Die Zahlung bleibt offen.',
      )
    }
    if (auftrag.ziel === null || auftrag.ziel === '') {
      throw new UebergabeNichtMoeglich(
        `Am Zahlungsweg "${auftrag.wegname}" fehlt die Empfängeradresse.`,
      )
    }

    // Der Zahlungssatz liegt beim Beleg, nicht in der Mail: Was gesendet
    // wurde, muss auch dann nachvollziehbar sein, wenn im Postfach der Bank
    // niemand mehr nachsieht.
    const inhalt = Buffer.from(`${EXPORT_KOPF}\r\n${exportzeile(auftrag)}\r\n`, 'utf8')
    const schluessel = `${auftrag.storagePraefix}/zahlung/${auftrag.dokumentId}.csv`
    await this.ablage.schreiben(schluessel, inhalt)

    await this.post.anlegen({
      schluessel: 'zahlungsauftrag',
      anlass: 'zahlung',
      empfaenger: auftrag.ziel,
      dokumentId: auftrag.dokumentId,
      werte: {
        kreditor: auftrag.empfaenger,
        rechnungsnummer: auftrag.verwendungszweck,
        betrag: `${euro.format(auftrag.betrag)} EUR`,
        faellig: auftrag.faelligAm ?? undefined,
      },
      anhang: { schluessel, name: `zahlung-${auftrag.dokumentId}.csv` },
    })

    return `Mail an ${auftrag.ziel} (im Ausgangsbuch)`
  }
}

/**
 * Wählt den Weg zur Art.
 *
 * `lastschrift` fehlt hier mit Absicht: Sie ist kein Weg, sondern eine
 * Eigenschaft des Kreditors oder Vertrags (Konzept 12). Die Stufe wird
 * übersprungen, bevor es hierher kommt — käme ein Beleg trotzdem an, wäre das
 * ein Fehler und keine Übergabe.
 */
/**
 * Kann dieser Weg überhaupt? Antwort ist der Grund, sonst `null`.
 *
 * Gefunden beim Bedienen: Ohne eingerichteten Versand warf `MailWeg` erst
 * beim Stempeln — der Anwender bekam einen Serverfehler statt einer
 * Begründung, und zwar nachdem er die Schaltfläche gedrückt hatte. Diese
 * Prüfung läuft vorher und steht auf dem Bildschirm.
 */
export function wegHindernis(
  art: string,
  wegname: string,
  mittel: { post: Postablage | null },
): string | null {
  if (art === 'mail' && mittel.post === null) {
    return (
      `Der Zahlungsweg "${wegname}" versendet per Mail, aber es ist kein ` +
      'Postausgang eingerichtet. Bis dahin lässt sich über diesen Weg nichts übergeben.'
    )
  }
  if (art === 'lastschrift') {
    return 'Lastschrift ist kein Zahlungsweg.'
  }
  return null
}

export function wegFuer(
  art: string,
  mittel: { ablage: Ablage; post: Postablage | null },
): Zahlungsweg {
  switch (art) {
    case 'datei_export':
      return new Dateiexport(mittel.ablage)
    case 'extern':
      return new ExternerWeg()
    case 'mail':
      return new MailWeg(mittel.ablage, mittel.post)
    case 'lastschrift':
      throw new UebergabeNichtMoeglich(
        'Lastschrift ist kein Zahlungsweg. Die Stufe wird übersprungen, ' +
          'die Fälligkeit wird vermerkt.',
      )
    default:
      throw new UebergabeNichtMoeglich(`Unbekannte Zahlungsweg-Art "${art}".`)
  }
}
