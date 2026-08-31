'use server'

/**
 * Warten beginnen und beenden.
 *
 * Dünn wie die übrigen Aktionen. Die beiden Pflichtfelder — Wiedervorlage
 * beim Öffnen, Ergebnis beim Schließen — erzwingt die Datenbank; hier wird
 * die Meldung nur lesbar gemacht.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { wartenBeenden, wartenBeginnen, WartenAbgelehnt, type Ereignis } from '@/nebenlauf'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

function zurueck(fehler?: string): never {
  redirect(fehler === undefined ? '/warten' : `/warten?fehler=${encodeURIComponent(fehler)}`)
}

export async function wartenBeginnenAktion(formular: FormData): Promise<void> {
  const betragRoh = String(formular.get('erwarteterBetrag') ?? '')

  try {
    await wartenBeginnen(await angemeldeterBenutzer(), {
      dokumentId: String(formular.get('dokumentId') ?? ''),
      art: String(formular.get('art') ?? ''),
      ereignis: String(formular.get('ereignis') ?? 'erstattung') as Ereignis,
      wiedervorlageAm: String(formular.get('wiedervorlageAm') ?? ''),
      erwarteterBetrag: betragRoh === '' ? null : Number(betragRoh.replace(',', '.')),
    })
  } catch (fehler) {
    if (fehler instanceof WartenAbgelehnt) zurueck(fehler.message)
    // Die Datenbankmeldungen sind hier ausnahmsweise für den Bildschirm
    // brauchbar: "Ein Wartecontainer braucht eine Wiedervorlage" sagt genau
    // das Richtige, und sie zu übersetzen hieße, sie zweimal zu pflegen.
    if (fehler instanceof Error && /Wiedervorlage|Zukunft/.test(fehler.message)) {
      zurueck(fehler.message)
    }
    throw fehler
  }

  revalidatePath('/warten')
  zurueck()
}

export async function wartenBeendenAktion(formular: FormData): Promise<void> {
  const ergebnis = String(formular.get('ergebnis') ?? '').trim()
  if (ergebnis === '') {
    zurueck('Ohne Ergebnis wird kein Wartecontainer geschlossen.')
  }

  await wartenBeenden(
    await angemeldeterBenutzer(),
    String(formular.get('containerId') ?? ''),
    ergebnis,
  )
  revalidatePath('/warten')
  zurueck()
}
