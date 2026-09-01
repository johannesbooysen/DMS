/**
 * Layer in das ausgelieferte Bild einbrennen.
 *
 * **Warum ins Bild und nicht ins PDF:** Ein schwarzes Rechteck in einem PDF
 * liegt nur *darauf*. Der Text darunter bleibt im Dokument und lässt sich
 * markieren, kopieren oder mit jedem Werkzeug auslesen — so sind schon
 * Behörden und Kanzleien aufgefallen. Ein WebP hat keinen Textlayer: Was
 * übermalt ist, ist weg.
 *
 * Deshalb geht ein geschwärzter Beleg nach draußen nur als Bild. Die Sperre
 * dafür steht in `app.hat_schwaerzung`.
 *
 * Das Original wird dabei nie verändert (Konzept 16) — gezeichnet wird auf
 * eine Kopie des vorgerenderten WebP, im Augenblick der Auslieferung.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas'

export interface Einbrennlayer {
  typ: string
  /** In PDF-Punkten, Ursprung oben links. */
  x: number
  y: number
  breite: number
  hoehe: number
  text: string | null
}

/**
 * Zeichnet Schwärzungen, Hervorhebungen und Stempel auf das Seitenbild.
 *
 * `seitenbreite` ist die Breite der PDF-Seite in Punkten. Das Bild wurde mit
 * einer anderen Breite gerendert (`BREITE_LESEN`), deshalb wird jede
 * Koordinate umgerechnet. Ohne diesen Faktor läge die Schwärzung an der
 * falschen Stelle — und damit über dem Falschen.
 */
export async function layerEinbrennen(
  bild: Buffer,
  layer: Einbrennlayer[],
  seitenbreite: number,
): Promise<Buffer> {
  if (layer.length === 0) return bild

  /*
   * Ohne bekannte Seitenbreite laesst sich nichts umrechnen. Was dann?
   *
   * Die Antwort haengt davon ab, was verloren ginge. Eine Hervorhebung an der
   * falschen Stelle ist haesslich; eine **Schwaerzung** an der falschen
   * Stelle zeigt genau das, was verdeckt werden sollte. Deshalb zwei
   * verschiedene Ausgaenge:
   *
   *   * Ist eine Schwaerzung dabei, geht gar nichts hinaus.
   *   * Sonst wird das Bild ohne Layer geliefert -- unvollstaendig, aber
   *     nicht falsch.
   *
   * Der Fall tritt bei Belegen auf, deren Seitenmasse nicht erfasst sind:
   * Altbestand, uebernommene Daten, ein abgebrochener Aufbereitungslauf.
   */
  if (!(seitenbreite > 0)) {
    if (layer.some((l) => l.typ === 'schwaerzung')) {
      throw new Error(
        'Seitenmaße unbekannt — eine Schwärzung ließe sich nicht sicher platzieren.',
      )
    }
    return bild
  }

  const geladen = await loadImage(bild)
  const faktor = geladen.width / seitenbreite

  const leinwand = createCanvas(geladen.width, geladen.height)
  const stift = leinwand.getContext('2d')
  stift.drawImage(geladen, 0, 0)

  for (const l of layer) {
    const x = l.x * faktor
    const y = l.y * faktor
    const breite = l.breite * faktor
    const hoehe = l.hoehe * faktor

    if (l.typ === 'schwaerzung') {
      // Deckend, nicht halbdurchsichtig. Eine Schwaerzung, durch die man
      // etwas ahnen kann, ist keine.
      stift.fillStyle = '#000000'
      stift.fillRect(x, y, breite, hoehe)
      continue
    }

    if (l.typ === 'highlight') {
      stift.fillStyle = 'rgba(255, 214, 82, 0.38)'
      stift.fillRect(x, y, breite, hoehe)
      continue
    }

    if (l.typ === 'stempel') {
      stempelZeichnen(stift, x, y, breite, hoehe, l.text ?? '', faktor)
    }
  }

  return leinwand.toBuffer('image/webp')
}

/**
 * Ein Stempel als Rahmen mit Text.
 *
 * Bewusst schlicht und ohne Farbe des Stempeltyps: Auf einem
 * Schwarzweiß-Ausdruck ist eine grüne Freigabe von einer roten Ablehnung
 * nicht zu unterscheiden. Was der Stempel sagt, muss dastehen.
 */
function stempelZeichnen(
  stift: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  x: number,
  y: number,
  breite: number,
  hoehe: number,
  text: string,
  faktor: number,
): void {
  stift.save()

  stift.fillStyle = 'rgba(255, 255, 255, 0.86)'
  stift.fillRect(x, y, breite, hoehe)
  stift.strokeStyle = '#3B4A80'
  stift.lineWidth = Math.max(1, 1.5 * faktor)
  stift.strokeRect(x, y, breite, hoehe)

  const groesse = Math.max(8, 9 * faktor)
  stift.fillStyle = '#3B4A80'
  stift.font = `${groesse}px sans-serif`
  stift.textBaseline = 'top'

  const rand = 4 * faktor
  let zeileY = y + rand
  for (const zeile of umbrechen(stift, text, breite - 2 * rand)) {
    if (zeileY + groesse > y + hoehe - rand) break
    stift.fillText(zeile, x + rand, zeileY)
    zeileY += groesse * 1.25
  }

  stift.restore()
}

/** Wortweise umbrechen; was nicht passt, faellt weg statt herauszuragen. */
function umbrechen(
  stift: { measureText(t: string): { width: number } },
  text: string,
  breite: number,
): string[] {
  const zeilen: string[] = []
  let laufend = ''

  for (const wort of text.split(/\s+/).filter((w) => w !== '')) {
    const versuch = laufend === '' ? wort : `${laufend} ${wort}`
    if (stift.measureText(versuch).width <= breite) {
      laufend = versuch
    } else {
      if (laufend !== '') zeilen.push(laufend)
      laufend = wort
    }
  }
  if (laufend !== '') zeilen.push(laufend)
  return zeilen
}
