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
  /*
   * Woher der Stempel kam, dorthin geht es zurueck. Vom Arbeitsplatz aus
   * heisst "zurueck": zur naechsten Aufgabe in der Liste, ohne Umweg ueber
   * das Postfach -- das ist der Sinn der geteilten Ansicht. Von der
   * einzelnen Aufgabenseite aus bleibt es beim Postfach.
   */
  const vomArbeitsplatz = formular.get('herkunft') === 'arbeitsplatz'

  try {
    await stempelSetzen(await angemeldeterBenutzer(), {
      aufgabeId,
      stempeltypId,
      kommentar,
      wiedervorlageAm: wiedervorlageAm === '' ? null : wiedervorlageAm,
    })
  } catch (fehler) {
    if (fehler instanceof StempelAbgelehnt) {
      // Der Grund gehoert dem Anwender gezeigt, nicht verschluckt.
      const ziel = vomArbeitsplatz ? `/arbeitsplatz/${aufgabeId}` : `/aufgabe/${aufgabeId}`
      redirect(`${ziel}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }

  revalidatePath('/postfach')
  revalidatePath('/arbeitsplatz')
  redirect(vomArbeitsplatz ? '/arbeitsplatz' : '/postfach')
}
