/**
 * Vorlagen mit Platzhaltern.
 *
 * Konzept 24.2. Der Entwurf folgt der Weißliste aus `src/workflow/bedingung.ts`
 * und aus demselben Grund: **Was hier nicht steht, lässt sich nicht
 * einsetzen.**
 *
 * Eine freie Vorlagensprache wäre bequemer und falsch. Sie könnte den ganzen
 * Belegtext in eine Mail schreiben — an einen Empfänger, den ein Stammdatum
 * bestimmt, in einem Kanal, den niemand mehr einholt. Eine Weißliste
 * beantwortet dagegen jederzeit die Frage, was eine Vorlage höchstens
 * preisgeben kann.
 */

export interface Feldbeschreibung {
  anzeige: string
  /** Wofür der Platzhalter gedacht ist — steht in der Vorlagenverwaltung. */
  hinweis: string
}

/**
 * Die Weißliste.
 *
 * Bewusst schmal. Es fehlen mit Absicht: der Belegtext, die IBAN, der
 * Kontierungsstand. Wer eines davon in einer Mail braucht, hat ein anderes
 * Problem als eine fehlende Vorlage.
 */
export const PLATZHALTER: Record<string, Feldbeschreibung> = {
  kreditor: { anzeige: 'Kreditor', hinweis: 'Name des Rechnungsstellers' },
  rechnungsnummer: { anzeige: 'Rechnungsnummer', hinweis: 'wie auf dem Beleg' },
  betrag: { anzeige: 'Betrag', hinweis: 'Bruttobetrag mit Währung' },
  objekt: { anzeige: 'Objekt', hinweis: 'Objektnummer und Bezeichnung' },
  faellig: { anzeige: 'Fällig', hinweis: 'Zahlungsziel des Belegs' },
  empfaenger: { anzeige: 'Empfänger', hinweis: 'Name der angeschriebenen Person' },
  link: { anzeige: 'Link', hinweis: 'vollständige Adresse, etwa zur Belegeinsicht' },
  gueltig_bis: { anzeige: 'Gültig bis', hinweis: 'Ende einer Einsichtsgewährung' },
  heute: { anzeige: 'Heute', hinweis: 'Datum des Versands' },
}

export type Werte = Partial<Record<keyof typeof PLATZHALTER, string>> &
  Record<string, string | undefined>

const MUSTER = /\{\{\s*([a-z_]+)\s*\}\}/g

export interface Fuellbefund {
  text: string
  /** Platzhalter, die in der Vorlage stehen, aber nicht in der Weißliste. */
  unbekannt: string[]
  /** Platzhalter aus der Weißliste, für die kein Wert vorlag. */
  leer: string[]
}

/**
 * Setzt die Werte ein.
 *
 * Ein **unbekannter** Platzhalter bleibt stehen, statt zu verschwinden. Das
 * ist die unbequemere Wahl und die richtige: Ein Tippfehler in der Vorlage
 * fällt so beim ersten Blick auf die Vorschau auf, statt einer Bank eine Mail
 * mit einer Lücke zu schicken.
 *
 * Ein **bekannter, aber leerer** Platzhalter wird zu einem Strich — der Wert
 * fehlt am Beleg, nicht in der Vorlage.
 */
export function vorlageFuellen(text: string, werte: Werte): Fuellbefund {
  const unbekannt: string[] = []
  const leer: string[] = []

  const gefuellt = text.replace(MUSTER, (ganzes, name: string) => {
    if (!(name in PLATZHALTER)) {
      unbekannt.push(name)
      return ganzes
    }
    const wert = werte[name]
    if (wert === undefined || wert === '') {
      leer.push(name)
      return '—'
    }
    return wert
  })

  return { text: gefuellt, unbekannt: [...new Set(unbekannt)], leer: [...new Set(leer)] }
}

/**
 * Prüft eine Vorlage, bevor sie gespeichert wird.
 *
 * Liefert die Namen, die nicht in der Weißliste stehen. Leer heißt: Die
 * Vorlage lässt sich vollständig füllen.
 */
export function vorlagePruefen(betreff: string, text: string): string[] {
  const gefunden = new Set<string>()
  for (const teil of [betreff, text]) {
    for (const treffer of teil.matchAll(MUSTER)) {
      const name = treffer[1]
      if (!(name in PLATZHALTER)) gefunden.add(name)
    }
  }
  return [...gefunden]
}
