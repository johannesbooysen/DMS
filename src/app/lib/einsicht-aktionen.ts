'use server'

/**
 * Einsicht gewähren und widerrufen.
 *
 * Der Token wird **einmal** angezeigt — danach steht in der Datenbank nur
 * sein Hash. Er wird deshalb über die Adresszeile zurückgereicht und nicht
 * gespeichert: Wer die Seite verlässt, ohne ihn zu kopieren, legt eine neue
 * Gewährung an und widerruft die alte.
 *
 * Das ist unbequem und genau richtig. Ein Token, der sich nachträglich
 * abrufen lässt, ist ein Token, den auch ein Datenbankauszug hergibt.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  EinsichtAbgelehnt,
  einsichtGewaehren,
  einsichtWiderrufen,
  type Empfaengertyp,
  type Recht,
  type Umfang,
} from '@/einsicht'
import { basisUrl } from '@/app/lib/adresse'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

export async function einsichtGewaehrenAktion(formular: FormData): Promise<void> {
  const objektId = String(formular.get('objektId') ?? '')
  const personId = String(formular.get('personId') ?? '')
  const empfaengerTyp = String(formular.get('empfaengerTyp') ?? 'mieter') as Empfaengertyp
  const umfang = String(formular.get('umfang') ?? 'belegliste') as Umfang
  const tage = Number(formular.get('tage') ?? 7)
  const wirtschaftsjahrRoh = String(formular.get('wirtschaftsjahr') ?? '')

  const rechte: Recht[] = ['ansicht']
  if (formular.get('download') === 'ja') rechte.push('download')

  /*
   * Der Link geht nur hinaus, wenn eine Adresse eingetragen wurde. Ohne
   * Eintrag bleibt es beim bisherigen Weg: einmal anzeigen, von Hand
   * weitergeben. Die Wahl ist absichtlich bei der Person, die den Zugang
   * anlegt — sie weiß, ob die Adresse stimmt.
   */
  const mailRoh = String(formular.get('mailAn') ?? '').trim()
  const mailAn =
    mailRoh === '' ? null : { adresse: mailRoh, basisUrl: await basisUrl() }

  let ergebnis
  try {
    ergebnis = await einsichtGewaehren(await angemeldeterBenutzer(), {
      objektId,
      personId,
      empfaengerTyp,
      umfang,
      tage,
      rechte,
      wirtschaftsjahr: wirtschaftsjahrRoh === '' ? null : Number(wirtschaftsjahrRoh),
      wasserzeichen: formular.get('wasserzeichen') !== 'nein',
      mailAn,
    })
  } catch (fehler) {
    if (fehler instanceof EinsichtAbgelehnt) {
      redirect(`/einsicht?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }

  revalidatePath('/einsicht')
  redirect(`/einsicht?neu=${encodeURIComponent(ergebnis.token)}`)
}

export async function einsichtWiderrufenAktion(formular: FormData): Promise<void> {
  const id = String(formular.get('gewaehrungId') ?? '')
  await einsichtWiderrufen(await angemeldeterBenutzer(), id)
  revalidatePath('/einsicht')
  redirect('/einsicht')
}
