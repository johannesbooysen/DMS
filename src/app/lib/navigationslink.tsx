'use client'

/**
 * Ein Eintrag der Seitenleiste, der weiss, ob er gerade gilt.
 *
 * Die Huelle ist serverseitig und kennt den Pfad nicht; dieser eine Link
 * schon (`usePathname`). Mehr Zustand hat er nicht -- er ist ein `Link`
 * mit `aria-current`, damit die Leiste zeigt, wo man ist, und ein
 * Vorleseprogramm es sagt.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export function Navigationslink({
  href,
  alle = [],
  children,
}: {
  href: string
  /**
   * Alle Ziele der Leiste. Gilt tut der laengste, der zum Pfad passt: Unter
   * /stammdaten/stempel leuchtet "Stempel", nicht auch "Stammdaten" -- seit
   * die Unterseiten eigene Eintraege haben, waeren es sonst zwei.
   */
  alle?: readonly string[]
  children: ReactNode
}) {
  const pfad = usePathname()
  const passt = (ziel: string) => pfad === ziel || pfad.startsWith(`${ziel}/`)
  const laengster = [...alle].filter(passt).sort((a, b) => b.length - a.length)[0]
  const aktiv = laengster === undefined ? passt(href) : laengster === href
  return (
    <Link href={href} aria-current={aktiv ? 'page' : undefined}>
      {children}
    </Link>
  )
}
