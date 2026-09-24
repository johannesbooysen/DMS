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
import { angabenNachtragen, aufbereitungErneut, NachtragAbgelehnt } from '@/belege/nachtragen'
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
  const text = (name: string) => String(formular.get(name) ?? '')
  // Betraege in deutscher Schreibweise; ein unlesbarer wird genannt, nicht
  // stillschweigend zu null.
  const betrag = (name: string, was: string): number | null => {
    const roh = text(name).trim()
    if (roh === '') return null
    const wert = betragLesen(roh)
    if (wert === null) {
      redirect(`/arbeitsplatz/${aufgabeId}?fehler=${encodeURIComponent(`${was} ist nicht lesbar.`)}`)
    }
    return wert
  }
  const brutto = betrag('brutto', 'Der Bruttobetrag')
  const netto = betrag('netto', 'Der Nettobetrag')
  const steuer = betrag('steuer', 'Der Steuerbetrag')
  const skontoProzent = betrag('skontoProzent', 'Der Skontosatz')
  let ergebnis: { neuZugewiesen: number; pflichtfelderVollstaendig: boolean }
  try {
    ergebnis = await angabenNachtragen(await angemeldeterBenutzer(), dokumentId, {
      objektId: text('objektId'),
      ordnungsgruppeId: text('ordnungsgruppeId'),
      kreditorId: text('kreditorId'),
      rechnungsnummer: text('rechnungsnummer'),
      rechnungsdatum: text('rechnungsdatum'),
      brutto,
      netto,
      steuer,
      leistungVon: text('leistungVon'),
      leistungBis: text('leistungBis'),
      ibanImBeleg: text('ibanImBeleg'),
      zahlungsziel: text('zahlungsziel'),
      skontoProzent,
      skontoBis: text('skontoBis'),
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

/** Die Aufbereitung noch einmal -- Erkennung nach dem Eingang eingerichtet, Stammdatum dazugekommen. */
export async function aufbereitungErneutAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const aufgabeId = String(formular.get('aufgabeId') ?? '')
  try {
    await aufbereitungErneut(await angemeldeterBenutzer(), dokumentId)
  } catch (fehler) {
    if (fehler instanceof NachtragAbgelehnt) {
      redirect(`/arbeitsplatz/${aufgabeId}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath('/postfach')
  revalidatePath('/arbeitsplatz')
  redirect(`/beleg/${dokumentId}`)
}
