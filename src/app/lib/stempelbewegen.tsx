'use client'

/**
 * Ein Stempel, den man anfassen kann.
 *
 * Ziehen mit der Maus, Skalieren an der Ecke rechts unten, Pfeiltasten für
 * die Position (⇧ + Pfeil für die Größe), Auswahl der Seite — und dann
 * **Übernehmen**. Nichts wird beim Loslassen still gespeichert: Wer den
 * Stempel um zwei Millimeter verschiebt, soll es sehen und bestätigen, nicht
 * beim Scrollen versehentlich auslösen.
 *
 * **Was hier geprüft wird, und was nicht.** Die Komponente zeigt an, ob die
 * gewählte Lage Text berührt oder über den Rand ragt — rot, mit Satz. Das ist
 * Rückmeldung, keine Grenze: Die Grenze zieht der Trigger in der Datenbank
 * (Migration 20260922120000), und der weist auch ab, was hier grün aussah.
 *
 * **Warum die Handler `unknown` nehmen.** `tsconfig.json` setzt
 * `lib: ["ES2023"]` ohne `DOM` — ein Riegel, damit Servercode `document`
 * und `window` nicht anfassen kann. Zeigerkoordinaten brauchen `clientX`;
 * die DOM-Typen dafür gibt es nicht, und Reacts `PointerEventHandler` ist
 * ohne sie ein Fehlertyp, dem nichts zuweisbar ist — außer einem Handler,
 * der `unknown` nimmt. Der deutet das Ereignis an **einer** Stelle als
 * `Zeiger`: genau die vier Dinge, die hier gelesen werden. Der Riegel bleibt
 * zu; was hier vom Ereignis angenommen wird, steht in einer Schnittstelle
 * und nicht verstreut in Zugriffen.
 */

import { useState } from 'react'
import { stempelVerschiebenAktion } from '@/app/lib/layer-aktionen'
import { STEMPEL_MINDESTMASSE, STEMPEL_RAND, STEMPEL_TEXTABSTAND } from '@/layer/platzierung'
import type { Kasten } from '@/layer/platzierung'

interface Zeiger {
  clientX: number
  clientY: number
  pointerId: number
  preventDefault(): void
  currentTarget: {
    setPointerCapture(id: number): void
    releasePointerCapture(id: number): void
    parentElement: { getBoundingClientRect(): { width: number } } | null
  }
}

interface Taste {
  key: string
  shiftKey: boolean
  preventDefault(): void
}

/** Schrittweite der Tastatur, in Punkten: ein Rasterschritt des Workers. */
const SCHRITT = 4

export interface Stempeldaten {
  id: string
  seite: number
  x: number
  y: number
  breite: number
  hoehe: number
  text: string | null
  farbe: string | null
}

export function Stempelbewegen({
  stempel,
  seitenBreite,
  seitenHoehe,
  textkaesten,
  seitenzahl,
  dokumentId,
}: {
  stempel: Stempeldaten
  seitenBreite: number
  seitenHoehe: number
  textkaesten: Kasten[]
  seitenzahl: number
  dokumentId: string
}) {
  const [lage, setLage] = useState({
    x: stempel.x,
    y: stempel.y,
    breite: stempel.breite,
    hoehe: stempel.hoehe,
  })
  const [seite, setSeite] = useState(stempel.seite)
  const [griff, setGriff] = useState<{
    art: 'ziehen' | 'skalieren'
    startX: number
    startY: number
    lage: typeof lage
    faktor: number
  } | null>(null)

  const geaendert =
    lage.x !== stempel.x ||
    lage.y !== stempel.y ||
    lage.breite !== stempel.breite ||
    lage.hoehe !== stempel.hoehe ||
    seite !== stempel.seite

  const hinweis = pruefen(lage, seitenBreite, seitenHoehe, textkaesten)

  const prozent = {
    left: `${(lage.x / seitenBreite) * 100}%`,
    top: `${(lage.y / seitenHoehe) * 100}%`,
    width: `${(lage.breite / seitenBreite) * 100}%`,
    height: `${(lage.hoehe / seitenHoehe) * 100}%`,
  }

  const teile = (stempel.text ?? '').split(' · ')
  const entscheidung = teile[0] ?? ''
  const beleg = teile.slice(1).join(' · ')
  const farbe = hinweis === null ? (stempel.farbe ?? '#3B4A80') : '#B3271E'

  const anfassen = (art: 'ziehen' | 'skalieren') => (roh: unknown) => {
    const e = roh as Zeiger
    e.preventDefault()
    const breitePx = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
    if (breitePx <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // Punkte je Bildschirmpixel: Das Seitenbild ist `width: 100%`, die Seite
    // hat `seitenBreite` Punkte -- das Verhältnis ist der Maßstab.
    setGriff({ art, startX: e.clientX, startY: e.clientY, lage, faktor: seitenBreite / breitePx })
  }

  const bewegen = (roh: unknown) => {
    const e = roh as Zeiger
    if (griff === null) return
    const dx = (e.clientX - griff.startX) * griff.faktor
    const dy = (e.clientY - griff.startY) * griff.faktor
    if (griff.art === 'ziehen') {
      setLage({ ...griff.lage, x: runden(griff.lage.x + dx), y: runden(griff.lage.y + dy) })
    } else {
      setLage({
        ...griff.lage,
        breite: Math.max(STEMPEL_MINDESTMASSE.breite, runden(griff.lage.breite + dx)),
        hoehe: Math.max(STEMPEL_MINDESTMASSE.hoehe, runden(griff.lage.hoehe + dy)),
      })
    }
  }

  const loslassen = (roh: unknown) => {
    const e = roh as Zeiger
    if (griff === null) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setGriff(null)
  }

  const taste = (e: Taste) => {
    const richtung: Record<string, [number, number]> = {
      ArrowLeft: [-SCHRITT, 0],
      ArrowRight: [SCHRITT, 0],
      ArrowUp: [0, -SCHRITT],
      ArrowDown: [0, SCHRITT],
    }
    const d = richtung[e.key]
    if (d === undefined) return
    e.preventDefault()
    if (e.shiftKey) {
      setLage((l) => ({
        ...l,
        breite: Math.max(STEMPEL_MINDESTMASSE.breite, l.breite + d[0]),
        hoehe: Math.max(STEMPEL_MINDESTMASSE.hoehe, l.hoehe + d[1]),
      }))
    } else {
      setLage((l) => ({ ...l, x: l.x + d[0], y: l.y + d[1] }))
    }
  }

  return (
    <>
      <div
        role="group"
        aria-label={`Stempel ${entscheidung}, verschiebbar. Pfeiltasten bewegen, mit Umschalt skalieren.`}
        tabIndex={0}
        onPointerDown={anfassen('ziehen')}
        onPointerMove={bewegen}
        onPointerUp={loslassen}
        onKeyDown={taste}
        style={{
          ...prozent,
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.78)',
          border: `0.18rem ${geaendert ? 'dashed' : 'solid'} ${farbe}`,
          borderRadius: '0.2rem',
          boxSizing: 'border-box',
          color: farbe,
          cursor: griff?.art === 'ziehen' ? 'grabbing' : 'grab',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '0.15rem 0.3rem',
          pointerEvents: 'auto',
          position: 'absolute',
          touchAction: 'none',
          transform: 'rotate(-3deg)',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 'clamp(0.55rem, 1.15vw, 1rem)',
            fontWeight: 700,
            letterSpacing: '0.02em',
            lineHeight: 1.1,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {entscheidung}
        </span>
        {beleg !== '' && (
          <span style={{ fontSize: 'clamp(0.4rem, 0.7vw, 0.62rem)', lineHeight: 1.2, opacity: 0.85, whiteSpace: 'nowrap' }}>
            {beleg}
          </span>
        )}
        {/* Der Griff zum Skalieren: rechts unten, wie man es kennt. */}
        <span
          aria-hidden="true"
          onPointerDown={anfassen('skalieren')}
          style={{
            bottom: 0,
            cursor: 'nwse-resize',
            height: '0.9rem',
            position: 'absolute',
            right: 0,
            width: '0.9rem',
            background: `linear-gradient(135deg, transparent 50%, ${farbe} 50%)`,
          }}
        />
      </div>

      {/*
        Die Leiste unter dem Stempel. Auch als Formular, damit die Tastatur
        allein genügt: Seite wählen, Übernehmen -- ohne Maus.
      */}
      <form
        action={stempelVerschiebenAktion}
        style={{
          left: prozent.left,
          top: `calc(${prozent.top} + ${prozent.height} + 0.3rem)`,
          alignItems: 'center',
          background: '#fff',
          border: '1px solid #bbb',
          borderRadius: '0.2rem',
          display: 'flex',
          fontSize: '0.75rem',
          gap: '0.4rem',
          padding: '0.25rem 0.4rem',
          pointerEvents: 'auto',
          position: 'absolute',
          zIndex: 2,
        }}
      >
        <input type="hidden" name="dokumentId" value={dokumentId} />
        <input type="hidden" name="layerId" value={stempel.id} />
        <input type="hidden" name="x" value={lage.x} />
        <input type="hidden" name="y" value={lage.y} />
        <input type="hidden" name="breite" value={lage.breite} />
        <input type="hidden" name="hoehe" value={lage.hoehe} />
        <label>
          Seite{' '}
          <select
            name="seite"
            value={seite}
            onChange={(roh: unknown) =>
              setSeite(Number((roh as { target: { value: string } }).target.value))
            }
            style={{ font: 'inherit' }}
          >
            {Array.from({ length: seitenzahl }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value={0}>Leerseite</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={!geaendert}
          style={{ cursor: geaendert ? 'pointer' : 'default', font: 'inherit', padding: '0.15rem 0.5rem' }}
        >
          Übernehmen
        </button>
        {hinweis !== null && <span style={{ color: '#B3271E' }}>{hinweis}</span>}
      </form>
    </>
  )
}

function runden(wert: number): number {
  return Math.round(wert)
}

/**
 * Die Vorschau der Prüfung -- derselbe Maßstab wie in `app.stempel_lage_pruefen`,
 * damit Rot hier auch Rot dort heißt. Die Datenbank prüft trotzdem selbst.
 */
function pruefen(
  l: { x: number; y: number; breite: number; hoehe: number },
  seitenBreite: number,
  seitenHoehe: number,
  textkaesten: Kasten[],
): string | null {
  if (l.breite < STEMPEL_MINDESTMASSE.breite || l.hoehe < STEMPEL_MINDESTMASSE.hoehe) {
    return 'Zu klein, um lesbar zu bleiben.'
  }
  if (
    l.x < STEMPEL_RAND ||
    l.y < STEMPEL_RAND ||
    l.x + l.breite > seitenBreite - STEMPEL_RAND ||
    l.y + l.hoehe > seitenHoehe - STEMPEL_RAND
  ) {
    return 'Ragt über den Seitenrand.'
  }
  const a = STEMPEL_TEXTABSTAND
  for (const k of textkaesten) {
    if (l.x < k.x + k.breite + a && l.x + l.breite > k.x - a && l.y < k.y + k.hoehe + a && l.y + l.hoehe > k.y - a) {
      return 'Hier steht Text.'
    }
  }
  return null
}
