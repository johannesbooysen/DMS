'use client'

/**
 * Die Taste "/" springt in die Schnellsuche der Kopfzeile.
 *
 * Dieselbe Bauart wie `listentasten.tsx`: Zuhoerer an `globalThis`, das
 * Ereignis strukturell gelesen, kein `window` und kein `document` als Typ,
 * weil `tsconfig` das DOM nicht kennt. Nicht, wenn gerade in ein Feld
 * getippt wird -- ein "/" in einem Kommentar ist ein "/".
 *
 * Der Grund fuer eine Client-Komponente: Eine Taste laesst sich nicht
 * serverseitig belegen, und wer hundert Belege am Tag sucht, greift nicht
 * zur Maus, um ein Suchfeld zu treffen.
 */

import { useEffect } from 'react'

interface Tastendruck {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  target: { tagName?: string; isContentEditable?: boolean } | null
  preventDefault(): void
}

interface Fenster {
  addEventListener(art: string, f: (e: Tastendruck) => void): void
  removeEventListener(art: string, f: (e: Tastendruck) => void): void
  document?: { getElementById(id: string): { focus(): void; select?(): void } | null }
}

export function Suchtaste({ feldId }: { feldId: string }) {
  useEffect(() => {
    const fenster = globalThis as unknown as Fenster
    const taste = (e: Tastendruck): void => {
      if (e.key !== '/' || e.altKey || e.ctrlKey || e.metaKey) return
      const tag = e.target?.tagName ?? ''
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return
      const feld = fenster.document?.getElementById(feldId)
      if (feld === null || feld === undefined) return
      e.preventDefault()
      feld.focus()
      feld.select?.()
    }
    fenster.addEventListener('keydown', taste)
    return () => fenster.removeEventListener('keydown', taste)
  }, [feldId])
  return null
}
