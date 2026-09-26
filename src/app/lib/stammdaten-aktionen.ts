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
import { pflichtfelderSetzen } from '@/stammdaten/pflichtfeld'
import { vorschlagUebernehmen, vorschlagVerwerfen, vorschlagZuordnen } from '@/stammdaten/kreditor-vorschlag'
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
  kreditorEmailSetzen,
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
import {
  ablaufSetzen,
  kreditorStandardSetzen,
  zuordnungSetzen,
} from '@/stammdaten/kategorien'
import { quelleAnlegen, quelleUmschalten, vorlageAnlegen, vorlageSpeichern, vorlageUmschalten } from '@/stammdaten/quellen'
import { gestaltungSetzen, stempeltypAnlegen, stempeltypUmschalten } from '@/stammdaten/stempel'
import {
  anwenden as presetAnwenden,
  NichtErlaubt as PresetNichtErlaubt,
  NichtMoeglich as PresetNichtMoeglich,
} from '@/stammdaten/presets'
import { alsBenutzer } from '@/db'
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
export async function kreditorEmailAktion(f: FormData): Promise<void> {
  await versuchen(f, kreditorEmailSetzen)
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

// ---------------------------------------------------------------------------
// Eingangsquellen und Vorlagen
// ---------------------------------------------------------------------------

export async function quelleAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, quelleAnlegen)
}
export async function quelleUmschaltenAktion(f: FormData): Promise<void> {
  await versuchen(f, quelleUmschalten)
}
export async function vorlageSpeichernAktion(f: FormData): Promise<void> {
  await versuchen(f, vorlageSpeichern)
}
export async function vorlageAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, vorlageAnlegen)
}
export async function vorlageUmschaltenAktion(f: FormData): Promise<void> {
  await versuchen(f, vorlageUmschalten)
}

/**
 * Ein Berechtigungs-Preset anwenden (Konzept §24.13).
 *
 * Ergänzt, nimmt nichts weg, und ist beim zweiten Mal wirkungslos. Die
 * Bilanz landet als lesbarer Hinweis in der Umleitung — vor allem die
 * Stempelkurzcodes, zu denen es keinen Typ gibt: Ohne sie stehen zwar
 * Rollen da, aber niemand kann etwas stempeln, und das fiele sonst erst
 * beim ersten feststeckenden Beleg auf.
 */
export async function presetAnwendenAktion(f: FormData): Promise<void> {
  const presetId = String(f.get('preset') ?? '')
  const ziel = '/stammdaten/benutzer'
  try {
    const bilanz = await alsBenutzer(await angemeldeterBenutzer(), (c) =>
      presetAnwenden(c, presetId),
    )
    const teile = [
      bilanz.rollenAngelegt.length > 0
        ? `Rollen angelegt: ${bilanz.rollenAngelegt.join(', ')}`
        : 'Keine neue Rolle nötig',
      `${bilanz.rechteAngelegt} Rechte und ${bilanz.stempelrechteAngelegt} Stempelzuordnungen ergänzt`,
    ]
    if (bilanz.ohneStempeltyp.length > 0) {
      teile.push(`Ohne Stempeltyp geblieben: ${bilanz.ohneStempeltyp.join(', ')}`)
    }
    revalidatePath(ziel)
    redirect(`${ziel}?hinweis=${encodeURIComponent(teile.join('. ') + '.')}`)
  } catch (fehler) {
    if (fehler instanceof PresetNichtErlaubt || fehler instanceof PresetNichtMoeglich) {
      redirect(`${ziel}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
}

/*
 * Kategorien und ihre Steuerung.
 *
 * Zwei Handlungen und nicht eine, weil dahinter zwei Rechte stehen:
 * Spezialgebiet, Konto und Schluesselworte sind Stammdatenpflege -- welcher
 * Ablauf gilt, ist Ablaufkonfiguration. Zusammengelegt wuerde das Speichern
 * einer Farbe an einem fehlenden Ablaufrecht scheitern.
 */
export async function kategorieZuordnungAktion(f: FormData): Promise<void> {
  await versuchen(f, zuordnungSetzen)
}
export async function kategorieAblaufAktion(f: FormData): Promise<void> {
  await versuchen(f, ablaufSetzen)
}
export async function kreditorStandardAktion(f: FormData): Promise<void> {
  await versuchen(f, kreditorStandardSetzen)
}

/*
 * Stempel-Designer.
 *
 * Drei Handlungen unter dem Recht, Ablaeufe zu konfigurieren -- ein
 * Stempeltyp ist Ablaufkonfiguration, kein Stammdatum. Gestaltet wird, was
 * auf dem Stempel steht und wie er aussieht; ein Zielfeld gibt es nicht und
 * wird es nicht geben.
 */
export async function stempeltypAnlegenAktion(f: FormData): Promise<void> {
  await versuchen(f, stempeltypAnlegen)
}
export async function stempelGestaltungAktion(f: FormData): Promise<void> {
  // Die Felder kommen als mehrere Kaestchen gleichen Namens; die Fachschicht
  // erwartet sie kommagetrennt.
  const felder = f.getAll('feld').map(String).join(',')
  f.set('felder', felder)
  await versuchen(f, gestaltungSetzen)
}
export async function stempeltypUmschaltenAktion(f: FormData): Promise<void> {
  await versuchen(f, stempeltypUmschalten)
}

/*
 * Pflichtfelder je Belegart (Konzept 14) -- ein Stammdatum, gesetzt als
 * ganze Liste: Was abgehakt ist, gilt. Nicht ueber `versuchen`, weil
 * Kaestchen mehrere Werte unter einem Namen tragen.
 */
export async function pflichtfelderSetzenAktion(formular: FormData): Promise<void> {
  const belegart = String(formular.get('belegart') ?? 'rechnung')
  const felder = formular.getAll('feld').map(String)
  const ziel = '/stammdaten/pflichtfelder'
  try {
    await pflichtfelderSetzen(await angemeldeterBenutzer(), belegart, felder)
  } catch (fehler) {
    if (fehler instanceof NichtErlaubt || fehler instanceof NichtMoeglich) {
      redirect(`${ziel}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath(ziel)
  redirect(`${ziel}?hinweis=${encodeURIComponent('Pflichtfelder gespeichert.')}`)
}

/*
 * Kreditorvorschlaege (Migration 20260930100000). `zurueck` sagt, wohin:
 * Die Karte steht am Arbeitsplatz zum Beleg und unter Stammdaten.
 */
async function vorschlagVersuchen(formular: FormData, aktion: (benutzerId: string) => Promise<string>): Promise<never> {
  const ziel = String(formular.get('zurueck') ?? '/stammdaten')
  let hinweis: string
  try {
    hinweis = await aktion(await angemeldeterBenutzer())
  } catch (fehler) {
    if (fehler instanceof NichtErlaubt || fehler instanceof NichtMoeglich) {
      redirect(`${ziel}?fehler=${encodeURIComponent(fehler.message)}`)
    }
    throw fehler
  }
  revalidatePath('/stammdaten')
  revalidatePath('/postfach')
  revalidatePath('/arbeitsplatz')
  redirect(`${ziel}?hinweis=${encodeURIComponent(hinweis)}`)
}

export async function kreditorVorschlagUebernehmenAktion(f: FormData): Promise<void> {
  await vorschlagVersuchen(f, async (benutzer) => {
    const { belege } = await vorschlagUebernehmen(benutzer, String(f.get('vorschlagId') ?? ''), {
      name: String(f.get('name') ?? ''),
      ustId: String(f.get('ustId') ?? ''),
      iban: String(f.get('iban') ?? ''),
      email: String(f.get('email') ?? ''),
    })
    return `Kreditor angelegt und ${belege} ${belege === 1 ? 'Beleg' : 'Belege'} zugeordnet. Die IBAN wartet auf Bestätigung.`
  })
}

export async function kreditorVorschlagZuordnenAktion(f: FormData): Promise<void> {
  await vorschlagVersuchen(f, async (benutzer) => {
    const { belege } = await vorschlagZuordnen(benutzer, String(f.get('vorschlagId') ?? ''), String(f.get('kreditorId') ?? ''))
    return `${belege} ${belege === 1 ? 'Beleg' : 'Belege'} dem Kreditor zugeordnet.`
  })
}

export async function kreditorVorschlagVerwerfenAktion(f: FormData): Promise<void> {
  await vorschlagVersuchen(f, async (benutzer) => {
    await vorschlagVerwerfen(benutzer, String(f.get('vorschlagId') ?? ''))
    return 'Vorschlag verworfen.'
  })
}
