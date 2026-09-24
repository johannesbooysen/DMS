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
import { angabenNachtragen, NachtragAbgelehnt } from '@/belege/nachtragen'
import { betragLesen } from '@/extraktion/zahlen'

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

/**
 * Angaben nachtragen -- Objekt, Gruppe, Kreditor, Nummer, Datum, Betrag --
 * und zurueck zur Aufgabe. Hat die Aufgabe danach einen Traeger, der nicht
 * der Anmeldende ist, steht sie nicht mehr in seiner Liste; der Hinweis
 * sagt das, statt dass die Seite kommentarlos woanders landet.
 */
export async function angabenNachtragenAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const aufgabeId = String(formular.get('aufgabeId') ?? '')
  const bruttoRoh = String(formular.get('brutto') ?? '').trim()
  const brutto = bruttoRoh === '' ? null : betragLesen(bruttoRoh)
  if (bruttoRoh !== '' && brutto === null) {
    redirect(`/arbeitsplatz/${aufgabeId}?fehler=${encodeURIComponent('Der Betrag ist nicht lesbar.')}`)
  }
  let ergebnis: { neuZugewiesen: number }
  try {
    ergebnis = await angabenNachtragen(await angemeldeterBenutzer(), dokumentId, {
      objektId: String(formular.get('objektId') ?? ''),
      ordnungsgruppeId: String(formular.get('ordnungsgruppeId') ?? ''),
      kreditorId: String(formular.get('kreditorId') ?? ''),
      rechnungsnummer: String(formular.get('rechnungsnummer') ?? ''),
      rechnungsdatum: String(formular.get('rechnungsdatum') ?? ''),
      brutto,
    })
  } catch (fehler) {
    if (fehler instanceof NachtragAbgelehnt) {
      redirect(`/arbeitsplatz/${aufgabeId}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath('/postfach')
  revalidatePath('/arbeitsplatz')
  redirect(
    `/arbeitsplatz/${aufgabeId}?hinweis=${encodeURIComponent(
      ergebnis.neuZugewiesen > 0 ? 'Angaben übernommen — die Aufgabe hat jetzt ihren Bearbeiter.' : 'Angaben übernommen.',
    )}`,
  )
}
