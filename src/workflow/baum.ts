/**
 * Der Blockbaum: laden, ablaufen, simulieren.
 *
 * Grundlage: ADR 0002. Der Baum wird durchlaufen, statt `reihenfolge`
 * hochgezählt zu werden. Diese Datei enthält ausschließlich reine Funktionen
 * über einem geladenen Baum — kein Datenbankzugriff außer beim Laden, damit
 * die Simulation dieselbe Logik benutzt wie der Lauf und nicht eine zweite,
 * die auseinanderdriftet.
 */

import type { PoolClient } from 'pg'
import { bedingungAuswerten, type Bedingung, type Kontext } from './bedingung'

export type Knotentyp = 'nacheinander' | 'gleichzeitig' | 'verzweigung' | 'stufe'

export interface Stufe {
  id: string
  bezeichnung: string
  stufentyp: string
  pflicht: boolean
  betragVon: number | null
  betragBis: number | null
  zustaendigkeitTyp: string
  zustaendigkeitRef: string | null
  slaStunden: number | null
}

export interface Knoten {
  id: string
  knotentyp: Knotentyp
  reihenfolge: number
  bedingung: Bedingung | null
  stufe: Stufe | null
  kinder: Knoten[]
  eltern: Knoten | null
}

interface Zeile {
  id: string
  eltern_id: string | null
  reihenfolge: number
  knotentyp: Knotentyp
  bedingung: Bedingung | null
  stufe_id: string | null
  bezeichnung: string | null
  stufentyp: string | null
  pflicht: boolean | null
  betrag_von: string | null
  betrag_bis: string | null
  zustaendigkeit_typ: string | null
  zustaendigkeit_ref: string | null
  sla_stunden: number | null
}

export async function baumLaden(c: PoolClient, definitionId: string): Promise<Knoten | null> {
  const { rows } = await c.query<Zeile>(
    `select k.id, k.eltern_id, k.reihenfolge, k.knotentyp, k.bedingung, k.stufe_id,
            s.bezeichnung, s.stufentyp, s.pflicht, s.betrag_von, s.betrag_bis,
            s.zustaendigkeit_typ, s.zustaendigkeit_ref, s.sla_stunden
       from prozessknoten k
       left join prozessstufe s on s.id = k.stufe_id
      where k.definition_id = $1
      order by k.reihenfolge`,
    [definitionId],
  )

  const nachId = new Map<string, Knoten>()
  for (const z of rows) {
    nachId.set(z.id, {
      id: z.id,
      knotentyp: z.knotentyp,
      reihenfolge: z.reihenfolge,
      bedingung: z.bedingung,
      stufe:
        z.stufe_id === null
          ? null
          : {
              id: z.stufe_id,
              bezeichnung: z.bezeichnung ?? '',
              stufentyp: z.stufentyp ?? '',
              pflicht: z.pflicht ?? true,
              betragVon: z.betrag_von === null ? null : Number(z.betrag_von),
              betragBis: z.betrag_bis === null ? null : Number(z.betrag_bis),
              zustaendigkeitTyp: z.zustaendigkeit_typ ?? 'system',
              zustaendigkeitRef: z.zustaendigkeit_ref,
              slaStunden: z.sla_stunden,
            },
      kinder: [],
      eltern: null,
    })
  }

  let wurzel: Knoten | null = null
  for (const z of rows) {
    const knoten = nachId.get(z.id)
    if (knoten === undefined) continue
    if (z.eltern_id === null) {
      wurzel = knoten
    } else {
      const eltern = nachId.get(z.eltern_id)
      if (eltern !== undefined) {
        knoten.eltern = eltern
        eltern.kinder.push(knoten)
      }
    }
  }

  for (const knoten of nachId.values()) {
    knoten.kinder.sort((a, b) => a.reihenfolge - b.reihenfolge)
  }

  return wurzel
}

/**
 * Gilt die Stufe für diesen Beleg? Betragsgrenzen sind der Regelfall aus dem
 * Konzept: „Freigabe Geschäftsleitung, Brutto über 5.000 €".
 */
export function stufeGiltFuer(stufe: Stufe, kontext: Kontext): boolean {
  const brutto = kontext['brutto']
  if (typeof brutto !== 'number') {
    // Ohne Betrag lässt sich eine Betragsgrenze nicht anwenden. Im Zweifel
    // durchlaufen — eine übersprungene Pflichtstufe wäre der schlimmere Fehler.
    return true
  }
  if (stufe.betragVon !== null && brutto < stufe.betragVon) return false
  if (stufe.betragBis !== null && brutto > stufe.betragBis) return false
  return true
}

/**
 * Die Blätter, mit denen ein Baustein beginnt. Ein paralleler Block beginnt
 * mit mehreren gleichzeitig, eine Verzweigung mit denen des gewählten Zweigs.
 */
export function einstiegsblaetter(knoten: Knoten, kontext: Kontext): Knoten[] {
  switch (knoten.knotentyp) {
    case 'stufe':
      return [knoten]
    case 'nacheinander': {
      for (const kind of knoten.kinder) {
        const blaetter = einstiegsblaetter(kind, kontext)
        if (blaetter.length > 0) return blaetter
      }
      return []
    }
    case 'gleichzeitig':
      return knoten.kinder.flatMap((kind) => einstiegsblaetter(kind, kontext))
    case 'verzweigung': {
      const trifftZu = knoten.bedingung !== null && bedingungAuswerten(knoten.bedingung, kontext)
      const zweig = trifftZu ? knoten.kinder[0] : knoten.kinder[1]
      return zweig === undefined ? [] : einstiegsblaetter(zweig, kontext)
    }
  }
}

/** Alle Blätter unterhalb eines Knotens, unabhängig von Bedingungen. */
export function alleBlaetter(knoten: Knoten): Knoten[] {
  return knoten.knotentyp === 'stufe'
    ? [knoten]
    : knoten.kinder.flatMap(alleBlaetter)
}

/**
 * Was kommt nach diesem Blatt? Der Weg führt vom Blatt nach oben: im
 * Nacheinander zum nächsten Geschwister, im Gleichzeitig erst, wenn alle
 * Geschwister fertig sind, in der Verzweigung hinter die Verzweigung.
 *
 * `istAbgeschlossen` beantwortet für einen Teilbaum, ob er durch ist — die
 * Engine liest das aus den Aufgaben, die Simulation nimmt an, dass alles
 * durchläuft.
 */
export function naechsteBlaetter(
  blatt: Knoten,
  kontext: Kontext,
  istAbgeschlossen: (knoten: Knoten) => boolean,
): Knoten[] {
  let aktuell = blatt

  while (aktuell.eltern !== null) {
    const eltern = aktuell.eltern
    const position = eltern.kinder.indexOf(aktuell)

    if (eltern.knotentyp === 'nacheinander') {
      for (const geschwister of eltern.kinder.slice(position + 1)) {
        const blaetter = einstiegsblaetter(geschwister, kontext)
        if (blaetter.length > 0) return blaetter
      }
    } else if (eltern.knotentyp === 'gleichzeitig') {
      // Ein paralleler Block endet erst, wenn alle Zweige abgeschlossen sind.
      if (!eltern.kinder.every(istAbgeschlossen)) return []
    }
    // Bei 'verzweigung' geht es unmittelbar hinter der Verzweigung weiter.

    aktuell = eltern
  }

  return [] // Wurzel erreicht: der Lauf ist zu Ende.
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface Simulationsschritt {
  /** Mehr als eine Stufe bedeutet: laufen gleichzeitig. */
  stufen: Stufe[]
}

/**
 * Zeigt die Kette, die sich für einen gedachten Beleg ergibt — §8.8 verlangt
 * das vor dem Aktivieren einer Fassung. Verändert nichts.
 *
 * Innerhalb eines parallelen Blocks werden die Stufen zu einem Schritt
 * zusammengefasst; ihre innere Reihenfolge ist dort ohne Bedeutung.
 */
export function simulieren(knoten: Knoten, kontext: Kontext): Simulationsschritt[] {
  switch (knoten.knotentyp) {
    case 'stufe':
      return knoten.stufe !== null && stufeGiltFuer(knoten.stufe, kontext)
        ? [{ stufen: [knoten.stufe] }]
        : []
    case 'nacheinander':
      return knoten.kinder.flatMap((kind) => simulieren(kind, kontext))
    case 'gleichzeitig': {
      const stufen = knoten.kinder
        .flatMap((kind) => simulieren(kind, kontext))
        .flatMap((schritt) => schritt.stufen)
      return stufen.length === 0 ? [] : [{ stufen }]
    }
    case 'verzweigung': {
      const trifftZu = knoten.bedingung !== null && bedingungAuswerten(knoten.bedingung, kontext)
      const zweig = trifftZu ? knoten.kinder[0] : knoten.kinder[1]
      return zweig === undefined ? [] : simulieren(zweig, kontext)
    }
  }
}
