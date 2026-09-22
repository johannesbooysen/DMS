'use client'

/**
 * Die linke Spalte des Arbeitsplatzes: die Aufgaben, eine davon offen.
 *
 * Eine Client-Komponente aus zwei Gruenden, und beide sind der Grund fuer
 * die geteilte Ansicht selbst: Sie weiss, **welche** Aufgabe gerade offen
 * ist (aus dem Pfad, `usePathname`), und sie kennt die **Reihenfolge** --
 * damit ist "naechste Aufgabe" eine Taste und kein Klick zurueck in eine
 * Liste. Die Zeilen selbst kommen vom Server; die Komponente ordnet nur an.
 *
 * Tastatur: Pfeil hoch/runter oder j/k wechseln die Aufgabe. Nicht, wenn
 * gerade in ein Feld getippt wird -- ein "j" im Kommentar ist ein "j".
 *
 * Kein `window` und kein `KeyboardEvent`: `tsconfig` setzt `lib` ohne
 * `DOM`, und das ist ein Riegel (siehe `belegvorschau.tsx`). Der Zuhoerer
 * haengt an `globalThis` und liest das Ereignis strukturell -- dieselbe
 * Bauart wie die Zeigerereignisse in `stempelbewegen.tsx`.
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef } from 'react'
import { Ampel, belegBezeichnung, datum, euro } from '@/app/lib/anzeige'

export interface Aufgabeneintrag {
  aufgabeId: string
  kreditor: string | null
  korrespondent: string | null
  betreff: string | null
  rechnungsnummer: string | null
  objektnummer: string | null
  stufe: string
  brutto: number | null
  ampel: string | null
  faelligAm: string | null
}

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

const ziel = (id: string) => `/arbeitsplatz/${id}`

export function Aufgabenleiste({
  persoenlich,
  pool,
}: {
  persoenlich: Aufgabeneintrag[]
  pool: Aufgabeneintrag[]
}) {
  const pfad = usePathname()
  const router = useRouter()
  const alle = useMemo(() => [...persoenlich, ...pool], [persoenlich, pool])
  const aktuell = alle.findIndex((a) => pfad === ziel(a.aufgabeId))
  // Steht erst, wenn der Zuhoerer haengt -- vorher geht ein Tastendruck ins
  // Leere. Sichtbar als `data-tastatur` am Element, damit ein Browsertest
  // darauf warten kann, statt zu raten, wann die Hydration durch ist. Direkt
  // am Element und nicht als Zustand: Ein setState im Effekt loest einen
  // zweiten Render aus, und das Merkmal ist keine Ansicht, sondern ein
  // Vermerk fuer die Aussenwelt.
  const leiste = useRef<{ setAttribute(name: string, wert: string): void } | null>(null)

  useEffect(() => {
    leiste.current?.setAttribute('data-tastatur', 'bereit')
    const fenster = globalThis as unknown as Zuhoerer
    const taste = (e: Tastendruck): void => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const tag = e.target?.tagName ?? ''
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return

      let schritt = 0
      if (e.key === 'ArrowDown' || e.key === 'j') schritt = 1
      if (e.key === 'ArrowUp' || e.key === 'k') schritt = -1
      if (schritt === 0 || alle.length === 0) return

      const naechste = Math.min(alle.length - 1, Math.max(0, (aktuell < 0 ? -1 : aktuell) + schritt))
      const eintrag = alle[naechste]
      if (eintrag === undefined || naechste === aktuell) return
      e.preventDefault()
      router.push(ziel(eintrag.aufgabeId))
    }
    fenster.addEventListener('keydown', taste)
    return () => fenster.removeEventListener('keydown', taste)
  }, [alle, aktuell, router])

  const gruppe = (titel: string, zeilen: Aufgabeneintrag[], leer: string) => (
    <section aria-label={titel}>
      <h2>
        {titel} ({zeilen.length})
      </h2>
      {zeilen.length === 0 ? (
        <p className="aufgabenleiste-leer">{leer}</p>
      ) : (
        <ul>
          {zeilen.map((z) => {
            const aktiv = pfad === ziel(z.aufgabeId)
            return (
              <li key={z.aufgabeId}>
                <Link href={ziel(z.aufgabeId)} aria-current={aktiv ? 'page' : undefined}>
                  <span className="aufgabenleiste-titel">
                    <Ampel wert={z.ampel} />
                    <span>{belegBezeichnung(z)}</span>
                  </span>
                  <span className="aufgabenleiste-zeile">
                    <span>
                      {z.objektnummer !== null && `Objekt ${z.objektnummer} · `}
                      {z.stufe}
                    </span>
                    <span>
                      {z.brutto !== null
                        ? euro.format(z.brutto)
                        : z.faelligAm !== null
                          ? datum.format(new Date(z.faelligAm))
                          : ''}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  return (
    <nav
      aria-label="Aufgaben"
      className="aufgabenleiste"
      ref={(el) => {
        // Strukturell, nicht als HTMLElement: `lib` kennt das DOM nicht.
        leiste.current = el as unknown as typeof leiste.current
      }}
    >
      {gruppe('Persönlich', persoenlich, 'Nichts zugewiesen.')}
      {gruppe('Pool', pool, 'Nichts im Pool.')}
      <p className="aufgabenleiste-hinweis">
        <kbd>↓</kbd> <kbd>↑</kbd> nächste und vorige Aufgabe
      </p>
    </nav>
  )
}
