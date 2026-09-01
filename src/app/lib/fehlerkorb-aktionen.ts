'use server'

/**
 * Die drei Ausgänge des Fehlerkorbs.
 *
 * Jeder wirkt auf den Beleg, nicht nur auf den Eintrag — deshalb liegen sie
 * hier und nicht als Formular in der Seite. Ein „erledigt"-Haken, der nichts
 * am Beleg ändert, hätte den Korb nur leer gemacht und das Problem gelassen.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  FehlerkorbAbgelehnt,
  fehlerManuell,
  fehlerVerwerfen,
  fehlerWiederholen,
  haengerWiederholen,
} from '@/fehlerkorb'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

function zurueck(grund?: string): never {
  redirect(grund === undefined ? '/fehlerkorb' : `/fehlerkorb?fehler=${encodeURIComponent(grund)}`)
}

export async function fehlerWiederholenAktion(formular: FormData): Promise<void> {
  await fehlerWiederholen(await angemeldeterBenutzer(), String(formular.get('fehlerId') ?? ''))
  revalidatePath('/fehlerkorb')
  zurueck()
}

export async function fehlerManuellAktion(formular: FormData): Promise<void> {
  try {
    await fehlerManuell(await angemeldeterBenutzer(), String(formular.get('fehlerId') ?? ''))
  } catch (fehler) {
    if (fehler instanceof FehlerkorbAbgelehnt) zurueck(fehler.message)
    throw fehler
  }
  revalidatePath('/fehlerkorb')
  zurueck()
}

export async function fehlerVerwerfenAktion(formular: FormData): Promise<void> {
  const grund = String(formular.get('grund') ?? '')
  try {
    await fehlerVerwerfen(
      await angemeldeterBenutzer(),
      String(formular.get('fehlerId') ?? ''),
      grund,
    )
  } catch (fehler) {
    if (fehler instanceof FehlerkorbAbgelehnt) zurueck(fehler.message)
    throw fehler
  }
  revalidatePath('/fehlerkorb')
  zurueck()
}

export async function haengerWiederholenAktion(formular: FormData): Promise<void> {
  await haengerWiederholen(
    await angemeldeterBenutzer(),
    String(formular.get('dokumentId') ?? ''),
  )
  revalidatePath('/fehlerkorb')
  zurueck()
}
