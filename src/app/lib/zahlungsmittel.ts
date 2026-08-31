/**
 * Womit die Anwendung Zahlungen übergibt.
 *
 * Eine Stelle, damit Oberfläche und Stempelprüfung dasselbe wissen. Sonst
 * zeigt der Bildschirm „geht", und der Stempel sagt „geht nicht".
 */

import { ABLAGE } from '@/app/lib/belege'
import type { Versand } from '@/zahlung'

/**
 * Der Mailversand ist **nicht eingerichtet**.
 *
 * Damit ist scan2bank — der Weg aus dem Bestand — derzeit nicht benutzbar.
 * Das ist bewusst so und kein Versehen: Solange kein Postausgang steht, wäre
 * jede Alternative schlechter. Eine als übergeben vermerkte Zahlung, die nie
 * jemanden erreicht hat, lässt den Beleg aus allen Listen verschwinden, und
 * das Geld fließt nie.
 *
 * Was zu tun ist, wenn es so weit ist: hier einen `Versand` einsetzen, der
 * gegen den Postausgang des Hauses spricht. Der Rest der Kette bleibt, wie
 * er ist.
 */
export function versandAusUmgebung(): Versand | null {
  return null
}

export const ZAHLUNGSMITTEL = {
  ablage: ABLAGE,
  versand: versandAusUmgebung(),
}
