'use server'

/**
 * Serveraktionen der Oberflaeche.
 *
 * Duenn gehalten: Formulardaten entgegennehmen, an die Fachschicht geben,
 * Ansicht auffrischen. Die Pruefung, ob ein Stempel gesetzt werden darf,
 * steht in postfach.ts -- nicht hier und schon gar nicht im Browser.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { StempelAbgelehnt, stempelSetzen } from '@/app/lib/postfach'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

export async function stempelnAktion(formular: FormData): Promise<void> {
  const aufgabeId = String(formular.get('aufgabeId') ?? '')
  const stempeltypId = String(formular.get('stempeltypId') ?? '')
  const kommentar = String(formular.get('kommentar') ?? '')
  const wiedervorlageAm = String(formular.get('wiedervorlageAm') ?? '')

  try {
    await stempelSetzen(angemeldeterBenutzer(), {
      aufgabeId,
      stempeltypId,
      kommentar,
      wiedervorlageAm: wiedervorlageAm === '' ? null : wiedervorlageAm,
    })
  } catch (fehler) {
    if (fehler instanceof StempelAbgelehnt) {
      // Der Grund gehoert dem Anwender gezeigt, nicht verschluckt.
      redirect(`/aufgabe/${aufgabeId}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }

  revalidatePath('/postfach')
  redirect('/postfach')
}
