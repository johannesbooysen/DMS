'use client'

/**
 * Pfeiltasten fuer eine serverseitig gerenderte Trefferliste.
 *
 * Die Zeilen der Belegsuche sind gewoehnliche Verweise vom Server; diese
 * Komponente rendert keine davon. Sie kennt nur ihre **Reihenfolge** und
 * weiss, welche gerade offen ist -- damit ist "naechster Treffer" eine
 * Taste, wie am Arbeitsplatz (`aufgabenleiste.tsx`). Dieselbe Bauart:
 * Zuhoerer an `globalThis`, Ereignis strukturell gelesen, kein `window`,
 * weil `tsconfig` das DOM nicht kennt.
 *
 * Nicht, wenn gerade in ein Feld getippt wird -- ein "j" im Suchfeld ist
 * ein "j".
 */

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

interface Tastendruck {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  target: { tagName?: string; isContentEditable?: boolean } | null
  preventDefault(): void
}

interface Zuhoerer {
  addEventListener(art: string, f: (e: Tastendruck) => void): void
  removeEventListener(art: string, f: (e: Tastendruck) => void): void
}

export function Listentasten({
  ziele,
  aktuell,
  hinweis,
}: {
  /** Die Adressen der Zeilen, in Listenreihenfolge. */
  ziele: string[]
  /** Index der offenen Zeile, -1 fuer keine. */
  aktuell: number
  hinweis: string
}) {
  const router = useRouter()
  // Steht erst, wenn der Zuhoerer haengt (`data-tastatur`), damit ein
  // Browsertest darauf warten kann -- direkt am Element, nicht als Zustand.
  const marke = useRef<{ setAttribute(name: string, wert: string): void } | null>(null)

  useEffect(() => {
    marke.current?.setAttribute('data-tastatur', 'bereit')
    const fenster = globalThis as unknown as Zuhoerer
    const taste = (e: Tastendruck): void => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const tag = e.target?.tagName ?? ''
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return

      let schritt = 0
      if (e.key === 'ArrowDown' || e.key === 'j') schritt = 1
      if (e.key === 'ArrowUp' || e.key === 'k') schritt = -1
      if (schritt === 0 || ziele.length === 0) return

      const naechste = Math.min(ziele.length - 1, Math.max(0, (aktuell < 0 ? -1 : aktuell) + schritt))
      const ziel = ziele[naechste]
      if (ziel === undefined || naechste === aktuell) return
      e.preventDefault()
      router.push(ziel)
    }
    fenster.addEventListener('keydown', taste)
    return () => fenster.removeEventListener('keydown', taste)
  }, [ziele, aktuell, router])

  return (
    <p
      className="trefferliste-hinweis"
      ref={(el) => {
        marke.current = el as unknown as typeof marke.current
      }}
    >
      <kbd>↓</kbd> <kbd>↑</kbd> {hinweis}
    </p>
  )
}
