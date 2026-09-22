/**
 * /arbeitsplatz ohne Aufgabe: die erste offene aufschlagen.
 *
 * Wer den Arbeitsplatz oeffnet, will arbeiten -- nicht erst waehlen. Die
 * persoenlichen Aufgaben kommen vor dem Pool, weil sie jemand ausdruecklich
 * hierher gelegt hat. Ist nichts offen, sagt die Seite das, statt eine leere
 * Mitte zu zeigen.
 */

import { redirect } from 'next/navigation'
import { persoenlichesPostfach, poolPostfach } from '@/app/lib/postfach'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

export const dynamic = 'force-dynamic'

export default async function ArbeitsplatzStart() {
  const benutzer = await angemeldeterBenutzer()
  const persoenlich = await persoenlichesPostfach(benutzer)
  const erste = persoenlich[0] ?? (await poolPostfach(benutzer))[0]
  if (erste !== undefined) redirect(`/arbeitsplatz/${erste.aufgabeId}`)

  return (
    <div className="arbeitsplatz-leer">
      <p style={{ fontSize: '1.1rem', margin: '0 0 0.5rem' }}>Nichts offen.</p>
      <p style={{ margin: 0 }}>
        Sobald ein Beleg an einer Stufe steht, die Sie bearbeiten dürfen, erscheint er links.
      </p>
    </div>
  )
}
