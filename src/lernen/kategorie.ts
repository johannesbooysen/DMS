/**
 * Kategorie (Ordnungsgruppe) eines Belegs bestimmen.
 *
 * **Warum das die wichtigste Zuordnung ist.** An der Kategorie haengt schon
 * alles andere: `ordnungsgruppe.spezialgebiet_id` fuehrt ueber
 * `spezialgebiet_zustaendigkeit` zum **Mitarbeiter**,
 * `ordnungsgruppe.prozessdefinition_id` benennt den **Ablauf**,
 * `ordnungsgruppe.konto_vorschlag_id` und `kontierungs_muster` fuehren zum
 * **Konto**. Diese Spalten stehen seit dem Kernschema -- es setzte nur
 * niemand die Kategorie, und deshalb wirkte keine von ihnen.
 *
 * **Die Reihenfolge ist die eigentliche Aussage** -- dieselbe Ordnung wie bei
 * der Objektzuordnung in `zuordnung.ts`:
 *
 *   1. **Die Angabe eines Menschen schlaegt jede Ableitung.** Steht am
 *      Kreditor eine Standardkategorie, gilt sie.
 *   2. **Gelernte Muster schlagen Textvergleich.** Was bei diesem Lieferanten
 *      und diesem Objekt bisher kontiert wurde, ist eine Tatsache aus dem
 *      eigenen Haus.
 *   3. **Schluesselworte ergeben nie besser als orange.** Ein Wort im Text
 *      ist ein Hinweis.
 *
 * **Uneinigkeit macht orange, nicht gruen.** Weichen Kreditorstandard und
 * gelerntes Muster voneinander ab, gewinnt der Standard -- aber die Ampel
 * faellt, weil jemand hinsehen sollte. Eine still aufgeloeste Uneinigkeit ist
 * genau die Sorte Automatik, die Fehler nach hinten verschiebt, statt sie zu
 * vermeiden.
 */

import type { PoolClient } from 'pg'

export interface Kategorievorschlag {
  ordnungsgruppeId: string | null
  /** Womit begruendet -- fuer die Anzeige und fuer das Protokoll. */
  begruendung: string
  sicherheit: 'gruen' | 'orange' | 'rot'
  quelle: 'kreditor' | 'muster' | 'schluesselwort' | 'keine'
}

interface Gruppe {
  id: string
  name: string
}

/**
 * Was ein Mensch am Kreditor hinterlegt hat.
 *
 * Die Mandantengleichheit wird ausdruecklich geprueft: Ein Fremdschluessel
 * kann sie nicht erzwingen, und eine Kategorie aus einem anderen Haus waere
 * ueber die RLS unsichtbar -- der Beleg bekaeme eine Zuordnung, die niemand
 * lesen kann.
 */
async function ausKreditor(c: PoolClient, dokumentId: string): Promise<Gruppe | null> {
  const { rows } = await c.query<Gruppe>(
    `select og.id, og.name
       from dokument d
       join rechnung_fakten f on f.dokument_id = d.id
       join kreditor k on k.id = f.kreditor_id
       join ordnungsgruppe og on og.id = k.standard_ordnungsgruppe_id
                             and og.mandant_id = d.mandant_id
                             and og.aktiv
      where d.id = $1`,
    [dokumentId],
  )
  return rows[0] ?? null
}

/**
 * Was bei diesem Lieferanten bisher kontiert wurde.
 *
 * `kontierungs_muster` traegt die Kategorie mit, weil eine Kontierung sie
 * ohnehin festlegt -- gelernt wird sie also nebenbei, ohne dass jemand eine
 * zweite Regel pflegt.
 *
 * Muster **ohne** Objektbezug zaehlen mit: Ein Lieferant, der nur eine Sorte
 * Rechnung schickt, ist auch dann eindeutig, wenn das Objekt neu ist.
 *
 * Sortiert nach Trefferzahl, nicht nach Zeilenzahl: Ein Muster, das
 * fuenfzigmal bestaetigt wurde, wiegt mehr als drei, die je einmal vorkamen.
 */
async function ausMustern(
  c: PoolClient,
  dokumentId: string,
): Promise<{ gruppe: Gruppe; treffer: number; einstimmig: boolean } | null> {
  const { rows } = await c.query<{ id: string; name: string; treffer: string }>(
    `select og.id, og.name, sum(m.trefferzahl)::text as treffer
       from dokument d
       join rechnung_fakten f on f.dokument_id = d.id
       join kontierungs_muster m on m.mandant_id = d.mandant_id
                                and m.kreditor_id = f.kreditor_id
                                and m.aktiv
                                and m.ordnungsgruppe_id is not null
                                and (m.objekt_id = d.objekt_id or m.objekt_id is null)
       join ordnungsgruppe og on og.id = m.ordnungsgruppe_id and og.aktiv
      where d.id = $1
      group by og.id, og.name
      order by sum(m.trefferzahl) desc, og.name`,
    [dokumentId],
  )

  const erste = rows[0]
  if (erste === undefined) return null
  return {
    gruppe: { id: erste.id, name: erste.name },
    treffer: Number(erste.treffer),
    einstimmig: rows.length === 1,
  }
}

/**
 * Schluesselworte gegen den Belegtext.
 *
 * Der Vergleich laeuft in der Datenbank, weil der Seitentext dort steht und
 * ein Beleg mit zwanzig Seiten sonst durch die Anwendung wandern muesste, um
 * eine Zeichenkette zu suchen.
 *
 * Mehrere Kategorien mit Treffern heisst **keine** Kategorie: Ein Beleg, auf
 * den "Heizung" und "Versicherung" passen, gehoert angesehen. Das ist
 * dieselbe Regel wie bei mehrdeutigen Objektmerkmalen -- mehrere Kandidaten
 * sind schlechter als keiner.
 */
async function ausSchluesselworten(
  c: PoolClient,
  dokumentId: string,
): Promise<{ gruppe: Gruppe; wort: string } | null> {
  const { rows } = await c.query<{ id: string; name: string; wort: string }>(
    `with text as (
       select d.mandant_id,
              lower(coalesce(string_agg(s.text, ' ' order by s.seite), '')) as inhalt
         from dokument d
         left join dokument_seite s on s.dokument_id = d.id
        where d.id = $1
        group by d.mandant_id
     )
     select og.id, og.name, w as wort
       from text
       join ordnungsgruppe og on og.mandant_id = text.mandant_id and og.aktiv
       cross join lateral unnest(og.schluesselwoerter) as w
      where text.inhalt like '%' || lower(w) || '%'
      order by og.name, w`,
    [dokumentId],
  )

  const gefunden = new Map<string, { gruppe: Gruppe; wort: string }>()
  for (const z of rows) {
    if (!gefunden.has(z.id)) {
      gefunden.set(z.id, { gruppe: { id: z.id, name: z.name }, wort: z.wort })
    }
  }

  // Mehrere Kategorien passen: schlechter als keine.
  if (gefunden.size !== 1) return null
  return [...gefunden.values()][0] ?? null
}

/**
 * Schlaegt eine Kategorie vor.
 *
 * Schreibt nichts. Ob der Vorschlag uebernommen wird, entscheidet der
 * Aufrufer anhand der Ampel -- so wie bei der Objektzuordnung.
 */
export async function kategorieVorschlagen(
  c: PoolClient,
  dokumentId: string,
): Promise<Kategorievorschlag> {
  const [kreditor, muster] = await Promise.all([
    ausKreditor(c, dokumentId),
    ausMustern(c, dokumentId),
  ])

  if (kreditor !== null) {
    // Der Standard gewinnt -- aber eine Abweichung senkt die Ampel.
    if (muster !== null && muster.gruppe.id !== kreditor.id) {
      return {
        ordnungsgruppeId: kreditor.id,
        begruendung:
          `Standard des Kreditors ist "${kreditor.name}", bisher kontiert ` +
          `wurde jedoch auf "${muster.gruppe.name}".`,
        sicherheit: 'orange',
        quelle: 'kreditor',
      }
    }
    return {
      ordnungsgruppeId: kreditor.id,
      begruendung: `"${kreditor.name}" ist am Kreditor als Standard hinterlegt.`,
      sicherheit: 'gruen',
      quelle: 'kreditor',
    }
  }

  if (muster !== null) {
    if (!muster.einstimmig) {
      return {
        ordnungsgruppeId: muster.gruppe.id,
        begruendung:
          `Bei diesem Kreditor wurde bisher auf mehrere Kategorien kontiert; ` +
          `"${muster.gruppe.name}" ist die haeufigste.`,
        sicherheit: 'orange',
        quelle: 'muster',
      }
    }
    return {
      ordnungsgruppeId: muster.gruppe.id,
      begruendung:
        `Bei diesem Kreditor wurde bisher ausschliesslich auf ` +
        `"${muster.gruppe.name}" kontiert (${muster.treffer} Bestaetigungen).`,
      sicherheit: 'gruen',
      quelle: 'muster',
    }
  }

  const wort = await ausSchluesselworten(c, dokumentId)
  if (wort !== null) {
    return {
      ordnungsgruppeId: wort.gruppe.id,
      begruendung: `Das Wort "${wort.wort}" im Beleg deutet auf "${wort.gruppe.name}".`,
      sicherheit: 'orange',
      quelle: 'schluesselwort',
    }
  }

  return {
    ordnungsgruppeId: null,
    begruendung:
      'Kein Standard am Kreditor, kein gelerntes Muster und kein ' +
      'eindeutiges Schluesselwort.',
    sicherheit: 'rot',
    quelle: 'keine',
  }
}
