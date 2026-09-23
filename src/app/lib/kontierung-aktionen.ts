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
  angaben35aSetzen,
  type Art35a,
  KontierungAbgelehnt,
  restVerteilen,
  umlagefaehigkeitAendern,
  zeileEntfernen,
  zeileHinzufuegen,
} from '@/kontierung/kontierung'
import { betragLesen } from '@/extraktion/zahlen'
import { StempelAbgelehnt, stempelSetzen } from '@/app/lib/postfach'

/** Zurueck zu der Aufgabe, aus der die Maske aufgerufen wurde. */
function zurueck(formular: FormData, fehler?: string): never {
  const aufgabeId = String(formular.get('aufgabeId') ?? '')
  // Vom Arbeitsplatz aus bleibt man am Arbeitsplatz -- die Maske steht dort
  // in der rechten Spalte, und ein Fehler soll neben ihr erscheinen.
  const seite = formular.get('herkunft') === 'arbeitsplatz' ? 'arbeitsplatz' : 'aufgabe'
  const ziel = aufgabeId === '' ? '/postfach' : `/${seite}/${aufgabeId}`
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
        await restVerteilen(
          c,
          dokumentId,
          kontoId,
          steuersatz,
          umlageschluesselId,
          formular.has('umlagefaehig') ? formular.get('umlagefaehig') === 'ja' : null,
        )
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

/** Angaben nach Paragraf 35a an einer Zeile setzen -- leere Art heisst: entfernen. */
export async function angaben35aAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const zeileId = String(formular.get('zeileId') ?? '')
  const art = String(formular.get('art') ?? '')
  const betrag = (name: string): number | null => {
    const roh = String(formular.get(name) ?? '').trim()
    if (roh === '') return null
    const wert = betragLesen(roh)
    if (wert === null) throw new KontierungAbgelehnt(`Der Betrag „${roh}“ ist nicht lesbar.`)
    return wert
  }

  try {
    await alsBenutzer(await angemeldeterBenutzer(), (c) =>
      angaben35aSetzen(
        c,
        dokumentId,
        zeileId,
        art === ''
          ? null
          : {
              art: art as Art35a,
              lohnanteil: betrag('lohnanteil'),
              fahrtMaschinenkosten: betrag('fahrtMaschinenkosten'),
              materialanteil: betrag('materialanteil'),
              unbarGezahlt: formular.get('unbarGezahlt') === 'ja',
            },
      ),
    )
  } catch (fehler) {
    if (fehler instanceof KontierungAbgelehnt) zurueck(formular, fehler.message)
    throw fehler
  }
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

/*
 * Ein Schritt statt zwei.
 *
 * Im abzuloesenden System *ist* der Stempel das Formular: "Kostenstelle
 * zuordnen" erfasst die Buchungsdaten und stempelt. Hier waren es zwei
 * Handgriffe -- Zeile anlegen, dann rechts neben dem Beleg stempeln -- mit
 * Scrollen dazwischen. Die beiden Aktionen unten sind keine neue Logik: Sie
 * rufen nacheinander auf, was der Anwender sonst nacheinander ausloest.
 *
 * **Zwei Transaktionen, mit Absicht.** Die Zeile entsteht in der ersten, der
 * Stempel in der zweiten. Scheitert der Stempel (Summenzwang, Recht), bleibt
 * die Zeile stehen -- genau der Zustand, den ein Mensch auch haette, der
 * die Zeile angelegt hat und dann am Stempel gescheitert ist. Der Grund
 * steht auf der Aufgabe.
 */

/** Uebernimmt den Vorschlag als Zeile und stempelt die Stufe ab. */
export async function vorschlagUndStempelAktion(formular: FormData): Promise<void> {
  const dokumentId = String(formular.get('dokumentId') ?? '')
  const kontoId = String(formular.get('kontoId') ?? '')
  const steuersatz = Number(formular.get('steuersatz') ?? 0)
  const umlageschluesselRoh = String(formular.get('umlageschluesselId') ?? '')

  try {
    await alsBenutzer(await angemeldeterBenutzer(), (c) =>
      restVerteilen(
        c,
        dokumentId,
        kontoId,
        steuersatz,
        umlageschluesselRoh === '' ? null : umlageschluesselRoh,
        formular.has('umlagefaehig') ? formular.get('umlagefaehig') === 'ja' : null,
      ),
    )
  } catch (fehler) {
    if (fehler instanceof KontierungAbgelehnt) zurueck(formular, fehler.message)
    throw fehler
  }

  await kontiertStempelnAktion(formular)
}

/** Stempelt die Kontierungsstufe ab -- aus der Maske heraus. */
export async function kontiertStempelnAktion(formular: FormData): Promise<void> {
  const aufgabeId = String(formular.get('aufgabeId') ?? '')
  const stempeltypId = String(formular.get('stempeltypId') ?? '')

  try {
    await stempelSetzen(await angemeldeterBenutzer(), { aufgabeId, stempeltypId })
  } catch (fehler) {
    if (fehler instanceof StempelAbgelehnt) zurueck(formular, fehler.message)
    throw fehler
  }

  revalidatePath('/postfach')
  revalidatePath('/arbeitsplatz')
  // Nach dem Stempel die naechste Aufgabe, nicht das Postfach -- wenn man
  // vom Arbeitsplatz kam.
  redirect(formular.get('herkunft') === 'arbeitsplatz' ? '/arbeitsplatz' : '/postfach')
}
