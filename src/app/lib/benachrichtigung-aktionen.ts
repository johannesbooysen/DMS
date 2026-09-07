'use server'

/**
 * Serveraktion für den eigenen Benachrichtigungswunsch.
 *
 * Ohne Rechteprüfung, und das ist richtig: Die Policy lässt jeden nur die
 * eigene Zeile ändern (`benachrichtigung_eigene`). Wann jemand eine Mail
 * möchte, geht niemanden sonst etwas an — auch die Benutzerverwaltung nicht.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { wunschSpeichern } from '@/benachrichtigung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'

export async function wunschSpeichernAktion(formular: FormData): Promise<void> {
  const ziel = String(formular.get('zurueck') ?? '/postfach')
  const stunde = Number(formular.get('stunde') ?? 7)

  try {
    await alsBenutzer(await angemeldeterBenutzer(), (c) =>
      wunschSpeichern(c, {
        taeglich: formular.get('taeglich') === 'ja',
        stunde: Number.isFinite(stunde) ? stunde : 7,
      }),
    )
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : 'Das ging nicht.'
    redirect(`${ziel}?fehler=${encodeURIComponent(text)}`)
  }

  revalidatePath(ziel)
  redirect(ziel)
}
