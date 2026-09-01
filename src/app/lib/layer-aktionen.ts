'use server'

/**
 * Notizen, Hervorhebungen und Schwärzungen anlegen und ausblenden.
 *
 * Stempel stehen absichtlich nicht hier: Sie entstehen aus ihrem Ereignis
 * (Trigger `stempel_ereignis_layer`). Eine Aktion „Stempel anlegen" wäre ein
 * zweiter Weg zum selben Ergebnis — und der erste, der irgendwann vergisst,
 * das Ereignis mitzuschreiben.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { LayerAbgelehnt, layerAnlegen, layerAusblenden } from '@/layer'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

function zurueck(dokumentId: string, grund?: string): never {
  redirect(
    grund === undefined
      ? `/beleg/${dokumentId}`
      : `/beleg/${dokumentId}?fehler=${encodeURIComponent(grund)}`,
  )
}

export async function layerAnlegenAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const zahl = (name: string) => Number(formular.get(name) ?? 0)

  try {
    await layerAnlegen(await angemeldeterBenutzer(), {
      dokumentId,
      typ: String(formular.get('typ') ?? 'notiz') as 'notiz' | 'highlight' | 'schwaerzung',
      seite: zahl('seite'),
      x: zahl('x'),
      y: zahl('y'),
      breite: zahl('breite'),
      hoehe: zahl('hoehe'),
      text: String(formular.get('text') ?? ''),
      sichtbarkeit: formular.get('nachDraussen') === 'ja' ? 'extern' : 'intern',
    })
  } catch (fehler) {
    if (fehler instanceof LayerAbgelehnt) zurueck(dokumentId, fehler.message)
    throw fehler
  }

  revalidatePath(`/beleg/${dokumentId}`)
  zurueck(dokumentId)
}

export async function layerAusblendenAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  await layerAusblenden(await angemeldeterBenutzer(), String(formular.get('layerId') ?? ''))
  revalidatePath(`/beleg/${dokumentId}`)
  zurueck(dokumentId)
}
