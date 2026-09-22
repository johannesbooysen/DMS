'use server'

/**
 * Gespeicherte Suchen: speichern und loeschen.
 *
 * Duenn wie die uebrigen Aktionen: Formular lesen, Fachschicht rufen, mit
 * lesbarem Grund zurueck. Zurueck heisst: dorthin, wo man gesucht hat --
 * die Suche bleibt nach dem Speichern stehen, sie verschwindet nicht.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { alsAbfrage, SucheAbgelehnt, sucheLoeschen, sucheSpeichern, suchfilterLesen } from '@/belege/suchen-speichern'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

function parameter(formular: FormData): Record<string, string | undefined> {
  const werte: Record<string, string | undefined> = {}
  for (const [k, v] of formular.entries()) if (typeof v === 'string') werte[k] = v
  return werte
}

export async function sucheSpeichernAktion(formular: FormData): Promise<void> {
  const params = parameter(formular)
  const ziel = alsAbfrage(suchfilterLesen(params))
  try {
    await sucheSpeichern(await angemeldeterBenutzer(), String(formular.get('name') ?? ''), params)
  } catch (fehler) {
    if (fehler instanceof SucheAbgelehnt) {
      redirect(`${ziel}${ziel.includes('?') ? '&' : '?'}fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath('/belege')
  redirect(ziel)
}

export async function sucheLoeschenAktion(formular: FormData): Promise<void> {
  await sucheLoeschen(await angemeldeterBenutzer(), String(formular.get('id') ?? ''))
  revalidatePath('/belege')
  redirect('/belege')
}
