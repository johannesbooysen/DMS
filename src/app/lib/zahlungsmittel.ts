/**
 * Womit die Anwendung Zahlungen übergibt.
 *
 * Eine Stelle, damit Oberfläche und Stempelprüfung dasselbe wissen. Sonst
 * zeigt der Bildschirm „geht", und der Stempel sagt „geht nicht".
 *
 * Der Mailweg sendet nicht mehr selbst, sondern legt einen Eintrag ins
 * Ausgangsbuch — deshalb steht hier eine `Postablage` und kein `Versand`.
 * Gesendet wird im Worker; ein hängender Mailserver blockiert keinen Stempel.
 */

import type { PoolClient } from 'pg'
import { ABLAGE } from '@/app/lib/belege'
import { postAnlegen } from '@/postausgang'
import type { Postablage } from '@/zahlung'

/**
 * Bindet die Postablage an die laufende Transaktion.
 *
 * `c` ist Pflicht: Der Ausgangseintrag soll gemeinsam mit der Zahlung
 * festgeschrieben werden. Einen Zahlungsauftrag ohne Ausgangseintrag oder
 * einen Eintrag ohne Zahlung gibt es damit nicht.
 */
export function postablage(c: PoolClient): Postablage {
  return {
    anlegen: (eingabe) =>
      postAnlegen(c, {
        schluessel: eingabe.schluessel,
        anlass: eingabe.anlass,
        empfaenger: eingabe.empfaenger,
        dokumentId: eingabe.dokumentId,
        werte: eingabe.werte,
        anhang: eingabe.anhang ?? null,
      }),
  }
}

/**
 * Für die Ansicht: Gibt es überhaupt einen Weg nach draußen?
 *
 * Die Postablage selbst braucht eine Transaktion und steht deshalb nicht als
 * Konstante zur Verfügung. Für die Frage „kann dieser Weg?" genügt aber, dass
 * es sie gibt — und die Vorlagen liegen im Bestand.
 */
export const POSTAUSGANG_STEHT: Postablage = {
  anlegen: () => {
    throw new Error('Die Postablage braucht eine Transaktion (postablage(c)).')
  },
}

export const ZAHLUNGSMITTEL = {
  ablage: ABLAGE,
  post: POSTAUSGANG_STEHT,
}
