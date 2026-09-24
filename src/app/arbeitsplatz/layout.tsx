/**
 * Der Arbeitsplatz: Liste, Beleg, Entscheidung -- nebeneinander.
 *
 * Das ist die geteilte Ansicht, die im abzuloesenden System den Alltag
 * traegt: links die Aufgaben, in der Mitte der Beleg gross, rechts, was zu
 * tun ist. Kein Seitenwechsel zwischen zwei Belegen, keine Liste, in die
 * man nach jedem Stempel zurueckfaellt.
 *
 * **Ein Layout, keine Client-Anwendung.** Die Liste steht hier im Layout;
 * beim Wechsel der Aufgabe rendert Next nur die Seite darunter neu -- die
 * Liste bleibt stehen, samt Scrollstand. Das ist die geteilte Ansicht mit
 * den Mitteln des Routers, ohne dass der Bestand in den Browser wandert.
 *
 * Es gibt keine dritte Datenquelle: Die Spalten sind dieselben Postfaecher
 * wie unter /postfach (Konzept 8.5), nur anders angeordnet.
 */

import type { ReactNode } from 'react'
import { Aufgabenleiste } from '@/app/lib/aufgabenleiste'
import { belegAnriss, Seitenrahmen } from '@/app/lib/darstellung'
import { ohneZustaendigkeit, persoenlichesPostfach, poolPostfach, type Postfachzeile } from '@/app/lib/postfach'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

export const dynamic = 'force-dynamic'

/** Nur, was die Leiste braucht -- Zeilen gehen an eine Client-Komponente. */
function eintrag(z: Postfachzeile) {
  return {
    aufgabeId: z.aufgabeId,
    kreditor: z.kreditor,
    korrespondent: z.korrespondent,
    betreff: z.betreff,
    rechnungsnummer: z.rechnungsnummer,
    objektnummer: z.objektnummer,
    stufe: z.stufe,
    brutto: z.brutto,
    ampel: z.ampel,
    faelligAm: z.faelligAm,
    // Nur, wenn der Titel nichts sagt: Sonst stuende unter jeder Rechnung
    // ihr erster Satz.
    hinweis: z.kreditor === null && z.korrespondent === null && z.betreff === null ? belegAnriss(z) : null,
  }
}

export default async function Arbeitsplatz({ children }: { children: ReactNode }) {
  const benutzer = await angemeldeterBenutzer()
  const [persoenlich, pool, herrenlos] = await Promise.all([
    persoenlichesPostfach(benutzer),
    poolPostfach(benutzer),
    ohneZustaendigkeit(benutzer),
  ])

  return (
    <Seitenrahmen titel="Arbeitsplatz" breit>
      <div className="arbeitsplatz">
        <Aufgabenleiste persoenlich={persoenlich.map(eintrag)} pool={pool.map(eintrag)} herrenlos={herrenlos.map(eintrag)} />
        {children}
      </div>
    </Seitenrahmen>
  )
}
