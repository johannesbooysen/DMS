'use server'

/**
 * Serveraktionen des Notfallzugriffs (Konzept §24.10).
 *
 * **Kein Recht wird hier geprüft.** Das wäre eine zweite Wahrheit neben der
 * RLS. Die Maske fragt vorher, was sie anzeigen soll (`darfEinrichten`) —
 * die Grenze zieht die Datenbank.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { NichtErlaubt, NichtMoeglich, beenden, einrichten } from '@/notfall'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'

const ZIEL = '/notfall'

async function versuchen(aktion: (benutzerId: string) => Promise<void>): Promise<never> {
  try {
    await aktion(await angemeldeterBenutzer())
  } catch (fehler) {
    if (fehler instanceof NichtErlaubt || fehler instanceof NichtMoeglich) {
      redirect(`${ZIEL}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath(ZIEL)
  redirect(ZIEL)
}

export async function notfallEinrichtenAktion(f: FormData): Promise<void> {
  const benutzerId = String(f.get('benutzer_id') ?? '')
  const objektId = String(f.get('objekt_id') ?? '')
  const grund = String(f.get('grund') ?? '')
  const tage = Number(String(f.get('tage') ?? ''))

  await versuchen(async (angemeldet) => {
    await alsBenutzer(angemeldet, (c) =>
      einrichten(c, { benutzerId, objektId, grund, tage }),
    )
  })
}

export async function notfallBeendenAktion(f: FormData): Promise<void> {
  const id = String(f.get('id') ?? '')
  await versuchen(async (angemeldet) => {
    await alsBenutzer(angemeldet, (c) => beenden(c, id))
  })
}
