/**
 * Wohin ein Stempel auf der Seite darf.
 *
 * Konzept 16: „Der Renderer sucht auf der ersten Seite den größten freien
 * Block ab einer Mindestgröße, bevorzugt rechts oben, dann rechts unten, dann
 * eine angehängte Leerseite. **Kein Stempel überdeckt Text.**"
 *
 * Der letzte Satz ist die eigentliche Anforderung. Ein Stempel, der den
 * Rechnungsbetrag verdeckt, macht aus einer Prüfung eine Behauptung — und
 * weil das Original nie verändert wird, fiele es erst beim Export auf.
 *
 * Reine Rechnung, absichtlich ohne Datenbank und ohne PDF-Bibliothek: Die
 * Fundstellen kommen aus `seitenLesen`, das Ergebnis geht in
 * `dokument_seite.freie_bloecke`. Gerechnet wird **einmal** bei der
 * Aufbereitung, nicht bei jedem Stempel — im Worker, wo PDF-Arbeit hingehört.
 */

/** Ursprung oben links, in PDF-Punkten — wie `seitenLesen` es liefert. */
export interface Kasten {
  x: number
  y: number
  breite: number
  hoehe: number
}

/** Maße eines Stempels. Groß genug für Typ, Name und Datum. */
export const STEMPEL_BREITE = 190
export const STEMPEL_HOEHE = 64

/** Abstand zum Seitenrand und zu jedem Textstück. */
const RAND = 12
const TEXTABSTAND = 6

/**
 * Kantenlänge einer Rasterzelle.
 *
 * 4 Punkte ≈ 1,4 mm. Feiner brächte nichts: Der Textabstand oben ist
 * gröber, und die Rasterung ist ohnehin die konservative Richtung — eine
 * halb belegte Zelle gilt als belegt, nie umgekehrt.
 */
const ZELLE = 4

/** Wie viele Plätze höchstens vorgemerkt werden. */
const HOECHSTZAHL = 8

/**
 * Freie Plätze für Stempel, in der Reihenfolge, in der sie benutzt werden
 * sollen. Leer heißt: Die Seite ist voll, es braucht eine Leerseite.
 */
export function freieBloecke(
  seitenbreite: number,
  seitenhoehe: number,
  belegt: Kasten[],
  masse: { breite: number; hoehe: number } = {
    breite: STEMPEL_BREITE,
    hoehe: STEMPEL_HOEHE,
  },
): Kasten[] {
  if (seitenbreite <= 0 || seitenhoehe <= 0) return []
  if (masse.breite + 2 * RAND > seitenbreite) return []
  if (masse.hoehe + 2 * RAND > seitenhoehe) return []

  const spalten = Math.ceil(seitenbreite / ZELLE)
  const zeilen = Math.ceil(seitenhoehe / ZELLE)

  /*
   * Summierte Flaechentabelle statt Ueberlappungstest je Kandidat.
   *
   * Ohne sie waere jeder der einigen tausend Kandidaten gegen jedes der
   * einigen hundert Textstuecke zu pruefen. Mit ihr kostet die Frage "ist
   * dieses Rechteck frei" vier Additionen -- unabhaengig davon, wie voll die
   * Seite ist.
   */
  const summe = summentabelle(spalten, zeilen, belegt)

  const kandidaten: Array<{ kasten: Kasten; rang: number }> = []
  const schritt = 2 * ZELLE

  for (let y = RAND; y + masse.hoehe <= seitenhoehe - RAND; y += schritt) {
    for (let x = RAND; x + masse.breite <= seitenbreite - RAND; x += schritt) {
      if (!istFrei(summe, spalten, zeilen, x, y, masse.breite, masse.hoehe)) continue
      kandidaten.push({
        kasten: { x, y, breite: masse.breite, hoehe: masse.hoehe },
        rang: rang(x, y, masse, seitenbreite, seitenhoehe),
      })
    }
  }

  kandidaten.sort((a, b) => a.rang - b.rang)

  // Ueberschneidungsfrei auswaehlen: Zwei Stempel duerfen sich so wenig
  // ueberdecken wie ein Stempel den Text.
  const gewaehlt: Kasten[] = []
  for (const k of kandidaten) {
    if (gewaehlt.length >= HOECHSTZAHL) break
    if (gewaehlt.some((g) => ueberschneidet(g, k.kasten))) continue
    gewaehlt.push(k.kasten)
  }
  return gewaehlt
}

/**
 * Je kleiner, desto lieber.
 *
 * Rechts oben zuerst, dann rechts unten — so steht es im Konzept. Innerhalb
 * einer Haelfte zaehlt der Abstand zur bevorzugten Ecke, damit ein Stempel
 * am Rand klebt und nicht mitten in einer freien Flaeche schwebt.
 */
function rang(
  x: number,
  y: number,
  masse: { breite: number; hoehe: number },
  seitenbreite: number,
  seitenhoehe: number,
): number {
  const rechterRand = seitenbreite - (x + masse.breite)
  const obenLinks = y
  const untenLinks = seitenhoehe - (y + masse.hoehe)

  // Obere Haelfte gewinnt gegen untere, und zwar deutlich: Der Zuschlag ist
  // groesser als jeder Abstand innerhalb einer Haelfte werden kann.
  const haelfte = y + masse.hoehe / 2 < seitenhoehe / 2 ? 0 : 10 * (seitenbreite + seitenhoehe)
  const ecke = haelfte === 0 ? obenLinks : untenLinks

  return haelfte + rechterRand * 2 + ecke
}

function summentabelle(spalten: number, zeilen: number, belegt: Kasten[]): Int32Array {
  // Eine Zeile und eine Spalte mehr, damit der Zugriff ohne Sonderfaelle
  // auskommt.
  const tabelle = new Int32Array((spalten + 1) * (zeilen + 1))

  for (const k of belegt) {
    if (k.breite <= 0 || k.hoehe <= 0) continue
    const vonX = klemme(Math.floor((k.x - TEXTABSTAND) / ZELLE), 0, spalten - 1)
    const bisX = klemme(Math.ceil((k.x + k.breite + TEXTABSTAND) / ZELLE), 0, spalten)
    const vonY = klemme(Math.floor((k.y - TEXTABSTAND) / ZELLE), 0, zeilen - 1)
    const bisY = klemme(Math.ceil((k.y + k.hoehe + TEXTABSTAND) / ZELLE), 0, zeilen)

    for (let zy = vonY; zy < bisY; zy += 1) {
      for (let zx = vonX; zx < bisX; zx += 1) {
        tabelle[(zy + 1) * (spalten + 1) + (zx + 1)] = 1
      }
    }
  }

  for (let zy = 1; zy <= zeilen; zy += 1) {
    for (let zx = 1; zx <= spalten; zx += 1) {
      const i = zy * (spalten + 1) + zx
      tabelle[i] +=
        tabelle[i - 1] + tabelle[i - (spalten + 1)] - tabelle[i - (spalten + 1) - 1]
    }
  }
  return tabelle
}

function istFrei(
  summe: Int32Array,
  spalten: number,
  zeilen: number,
  x: number,
  y: number,
  breite: number,
  hoehe: number,
): boolean {
  const vonX = klemme(Math.floor(x / ZELLE), 0, spalten)
  const bisX = klemme(Math.ceil((x + breite) / ZELLE), 0, spalten)
  const vonY = klemme(Math.floor(y / ZELLE), 0, zeilen)
  const bisY = klemme(Math.ceil((y + hoehe) / ZELLE), 0, zeilen)

  const b = spalten + 1
  const belegteZellen =
    summe[bisY * b + bisX] -
    summe[vonY * b + bisX] -
    summe[bisY * b + vonX] +
    summe[vonY * b + vonX]
  return belegteZellen === 0
}

export function ueberschneidet(a: Kasten, b: Kasten): boolean {
  return (
    a.x < b.x + b.breite &&
    b.x < a.x + a.breite &&
    a.y < b.y + b.hoehe &&
    b.y < a.y + a.hoehe
  )
}

function klemme(wert: number, klein: number, gross: number): number {
  return Math.max(klein, Math.min(gross, wert))
}
