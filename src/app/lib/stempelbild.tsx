/**
 * Das Bild eines Stempels -- an einer Stelle.
 *
 * Drei Orte zeigen einen Stempel im Browser: die Layerschicht auf dem Beleg,
 * der anfassbare Stempel beim Verschieben und die Vorschau im Designer. Der
 * erste Entwurf zeichnete ihn zweimal mit kopierten Stilen; beim dritten Mal
 * waere die Kopie auseinandergelaufen. Deshalb hier -- ohne Hooks, ohne
 * Server-Importe, damit Server- und Client-Komponenten dasselbe einbinden.
 *
 * Der Text kommt als eine Zeile „Entscheidung · Beleg · …" (Trigger). Die
 * erste Stelle traegt, der Rest steht klein darunter -- wie auf einem echten
 * Stempel.
 */

import type { Gestaltung } from '@/layer/gestaltung'

const SCHRIFT: Record<Gestaltung['schrift'], { kopf: string; rest: string }> = {
  klein: { kopf: 'clamp(0.45rem, 0.9vw, 0.8rem)', rest: 'clamp(0.35rem, 0.55vw, 0.5rem)' },
  normal: { kopf: 'clamp(0.55rem, 1.15vw, 1rem)', rest: 'clamp(0.4rem, 0.7vw, 0.62rem)' },
  gross: { kopf: 'clamp(0.7rem, 1.5vw, 1.3rem)', rest: 'clamp(0.5rem, 0.9vw, 0.8rem)' },
}

const RADIUS: Record<Gestaltung['form'], string> = {
  rechteck: '0.2rem',
  abgerundet: '0.9rem',
  oval: '50%',
}

export function rahmenStil(g: Gestaltung, farbe: string): string {
  const art = g.rahmen === 'gestrichelt' ? 'dashed' : g.rahmen === 'doppelt' ? 'double' : 'solid'
  const staerke = g.rahmen === 'doppelt' ? '0.3rem' : '0.18rem'
  return `${staerke} ${art} ${farbe}`
}

/**
 * Die Farbe, in der der Text steht -- dunkel genug, um lesbar zu sein.
 *
 * Der Rahmen traegt die Stempelfarbe unveraendert; der Text nicht immer:
 * Ein Orange wie `#B5741A` erreicht auf fast weissem Grund 3,8:1, und die
 * Barrierefreiheitspruefung verlangt 4,5:1 (WCAG AA). Statt die Farbe des
 * Stempeltyps zu verbieten, wird der Text schrittweise abgedunkelt, bis er
 * das Mass erreicht. Gruen und Rot aus dem Seed bleiben, wie sie sind.
 */
export function lesefarbe(farbe: string): string {
  const treffer = /^#([0-9a-f]{6})$/i.exec(farbe.trim())
  if (treffer === null) return farbe
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(treffer[1]!.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ]
  const kanal = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const kontrast = () => 1.05 / (0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b) + 0.05)
  for (let i = 0; i < 8 && kontrast() < 4.6; i += 1) {
    r = Math.round(r * 0.88)
    g = Math.round(g * 0.88)
    b = Math.round(b * 0.88)
  }
  const hex = (c: number) => c.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function Stempelbild({
  text,
  farbe,
  gestaltung,
  rahmen,
}: {
  text: string
  farbe: string
  gestaltung: Gestaltung
  /** Ueberschreibt den Rahmen -- der bewegliche Stempel zeigt „geaendert" gestrichelt. */
  rahmen?: string
}) {
  const teile = text.split(' · ')
  const kopf = teile[0] ?? ''
  const rest = teile.slice(1).join(' · ')
  const schrift = SCHRIFT[gestaltung.schrift]

  return (
    <div
      style={{
        alignItems: 'center',
        /* Leicht getönt statt weiß: Der Seitentext darunter bleibt ahnbar,
           der Stempel wirkt aufgedrückt und nicht eingefügt. */
        background: 'rgba(255, 255, 255, 0.78)',
        border: rahmen ?? rahmenStil(gestaltung, farbe),
        borderRadius: RADIUS[gestaltung.form],
        boxSizing: 'border-box',
        color: lesefarbe(farbe),
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: gestaltung.form === 'oval' ? '0.15rem 0.9rem' : '0.15rem 0.3rem',
        textAlign: 'center',
        transform: `rotate(${gestaltung.drehung}deg)`,
        width: '100%',
      }}
    >
      <span
        style={{
          fontSize: schrift.kopf,
          fontWeight: 700,
          letterSpacing: '0.02em',
          lineHeight: 1.1,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {kopf}
      </span>
      {rest !== '' && (
        // Ohne `opacity`: Sie hellte die Schrift auf und drueckte den
        // Kontrast unter 4,5:1 -- der Rest ist klein genug, er braucht
        // keine zweite Abschwaechung.
        <span style={{ fontSize: schrift.rest, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {rest}
        </span>
      )}
    </div>
  )
}
