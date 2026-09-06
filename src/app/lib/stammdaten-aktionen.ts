'use server'

/**
 * Serveraktionen der Stammdatenpflege.
 *
 * Wie beim Baukasten: Das Formular reicht nur Daten weiter. Wer schreiben
 * darf, entscheiden die Policies — diese Schicht wandelt `FormData` in eine
 * einfache Abbildung um und übersetzt einen Fehlschlag in etwas, das ein
 * Mensch lesen kann.
 *
 * **Kein Recht wird hier geprüft.** Das wäre eine zweite Wahrheit neben der
 * RLS, und die beiden liefen auseinander. Die Oberfläche fragt nur vorher,
 * was sie anzeigen soll (`rechtelage`) — die Grenze zieht die Datenbank.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  bankverbindungAnlegen,
  bankverbindungEntscheiden,
  benutzerAnlegen,
  benutzerUmschalten,
  fristSetzen,
  kontoAnlegen,
  kontoUmschalten,
  kreditorAendern,
  kreditorAnlegen,
  NichtErlaubt,
  NichtMoeglich,
  objektAendern,
  objektAnlegen,
  ordnungsgruppeAnlegen,
  ordnungsgruppeUmschalten,
  rolleEntziehen,
  rolleZuweisen,
  zahlungswegAnlegen,
  zahlungswegUmschalten,
  zustaendigkeitBeenden,
  zustaendigkeitSetzen,
  type Eingaben,
} from '@/stammdaten'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'

/** `FormData` in die einfache Abbildung, die die Fachschicht erwartet. */
function eingaben(formular: FormData): Eingaben {
  const werte: Eingaben = {}
  for (const [schluessel, wert] of formular.entries()) {
    if (typeof wert === 'string') werte[schluessel] = wert
  }
  return werte
}

/**
 * Führt eine Aktion aus und leitet mit lesbarem Grund zurück, wenn sie
 * scheitert.
 *
 * Der Zielpfad kommt aus dem Formular, damit dieselbe Aktion von mehreren
 * Unterseiten aus benutzt werden kann und man dort landet, wo man war.
 */
async function versuchen(
  formular: FormData,
  aktion: (benutzerId: string, f: Eingaben) => Promise<void>,
): Promise<never> {
  const ziel = String(formular.get('zurueck') ?? '/stammdaten')
  try {
    await aktion(await angemeldeterBenutzer(), eingaben(formular))
  } catch (fehler) {
    if (fehler instanceof NichtErlaubt || fehler instanceof NichtMoeglich) {
      redirect(`${ziel}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath(ziel)
  redirect(ziel)
}

export async function objektAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, objektAnlegen)
}
export async function objektAendernAktion(f: FormData): Promise<void> {
  await versuchen(f, objektAendern)
}
export async function kreditorAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, kreditorAnlegen)
}
export async function kreditorAendernAktion(f: FormData): Promise<void> {
  await versuchen(f, kreditorAendern)
}
export async function bankverbindungAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, bankverbindungAnlegen)
}
export async function bankverbindungEntscheidenAktion(f: FormData): Promise<void> {
  await versuchen(f, bankverbindungEntscheiden)
}
export async function kontoAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, kontoAnlegen)
}
export async function kontoUmschaltenAktion(f: FormData): Promise<void> {
  await versuchen(f, kontoUmschalten)
}
export async function zahlungswegAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, zahlungswegAnlegen)
}
export async function zahlungswegUmschaltenAktion(f: FormData): Promise<void> {
  await versuchen(f, zahlungswegUmschalten)
}
export async function ordnungsgruppeAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, ordnungsgruppeAnlegen)
}
export async function ordnungsgruppeUmschaltenAktion(f: FormData): Promise<void> {
  await versuchen(f, ordnungsgruppeUmschalten)
}
export async function fristSetzenAktion(f: FormData): Promise<void> {
  await versuchen(f, fristSetzen)
}
export async function benutzerAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, benutzerAnlegen)
}
export async function benutzerUmschaltenAktion(f: FormData): Promise<void> {
  await versuchen(f, benutzerUmschalten)
}
export async function rolleZuweisenAktion(f: FormData): Promise<void> {
  await versuchen(f, rolleZuweisen)
}
export async function rolleEntziehenAktion(f: FormData): Promise<void> {
  await versuchen(f, rolleEntziehen)
}
export async function zustaendigkeitSetzenAktion(f: FormData): Promise<void> {
  await versuchen(f, zustaendigkeitSetzen)
}
export async function zustaendigkeitBeendenAktion(f: FormData): Promise<void> {
  await versuchen(f, zustaendigkeitBeenden)
}
