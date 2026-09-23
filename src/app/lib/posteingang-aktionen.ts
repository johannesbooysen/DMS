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

/**
 * Eine Datei oder mehrere -- derselbe Weg je Datei.
 *
 * Bei **einer** Datei geht es direkt zum Ergebnis (Beleg oder Stapel), wie
 * immer. Bei mehreren bleibt man im Posteingang mit einer Zeile, was
 * aufgenommen wurde: Zehn Belege auf einmal fuehren auf keinen einzelnen.
 * Jede Datei laeuft in ihrer eigenen Transaktion -- eine abgewiesene
 * (`StapelAbgelehnt`) haelt die anderen nicht auf, sie wird genannt.
 */
export async function postAufnehmenAktion(formular: FormData): Promise<void> {
  const benutzer = await angemeldeterBenutzer()
  const dateien = formular.getAll('datei').filter((d): d is File => d instanceof File && d.size > 0)
  const alsStapel = formular.get('stapel') === 'ja'

  if (dateien.length === 0) {
    redirect('/posteingang?fehler=' + encodeURIComponent('Keine Datei gewählt.'))
  }

  const mandantId = await meinMandant(benutzer)
  const ergebnisse: Array<{ art: 'stapel' | 'beleg'; id: string }> = []
  const abgewiesen: string[] = []

  for (const datei of dateien) {
    const inhalt = Buffer.from(await datei.arrayBuffer())
    try {
      if (alsStapel) {
        const id = await stapelAufnehmen(benutzer, ABLAGE, {
          mandantId,
          dateiname: datei.name,
          eingangskanal: 'scan',
          inhalt,
        })
        ergebnisse.push({ art: 'stapel', id })
        continue
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
      ergebnisse.push({ art: 'beleg', id: auf.dokumentId })
    } catch (fehler) {
      if (fehler instanceof StapelAbgelehnt) {
        // Der Dateiname, nicht der Inhalt: Er stammt vom Hochladenden selbst.
        abgewiesen.push(`${datei.name}: ${fehler.message}`)
        continue
      }
      throw fehler
    }
  }

  revalidatePath('/posteingang')

  const einziges = ergebnisse[0]
  if (dateien.length === 1 && einziges !== undefined) {
    redirect(einziges.art === 'stapel' ? `/posteingang/${einziges.id}` : `/beleg/${einziges.id}`)
  }
  if (dateien.length === 1) {
    redirect('/posteingang?fehler=' + encodeURIComponent(abgewiesen[0] ?? 'Nicht aufgenommen.'))
  }

  const stapel = ergebnisse.filter((e) => e.art === 'stapel').length
  const belege = ergebnisse.length - stapel
  const teile: string[] = []
  if (belege > 0) teile.push(`${belege} ${belege === 1 ? 'Beleg' : 'Belege'} aufgenommen`)
  if (stapel > 0) teile.push(`${stapel} ${stapel === 1 ? 'Stapel' : 'Stapel'} in der Aufbereitung`)
  const abfrage = new URLSearchParams()
  if (teile.length > 0) abfrage.set('hinweis', teile.join(', ') + '.')
  if (abgewiesen.length > 0) abfrage.set('fehler', 'Nicht aufgenommen — ' + abgewiesen.join('; '))
  redirect('/posteingang?' + abfrage.toString())
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
