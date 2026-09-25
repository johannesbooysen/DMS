/**
 * Belegart aus dem Inhalt erkennen.
 *
 * Bis hierher kam die Belegart vom Eingangsweg: Ein Upload war eine
 * Rechnung, eine Eingangsquelle trug ihre Belegart als Stammdatum. Ein
 * Angebot oder eine Mahnung lief damit als Rechnung durch die sachliche
 * Pruefung -- und fiel erst auf, wenn jemand nach der Rechnungsnummer
 * suchte, die es nicht gibt.
 *
 * Dieselbe Bauart wie bei Objekt und Kategorie (`zuordnung.ts`,
 * `kategorie.ts`): deterministische Woerter, gewichtet, und eine Ampel.
 * Kein Modell -- die Belegart steht auf dem Papier, meist in der ersten
 * Zeile, und ein Modell wuerde raten, wo Lesen genuegt.
 *
 * Die Reihenfolge ist die eigentliche Aussage:
 *
 *   1. **Mahnung und Gutschrift schlagen Rechnung.** Beide nennen die
 *      Rechnung, auf die sie sich beziehen -- das Wort "Rechnung" allein
 *      macht daraus keine.
 *   2. **Rechnung schlaegt Schriftverkehr**, sobald eine Rechnungsnummer
 *      oder ein Rechnungsdatum da ist: Ein Schreiben hat keine.
 *   3. **Schriftverkehr** braucht ein starkes Merkmal (Angebot,
 *      Kostenvoranschlag, Auftragsbestaetigung, Lieferschein,
 *      Maengelanzeige, Kuendigung). "Sehr geehrte Damen und Herren" steht
 *      auf jeder zweiten Rechnung und zaehlt deshalb kaum.
 *
 * **Gruen wird nur, was eindeutig ist**: ein klarer Sieger mit Abstand.
 * Alles andere ist ein Hinweis, der am Beleg steht, aber nichts umstellt.
 * Und der Kopf des Belegs zaehlt doppelt: Was oben steht, ist der Titel.
 */

export type ErkennbareBelegart = 'rechnung' | 'gutschrift' | 'mahnung' | 'schriftverkehr'

export interface Belegartvorschlag {
  belegart: ErkennbareBelegart | null
  sicherheit: 'gruen' | 'orange' | 'rot'
  /** Fuer Anzeige und Protokoll: "erkannt am Inhalt: „Mahnung“, „Mahngebühr“". */
  begruendung: string
  /** Punkte je Belegart -- fuer Tests und die Anzeige der Unsicherheit. */
  punkte: Record<ErkennbareBelegart, number>
}

interface Merkmal {
  muster: RegExp
  gewicht: number
  /** Wie das Merkmal in der Begruendung heisst. */
  name: string
}

const MERKMALE: Record<ErkennbareBelegart, Merkmal[]> = {
  mahnung: [
    { muster: /\bmahnung\b/i, gewicht: 3, name: 'Mahnung' },
    { muster: /zahlungserinnerung/i, gewicht: 3, name: 'Zahlungserinnerung' },
    { muster: /mahngeb[üu]hr/i, gewicht: 2, name: 'Mahngebühr' },
    { muster: /verzugszins/i, gewicht: 2, name: 'Verzugszinsen' },
    { muster: /inkasso/i, gewicht: 2, name: 'Inkasso' },
    { muster: /[üu]berf[äa]llig/i, gewicht: 1, name: 'überfällig' },
    { muster: /noch nicht (bei uns )?eingegangen|kein(en)? zahlungseingang/i, gewicht: 1, name: 'kein Zahlungseingang' },
  ],
  gutschrift: [
    { muster: /\bgutschrift\b/i, gewicht: 3, name: 'Gutschrift' },
    { muster: /gutschrifts?(nummer|-?nr|betrag)/i, gewicht: 2, name: 'Gutschriftsnummer' },
    { muster: /stornorechnung|rechnungskorrektur/i, gewicht: 3, name: 'Rechnungskorrektur' },
    { muster: /credit note/i, gewicht: 3, name: 'Credit Note' },
  ],
  rechnung: [
    { muster: /\brechnung\b/i, gewicht: 1, name: 'Rechnung' },
    { muster: /rechnungs\s?(nummer|-?nr)/i, gewicht: 2, name: 'Rechnungsnummer' },
    { muster: /rechnungsdatum/i, gewicht: 2, name: 'Rechnungsdatum' },
    { muster: /\binvoice\b/i, gewicht: 2, name: 'Invoice' },
    { muster: /zahlbar (bis|innerhalb|sofort)|zahlungsziel|f[äa]llig am/i, gewicht: 1, name: 'Zahlungsziel' },
    { muster: /ust-?id|umsatzsteuer|mwst|netto|brutto/i, gewicht: 1, name: 'Steuerangaben' },
  ],
  schriftverkehr: [
    { muster: /\bangebot(s|-)?(nummer|nr\.?|\b)/i, gewicht: 3, name: 'Angebot' },
    { muster: /kostenvoranschlag/i, gewicht: 3, name: 'Kostenvoranschlag' },
    { muster: /auftragsbest[äa]tigung/i, gewicht: 3, name: 'Auftragsbestätigung' },
    { muster: /lieferschein/i, gewicht: 3, name: 'Lieferschein' },
    { muster: /m[äa]ngelanzeige|m[äa]ngelr[üu]ge|schadensmeldung/i, gewicht: 3, name: 'Mängelanzeige' },
    { muster: /k[üu]ndigung/i, gewicht: 2, name: 'Kündigung' },
    { muster: /\bprotokoll\b|einladung zur/i, gewicht: 2, name: 'Protokoll oder Einladung' },
    { muster: /sehr geehrte|mit freundlichen gr[üu]ßen/i, gewicht: 1, name: 'Anschreiben' },
  ],
}

/** Wie viele Zeichen vom Anfang der ersten Seite als Kopf gelten -- dort steht der Titel. */
const KOPFLAENGE = 400

const NAMEN: Record<ErkennbareBelegart, string> = {
  rechnung: 'Rechnung',
  gutschrift: 'Gutschrift',
  mahnung: 'Mahnung',
  schriftverkehr: 'Schriftverkehr',
}

export function belegartName(belegart: string): string {
  return (NAMEN as Record<string, string>)[belegart] ?? belegart
}

export function belegartErkennen(seiten: ReadonlyArray<{ seite: number; text: string }>): Belegartvorschlag {
  // Die ersten beiden Seiten genuegen: Der Titel steht vorn, und ein
  // zwanzigseitiges Protokoll nennt irgendwo auch eine Rechnung.
  const text = [...seiten]
    .sort((a, b) => a.seite - b.seite)
    .slice(0, 2)
    .map((s) => s.text)
    .join('\n')
  const kopf = text.slice(0, KOPFLAENGE)

  const punkte: Record<ErkennbareBelegart, number> = { rechnung: 0, gutschrift: 0, mahnung: 0, schriftverkehr: 0 }
  const treffer: Record<ErkennbareBelegart, string[]> = { rechnung: [], gutschrift: [], mahnung: [], schriftverkehr: [] }

  for (const art of Object.keys(MERKMALE) as ErkennbareBelegart[]) {
    for (const m of MERKMALE[art]) {
      if (!m.muster.test(text)) continue
      punkte[art] += m.gewicht * (m.muster.test(kopf) ? 2 : 1)
      treffer[art].push(m.name)
    }
  }

  // Mahnung und Gutschrift beziehen sich auf eine Rechnung und nennen sie.
  // Steht eins von beiden klar da, zaehlt "Rechnung" nicht dagegen.
  const rangfolge: ErkennbareBelegart[] = ['mahnung', 'gutschrift', 'rechnung', 'schriftverkehr']
  const geordnet = rangfolge
    .map((art) => ({ art, p: punkte[art] }))
    .sort((a, b) => b.p - a.p || rangfolge.indexOf(a.art) - rangfolge.indexOf(b.art))
  const sieger = geordnet[0]!
  const zweiter = geordnet[1]!

  const gewinnt = (art: ErkennbareBelegart, mindestens: number) => punkte[art] >= mindestens
  let belegart: ErkennbareBelegart | null = null
  if (gewinnt('mahnung', 3)) belegart = 'mahnung'
  else if (gewinnt('gutschrift', 3)) belegart = 'gutschrift'
  else if (gewinnt('rechnung', 3) && punkte.rechnung >= punkte.schriftverkehr) belegart = 'rechnung'
  else if (gewinnt('schriftverkehr', 3)) belegart = 'schriftverkehr'
  else if (sieger.p >= 2) belegart = sieger.art

  if (belegart === null) {
    return { belegart: null, sicherheit: 'rot', begruendung: 'kein Merkmal einer Belegart im Text', punkte }
  }

  const konkurrent = geordnet.find((g) => g.art !== belegart) ?? zweiter
  const eindeutig =
    punkte[belegart] >= 3 &&
    (punkte[belegart] - konkurrent.p >= 2 ||
      // Mahnung und Gutschrift nennen die Rechnung; deren Punkte sind kein Widerspruch.
      ((belegart === 'mahnung' || belegart === 'gutschrift') && konkurrent.art === 'rechnung' && punkte[belegart] >= 4))
  const woerter = treffer[belegart].map((n) => `„${n}“`).join(', ')
  return {
    belegart,
    sicherheit: eindeutig ? 'gruen' : 'orange',
    begruendung: eindeutig
      ? `erkannt am Inhalt: ${woerter}`
      : `unsicher erkannt: ${woerter} — aber auch ${NAMEN[konkurrent.art]} möglich`,
    punkte,
  }
}
