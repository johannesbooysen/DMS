'use server'

/**
 * Serveraktion für das endgültige Löschen.
 *
 * Eigene Datei und nicht bei den Stammdaten: Das hier ist die einzige
 * Handlung im ganzen System, die Daten unwiederbringlich entfernt. Sie soll
 * beim Suchen auffallen.
 *
 * Geprüft wird nichts hier — `app.dokument_endgueltig_loeschen` prüft Recht,
 * Frist und Löschsperre selbst und schreibt das Protokoll in derselben
 * Transaktion. Eine zweite Prüfung an dieser Stelle wäre eine zweite
 * Wahrheit, und die beiden liefen auseinander.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { endgueltigLoeschen, NichtLoeschbar } from '@/archiv'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

export async function loeschenAktion(formular: FormData): Promise<void> {
  const ziel = String(formular.get('zurueck') ?? '/archiv')
  const id = String(formular.get('id') ?? '')

  try {
    await endgueltigLoeschen(await angemeldeterBenutzer(), id)
  } catch (fehler) {
    if (fehler instanceof NichtLoeschbar) {
      redirect(`${ziel}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }

  revalidatePath(ziel)
  redirect(ziel)
}
