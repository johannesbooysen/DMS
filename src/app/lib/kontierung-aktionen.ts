'use server'

/**
 * Serveraktionen der Kontierung.
 *
 * Jede Aktion laeuft unter der Kennung des Anmelders -- die RLS entscheidet,
 * ob der Beleg ueberhaupt erreichbar ist. Eine untergeschobene Dokument-ID
 * findet hier nichts.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { alsBenutzer } from '@/db'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import {
  KontierungAbgelehnt,
  restVerteilen,
  umlagefaehigkeitAendern,
  zeileEntfernen,
  zeileHinzufuegen,
} from '@/kontierung/kontierung'
import { betragLesen } from '@/extraktion/zahlen'

/** Zurueck zu der Aufgabe, aus der die Maske aufgerufen wurde. */
function zurueck(formular: FormData, fehler?: string): never {
  const aufgabeId = String(formular.get('aufgabeId') ?? '')
  const ziel = aufgabeId === '' ? '/postfach' : `/aufgabe/${aufgabeId}`
  redirect(fehler === undefined ? ziel : `${ziel}?fehler=${encodeURIComponent(fehler)}`)
}

export async function zeileHinzufuegenAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const kontoId = String(formular.get('kontoId') ?? '')
  const betragRoh = String(formular.get('betragBrutto') ?? '')
  const steuersatz = Number(formular.get('steuersatz') ?? 0)
  const restNehmen = formular.get('rest') === 'ja'
  const umlageschluesselRoh = String(formular.get('umlageschluesselId') ?? '')
  const umlageschluesselId = umlageschluesselRoh === '' ? null : umlageschluesselRoh

  try {
    await alsBenutzer(await angemeldeterBenutzer(), async (c) => {
      if (restNehmen) {
        await restVerteilen(c, dokumentId, kontoId, steuersatz, umlageschluesselId)
        return
      }
      // Ueber betragLesen, nicht ueber Number(): "1.023,40" ist im Formular
      // eine gueltige Eingabe und wuerde sonst NaN (Konzept 13, gemessen).
      const betrag = betragLesen(betragRoh)
      if (betrag === null) throw new KontierungAbgelehnt('Der Betrag ist nicht lesbar.')
      await zeileHinzufuegen(c, dokumentId, {
        kontoId,
        betragBrutto: betrag,
        steuersatz,
        umlageschluesselId,
        umlagefaehig: formular.has('umlagefaehig') ? formular.get('umlagefaehig') === 'ja' : null,
        ruecklageEntnahme: formular.get('ruecklageEntnahme') === 'ja',
      })
    })
  } catch (fehler) {
    if (fehler instanceof KontierungAbgelehnt) zurueck(formular, fehler.message)
    throw fehler
  }

  revalidatePath('/postfach')
  zurueck(formular)
}

export async function zeileEntfernenAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const zeileId = String(formular.get('zeileId') ?? '')

  await alsBenutzer(await angemeldeterBenutzer(), (c) => zeileEntfernen(c, dokumentId, zeileId))
  zurueck(formular)
}

export async function umlageUmschaltenAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const zeileId = String(formular.get('zeileId') ?? '')
  const neu = formular.get('umlagefaehig') === 'ja'

  await alsBenutzer(await angemeldeterBenutzer(), (c) =>
    umlagefaehigkeitAendern(c, dokumentId, zeileId, neu),
  )
  zurueck(formular)
}
