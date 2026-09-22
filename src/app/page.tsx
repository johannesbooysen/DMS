/**
 * Die Wurzel führt an den Arbeitsplatz.
 *
 * Hier stand eine Platzhalterseite mit dem Satz „Viewer und Postfächer sind
 * noch nicht gebaut". Das war einmal richtig und ist es seit vielen Wochen
 * nicht mehr — wer die Anwendung ohne Pfad aufruft, bekam eine Auskunft, die
 * schlicht falsch war.
 *
 * Ein eigener Inhalt braucht die Wurzel nicht: Wer angemeldet ist, will in
 * sein Postfach; wer es nicht ist, wird von dort zur Anmeldung geschickt.
 * Eine Begrüßungsseite dazwischen wäre ein Klick ohne Aussage.
 */

import { redirect } from 'next/navigation'

export default function Startseite(): never {
  // Seit es den Arbeitsplatz gibt, ist er der Ort, an dem der Tag beginnt:
  // die erste offene Aufgabe, der Beleg gross, die Entscheidung daneben.
  redirect('/arbeitsplatz')
}
