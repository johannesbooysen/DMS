/**
 * Die Kontierungsmaske mit Daten versorgen.
 *
 * Duenn wie die uebrigen Lader: Sitzung oeffnen, Fachschicht fragen, Ergebnis
 * durchreichen. Die Regeln stehen in `src/kontierung/kontierung.ts`.
 */

import { alsBenutzer } from '@/db'
import {
  kontenFuerBeleg,
  kontierungLaden,
  type Kontierungsstand,
} from '@/kontierung/kontierung'

export interface Kontoauswahl {
  id: string
  kontonummer: string
  bezeichnung: string
  umlagefaehig: boolean
}

export interface Kontierungsmaske {
  stand: Kontierungsstand
  konten: Kontoauswahl[]
  umlageschluessel: Array<{ id: string; name: string }>
}

export async function kontierungsmaskeLaden(
  benutzerId: string,
  dokumentId: string,
): Promise<Kontierungsmaske> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows } = await c.query<{ id: string; name: string }>(
      'select id, name from umlageschluessel where aktiv order by name',
    )
    return {
      stand: await kontierungLaden(c, dokumentId),
      konten: await kontenFuerBeleg(c, dokumentId),
      umlageschluessel: rows,
    }
  })
}
