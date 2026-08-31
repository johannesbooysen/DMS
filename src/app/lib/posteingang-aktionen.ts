'use server'

/**
 * Posteingang: hochladen, trennen, übernehmen.
 *
 * Der Upload ist die Tür, die bisher fehlte — `dokumentAufnehmen` gab es
 * schon, aber niemand rief es außerhalb eines Demoskripts auf.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ABLAGE } from '@/app/lib/belege'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'
import { dokumentAufnehmen } from '@/ingest/aufnehmen'
import {
  StapelAbgelehnt,
  stapelAufnehmen,
  stapelUebernehmen,
  stapelVerwerfen,
  trennungAendern,
} from '@/stapel'

/** Der Mandant des Angemeldeten — kein Feld im Formular. */
async function meinMandant(benutzerId: string): Promise<string> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ m: string }>('select app.mein_mandant() as m')
    return rows[0].m
  })
}

export async function postAufnehmenAktion(formular: FormData): Promise<void> {
  const benutzer = await angemeldeterBenutzer()
  const datei = formular.get('datei')
  const alsStapel = formular.get('stapel') === 'ja'

  if (!(datei instanceof File) || datei.size === 0) {
    redirect('/posteingang?fehler=' + encodeURIComponent('Keine Datei gewählt.'))
  }

  const inhalt = Buffer.from(await datei.arrayBuffer())
  const mandantId = await meinMandant(benutzer)

  try {
    if (alsStapel) {
      const id = await stapelAufnehmen(benutzer, ABLAGE, {
        mandantId,
        dateiname: datei.name,
        eingangskanal: 'scan',
        inhalt,
      })
      revalidatePath('/posteingang')
      redirect(`/posteingang/${id}`)
    }

    // Einzelner Beleg: direkt in den Lauf, ohne Zwischenschritt. Wer eine
    // Rechnung hochlaedt, soll nicht durch eine Trennungspruefung muessen.
    const auf = await alsBenutzer(benutzer, (c) =>
      dokumentAufnehmen(
        c,
        ABLAGE,
        {
          mandantId,
          belegart: 'rechnung',
          eingangskanal: 'upload',
          dateiname: datei.name,
          mime: datei.type === '' ? 'application/pdf' : datei.type,
          inhalt,
        },
        benutzer,
      ),
    )
    revalidatePath('/posteingang')
    redirect(`/beleg/${auf.dokumentId}`)
  } catch (fehler) {
    if (fehler instanceof StapelAbgelehnt) {
      redirect('/posteingang?fehler=' + encodeURIComponent(fehler.message))
    }
    throw fehler
  }
}

export async function trennungAendernAktion(formular: FormData): Promise<void> {
  const stapelId = String(formular.get('stapelId') ?? '')
  await trennungAendern(
    await angemeldeterBenutzer(),
    stapelId,
    Number(formular.get('seite') ?? 0),
    formular.get('trenner') === 'ja',
  )
  revalidatePath(`/posteingang/${stapelId}`)
  redirect(`/posteingang/${stapelId}`)
}

export async function stapelUebernehmenAktion(formular: FormData): Promise<void> {
  const stapelId = String(formular.get('stapelId') ?? '')
  try {
    await stapelUebernehmen(await angemeldeterBenutzer(), ABLAGE, stapelId)
  } catch (fehler) {
    if (fehler instanceof StapelAbgelehnt) {
      redirect(`/posteingang/${stapelId}?fehler=` + encodeURIComponent(fehler.message))
    }
    throw fehler
  }
  revalidatePath('/posteingang')
  redirect(`/posteingang/${stapelId}`)
}

export async function stapelVerwerfenAktion(formular: FormData): Promise<void> {
  const stapelId = String(formular.get('stapelId') ?? '')
  const grund = String(formular.get('grund') ?? '')
  try {
    await stapelVerwerfen(await angemeldeterBenutzer(), stapelId, grund)
  } catch (fehler) {
    if (fehler instanceof StapelAbgelehnt) {
      redirect(`/posteingang/${stapelId}?fehler=` + encodeURIComponent(fehler.message))
    }
    throw fehler
  }
  revalidatePath('/posteingang')
  redirect('/posteingang')
}
