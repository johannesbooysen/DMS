'use server'

/**
 * Ausgangsbuch und Vorlagen bedienen.
 *
 * Beim Speichern einer Vorlage wird geprüft, ob alle Platzhalter in der
 * Weißliste stehen — **bevor** gespeichert wird. Ein Tippfehler soll hier
 * auffallen und nicht in einer Mail an die Bank.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { alsBenutzer } from '@/db'
import { postWiederholen, vorlagePruefen } from '@/postausgang'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

export async function postWiederholenAktion(formular: FormData): Promise<void> {
  await postWiederholen(
    await angemeldeterBenutzer(),
    String(formular.get('ausgangId') ?? ''),
  )
  revalidatePath('/postausgang')
  redirect('/postausgang')
}

/**
 * Zurück zur Vorlage, mit Grund.
 *
 * Wichtig ist das `vorlage=`: Ohne den Parameter schlösse die Seite das
 * Formular, und die Bearbeitung wäre weg. Wer einen Platzhalter vertippt hat,
 * soll ihn korrigieren können und nicht von vorn anfangen müssen.
 */
function zurueck(id: string, grund: string): never {
  redirect(`/postausgang?vorlage=${encodeURIComponent(id)}&fehler=${encodeURIComponent(grund)}`)
}

export async function vorlageSpeichernAktion(formular: FormData): Promise<void> {
  const id = String(formular.get('vorlageId') ?? '')
  const betreff = String(formular.get('betreff') ?? '').trim()
  const text = String(formular.get('text') ?? '')

  if (betreff === '' || text.trim() === '') {
    zurueck(id, 'Betreff und Text dürfen nicht leer sein. Nichts gespeichert.')
  }

  const unbekannt = vorlagePruefen(betreff, text)
  if (unbekannt.length > 0) {
    zurueck(
      id,
      `Unbekannte Platzhalter: ${unbekannt.map((n) => `{{${n}}}`).join(', ')}. ` +
        'Sie würden im Text stehen bleiben. Nichts gespeichert.',
    )
  }

  await alsBenutzer(await angemeldeterBenutzer(), (c) =>
    c.query(
      `update vorlage
          set betreff = $2, text = $3,
              geaendert_am = now(), geaendert_von = app.mein_benutzer()
        where id = $1`,
      [id, betreff, text],
    ),
  )

  revalidatePath('/postausgang')
  redirect('/postausgang')
}
