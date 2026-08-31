'use server'

/**
 * Serveraktionen der Vertretung.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import {
  VertretungAbgelehnt,
  vertretungAnlegen,
  vertretungWiderrufen,
} from '@/workflow/vertretung'

function leerZuNull(wert: unknown): string | null {
  const text = String(wert ?? '').trim()
  return text === '' ? null : text
}

async function versuchen(aktion: () => Promise<void>): Promise<never> {
  try {
    await aktion()
  } catch (fehler) {
    if (fehler instanceof VertretungAbgelehnt) {
      redirect(`/vertretung?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath('/vertretung')
  redirect('/vertretung')
}

export async function vertretungAnlegenAktion(formular: FormData): Promise<void> {
  await versuchen(async () => {
    await vertretungAnlegen(await angemeldeterBenutzer(), {
      anBenutzer: String(formular.get('anBenutzer') ?? ''),
      stufentyp: leerZuNull(formular.get('stufentyp')),
      gueltigVon: leerZuNull(formular.get('gueltigVon')),
      gueltigBis: leerZuNull(formular.get('gueltigBis')),
      grund: leerZuNull(formular.get('grund')),
    })
  })
}

export async function vertretungWiderrufenAktion(formular: FormData): Promise<void> {
  await versuchen(async () => {
    await vertretungWiderrufen(
      await angemeldeterBenutzer(),
      String(formular.get('vertretungId') ?? ''),
    )
  })
}
