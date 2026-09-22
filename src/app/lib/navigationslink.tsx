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

export function Navigationslink({ href, children }: { href: string; children: ReactNode }) {
  const pfad = usePathname()
  const aktiv = pfad === href || pfad.startsWith(`${href}/`)
  return (
    <Link href={href} aria-current={aktiv ? 'page' : undefined}>
      {children}
    </Link>
  )
}
