'use client'

/**
 * Stempeln in drei Schritten: wählen, auf dem Beleg platzieren, speichern.
 *
 * Rückmeldung beim Bedienen: „beim Stempeln soll der Stempel optisch auf dem
 * Beleg platziert werden, sobald dies geschehen ist, soll der Vorgang mit
 * Speichern geschlossen werden." Vorher war der Klick auf den Stempelknopf
 * die Entscheidung -- und den Abdruck sah man erst danach, in der
 * Belegansicht, an einer Stelle, die die Datenbank gewählt hatte.
 *
 * **Warum drei Client-Bauteile mit einem gemeinsamen Zustand.** Die Wahl
 * steht rechts bei der Entscheidung, der Abdruck liegt links über dem
 * Seitenbild -- zwei Orte im Baum, ein Zustand (welcher Stempel, wo). Ein
 * React-Kontext trägt ihn: `Stempelsitzung` umschließt Beleg und Formular,
 * `Stempelwahl` sitzt im Formular, `Stempelplatzieren` in der Überlagerung
 * der Seite. Der Belegbetrachter bleibt serverseitig; er rendert nur die
 * Überlagerung mit, und ohne Sitzung darüber zeigt sie nichts.
 *
 * **Was gespeichert wird.** Das Formular bleibt ein gewöhnliches
 * Serverformular: `stempeltypId` und die Lage stehen als verborgene Felder
 * darin, `Speichern` schickt es ab. Die Prüfung der Lage (Mindestmaß, Rand,
 * kein Text, kein anderer Stempel) läuft hier als Rückmeldung und in der
 * Datenbank als Grenze -- dieselbe Regel wie beim Verschieben (ADR 0008).
 *
 * Dieselben `unknown`-Handler wie in `stempelbewegen.tsx`, aus demselben
 * Grund: `lib` ohne `DOM`.
 */

import { createContext, useContext, useState, type ReactNode } from 'react'
import { Stempelbild } from '@/app/lib/stempelbild'
import { lagePruefen } from '@/app/lib/stempelbewegen'
import type { Gestaltung } from '@/layer/gestaltung'
import type { Kasten } from '@/layer/platzierung'
import { STEMPEL_MINDESTMASSE } from '@/layer/platzierung'

export interface Stempelwahlwert {
  stempeltypId: string
  name: string
  entscheidung: string
  farbe: string | null
  kommentarPflicht: boolean
  gestaltung: Gestaltung
  /** Der Text, wie ihn der Trigger setzen wird -- mit heutigem Datum und dem Namen des Handelnden. */
  vorschautext: string
}

/** Was die Seite zum Platzieren hergibt -- null, wenn die Datenbank den Platz wählen muss. */
export interface Platzierung {
  seite: number
  vorschlag: Kasten
  seitenBreite: number
  seitenHoehe: number
  textkaesten: Kasten[]
  /** Schon gesetzte Stempel auf dieser Seite. */
  belegt: Kasten[]
}

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

const SCHRITT = 4

interface Sitzung {
  gewaehlt: Stempelwahlwert | null
  waehlen(s: Stempelwahlwert | null): void
  lage: Kasten
  setLage(l: Kasten | ((l: Kasten) => Kasten)): void
  platzierung: Platzierung | null
  hinweis: string | null
}

const Kontext = createContext<Sitzung | null>(null)

export function Stempelsitzung({
  platzierung,
  children,
}: {
  platzierung: Platzierung | null
  children: ReactNode
}) {
  const [gewaehlt, waehlen] = useState<Stempelwahlwert | null>(null)
  const [lage, setLage] = useState<Kasten>(
    platzierung?.vorschlag ?? { x: 40, y: 40, breite: 190, hoehe: 64 },
  )
  const hinweis =
    platzierung === null
      ? null
      : lagePruefen(lage, platzierung.seitenBreite, platzierung.seitenHoehe, platzierung.textkaesten, platzierung.belegt)
  return (
    <Kontext.Provider value={{ gewaehlt, waehlen, lage, setLage, platzierung, hinweis }}>{children}</Kontext.Provider>
  )
}

/**
 * Die Knöpfe rechts: einen wählen, dann Speichern. Die verborgenen Felder
 * tragen Stempeltyp und Lage ins umgebende Serverformular.
 */
export function Stempelwahl({ stempel }: { stempel: Stempelwahlwert[] }) {
  const s = useContext(Kontext)
  if (s === null) return null
  const { gewaehlt, waehlen, lage, platzierung, hinweis } = s

  return (
    <>
      <div className="stempelknoepfe">
        {stempel.map((k) => {
          const aktiv = gewaehlt?.stempeltypId === k.stempeltypId
          return (
            <button
              key={k.stempeltypId}
              type="button"
              aria-pressed={aktiv}
              onClick={() => waehlen(aktiv ? null : k)}
              style={{
                background: k.farbe ?? '#333',
                outline: aktiv ? '3px solid var(--farbe-akzent)' : undefined,
                outlineOffset: aktiv ? 2 : undefined,
              }}
            >
              {k.name}
            </button>
          )
        })}
      </div>

      {gewaehlt !== null && (
        <div className="stempel-speichern" role="group" aria-label="Stempel speichern">
          <input type="hidden" name="stempeltypId" value={gewaehlt.stempeltypId} />
          {platzierung !== null && (
            <>
              <input type="hidden" name="seite" value={platzierung.seite} />
              <input type="hidden" name="x" value={Math.round(lage.x)} />
              <input type="hidden" name="y" value={Math.round(lage.y)} />
              <input type="hidden" name="breite" value={Math.round(lage.breite)} />
              <input type="hidden" name="hoehe" value={Math.round(lage.hoehe)} />
            </>
          )}
          <p className="klein leise" style={{ margin: '0.5rem 0' }}>
            {platzierung !== null
              ? `„${gewaehlt.name}“ liegt auf dem Beleg. Ziehen Sie ihn an die richtige Stelle, dann Speichern.`
              : `„${gewaehlt.name}“ gewählt. Den Platz auf dem Beleg wählt das System.`}
            {hinweis !== null && (
              <>
                {' '}
                <span style={{ color: 'var(--farbe-rot)' }}>{hinweis}</span>
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="knopf-primaer" disabled={hinweis !== null}>
              Speichern
            </button>
            <button type="button" onClick={() => waehlen(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Der Abdruck über der Seite -- gestrichelt, solange er nicht gespeichert
 * ist; rot, wenn er dort nicht stehen darf. Ziehen, Skalieren an der Ecke,
 * Pfeiltasten wie beim Verschieben.
 */
export function Stempelplatzieren({ seite }: { seite: number }) {
  const s = useContext(Kontext)
  const [griff, setGriff] = useState<{
    art: 'ziehen' | 'skalieren'
    startX: number
    startY: number
    lage: Kasten
    faktor: number
  } | null>(null)
  if (s === null || s.gewaehlt === null || s.platzierung === null || s.platzierung.seite !== seite) return null
  const { gewaehlt, lage, setLage, platzierung, hinweis } = s

  const prozent = {
    left: `${(lage.x / platzierung.seitenBreite) * 100}%`,
    top: `${(lage.y / platzierung.seitenHoehe) * 100}%`,
    width: `${(lage.breite / platzierung.seitenBreite) * 100}%`,
    height: `${(lage.hoehe / platzierung.seitenHoehe) * 100}%`,
  }
  const farbe = hinweis === null ? (gewaehlt.farbe ?? '#3B4A80') : '#B3271E'

  const anfassen = (art: 'ziehen' | 'skalieren') => (roh: unknown) => {
    const e = roh as Zeiger
    e.preventDefault()
    const breitePx = e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
    if (breitePx <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setGriff({ art, startX: e.clientX, startY: e.clientY, lage, faktor: platzierung.seitenBreite / breitePx })
  }
  const bewegen = (roh: unknown) => {
    const e = roh as Zeiger
    if (griff === null) return
    const dx = (e.clientX - griff.startX) * griff.faktor
    const dy = (e.clientY - griff.startY) * griff.faktor
    if (griff.art === 'ziehen') {
      setLage({ ...griff.lage, x: Math.round(griff.lage.x + dx), y: Math.round(griff.lage.y + dy) })
    } else {
      setLage({
        ...griff.lage,
        breite: Math.max(STEMPEL_MINDESTMASSE.breite, Math.round(griff.lage.breite + dx)),
        hoehe: Math.max(STEMPEL_MINDESTMASSE.hoehe, Math.round(griff.lage.hoehe + dy)),
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
    <div style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 3 }}>
      <div
        role="group"
        aria-label={`Stempel ${gewaehlt.name} platzieren. Pfeiltasten bewegen, mit Umschalt skalieren.`}
        tabIndex={0}
        onPointerDown={anfassen('ziehen')}
        onPointerMove={bewegen}
        onPointerUp={loslassen}
        onKeyDown={taste}
        style={{
          ...prozent,
          cursor: griff?.art === 'ziehen' ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          position: 'absolute',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <Stempelbild
          text={gewaehlt.vorschautext}
          farbe={farbe}
          gestaltung={gewaehlt.gestaltung}
          rahmen={`0.18rem dashed ${farbe}`}
        />
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
      {hinweis !== null && (
        <span
          style={{
            left: prozent.left,
            top: `calc(${prozent.top} + ${prozent.height} + 0.3rem)`,
            background: 'var(--farbe-flaeche)',
            border: '1px solid var(--farbe-rot)',
            borderRadius: '0.2rem',
            color: 'var(--farbe-rot)',
            fontSize: '0.75rem',
            padding: '0.15rem 0.4rem',
            position: 'absolute',
          }}
        >
          {hinweis}
        </span>
      )}
    </div>
  )
}
