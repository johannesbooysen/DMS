'use server'

/**
 * Serveraktionen des Baukastens.
 *
 * Wie bei den Stempeln: Das Formular reicht nur Daten weiter. Recht,
 * Gueltigkeit und Reihenfolge pruefen liegt in workflow/konfiguration.ts.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  entwurfAktivieren,
  entwurfAnlegen,
  knotenEinfuegen,
  knotenEntfernen,
  knotenVerschieben,
  NichtErlaubt,
  NichtMoeglich,
} from '@/workflow/konfiguration'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

/** Fuehrt eine Aktion aus und leitet mit lesbarem Grund zurueck, wenn sie scheitert. */
async function versuchen(ziel: string, aktion: () => Promise<void>): Promise<never> {
  try {
    await aktion()
  } catch (fehler) {
    if (fehler instanceof NichtErlaubt || fehler instanceof NichtMoeglich) {
      redirect(`${ziel}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath(ziel)
  redirect(ziel)
}

export async function entwurfAnlegenAktion(formular: FormData): Promise<void> {
  const vorlage = String(formular.get('vorlageId') ?? '')
  let neu = ''
  try {
    neu = await entwurfAnlegen(await angemeldeterBenutzer(), vorlage)
  } catch (fehler) {
    if (fehler instanceof NichtErlaubt || fehler instanceof NichtMoeglich) {
      redirect(`/konfiguration?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath('/konfiguration')
  redirect(`/konfiguration/${neu}`)
}

export async function bausteinEinfuegenAktion(formular: FormData): Promise<void> {
  const definitionId = String(formular.get('definitionId') ?? '')
  const elternId = String(formular.get('elternId') ?? '')
  const knotentyp = String(formular.get('knotentyp') ?? '') as
    | 'nacheinander'
    | 'gleichzeitig'
    | 'verzweigung'
    | 'stufe'
  const stufeId = String(formular.get('stufeId') ?? '')

  await versuchen(`/konfiguration/${definitionId}`, async () => {
    await knotenEinfuegen(await angemeldeterBenutzer(), definitionId, {
      elternId,
      knotentyp,
      stufeId: stufeId === '' ? null : stufeId,
    })
  })
}

export async function bausteinVerschiebenAktion(formular: FormData): Promise<void> {
  const definitionId = String(formular.get('definitionId') ?? '')
  const knotenId = String(formular.get('knotenId') ?? '')
  const richtung = formular.get('richtung') === 'hoch' ? 'hoch' : 'runter'

  await versuchen(`/konfiguration/${definitionId}`, async () => {
    await knotenVerschieben(await angemeldeterBenutzer(), definitionId, knotenId, richtung)
  })
}

export async function bausteinEntfernenAktion(formular: FormData): Promise<void> {
  const definitionId = String(formular.get('definitionId') ?? '')
  const knotenId = String(formular.get('knotenId') ?? '')

  await versuchen(`/konfiguration/${definitionId}`, async () => {
    await knotenEntfernen(await angemeldeterBenutzer(), definitionId, knotenId)
  })
}

export async function aktivierenAktion(formular: FormData): Promise<void> {
  const definitionId = String(formular.get('definitionId') ?? '')
  await versuchen(`/konfiguration/${definitionId}`, async () => {
    await entwurfAktivieren(await angemeldeterBenutzer(), definitionId)
  })
}
