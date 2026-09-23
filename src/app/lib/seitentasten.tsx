'use client'

/**
 * Blaettern mit der Tastatur: Pfeil rechts/links, Bild ab/auf.
 *
 * Kein Zustand ueber die Seiten, keine Kopie der Seitenliste: Die Seiten
 * stehen als Anker (`#seite-n`) im Stapel, und blaettern heisst, den
 * naechsten Anker anzuspringen. Der Browser scrollt den Stapel dorthin --
 * auch innerhalb des Betrachters, der selbst scrollt.
 *
 * Gemerkt wird nur, auf welcher Seite man zuletzt war. Wer mit der Maus
 * scrollt, verstellt das nicht; die naechste Taste rechnet dann von der
 * zuletzt angesprungenen Seite weiter. Das ist eine Ungenauigkeit, und sie
 * ist billiger als ein Scroll-Beobachter mit DOM-Typen, die es hier
 * bewusst nicht gibt (`lib` ohne `DOM`).
 */

import { useEffect, useRef } from 'react'

interface Tastendruck {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  target: { tagName?: string; isContentEditable?: boolean } | null
  preventDefault(): void
}

interface Fenster {
  location: { hash: string }
  addEventListener(art: string, f: (e: Tastendruck) => void): void
  removeEventListener(art: string, f: (e: Tastendruck) => void): void
}

export function Seitentasten({ anzahl }: { anzahl: number }) {
  const aktuell = useRef(1)

  useEffect(() => {
    const fenster = globalThis as unknown as Fenster
    const springe = (seite: number) => {
      aktuell.current = seite
      fenster.location.hash = `seite-${seite}`
    }
    const taste = (e: Tastendruck): void => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const tag = e.target?.tagName ?? ''
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return

      let schritt = 0
      if (e.key === 'ArrowRight' || e.key === 'PageDown') schritt = 1
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') schritt = -1
      if (schritt === 0) return
      const ziel = Math.min(anzahl, Math.max(1, aktuell.current + schritt))
      if (ziel === aktuell.current) return
      e.preventDefault()
      springe(ziel)
    }
    fenster.addEventListener('keydown', taste)
    return () => fenster.removeEventListener('keydown', taste)
  }, [anzahl])

  if (anzahl < 2) return null
  return (
    <span className="seitentasten" title="Pfeil rechts und links blättern">
      <kbd>←</kbd> <kbd>→</kbd> blättern
    </span>
  )
}
