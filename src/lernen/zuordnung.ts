/**
 * Objektzuordnung aus gelernten Merkmalen.
 *
 * Grundlage: Konzept 15. Die Reihenfolge ist die eigentliche Aussage:
 *
 *   1. **Deterministische Merkmale schlagen alles.** Findet sich eine
 *      bekannte Kundennummer im Text, ist die Zuordnung eindeutig — auch
 *      wenn derselbe Lieferant für zwanzig Objekte tätig ist.
 *   2. Mehrere Kandidaten sind schlechter als keiner: Das wird **rot**, nicht
 *      orange. Ein Beleg, der zu zwei Objekten passt, gehört angesehen.
 *   3. Erst wenn kein hartes Merkmal greift, käme Ähnlichkeit ins Spiel —
 *      und die ergibt laut Konzept nie besser als orange. Sie ist noch nicht
 *      gebaut.
 *
 * Gelernt wird aus bestätigten Zuordnungen. Niemand pflegt Kundennummern; sie
 * entstehen dadurch, dass ein Mensch einmal bestätigt hat, wohin ein Beleg
 * gehört.
 */

import type { PoolClient } from 'pg'

export type Merkmalstyp =
  | 'kundennummer'
  | 'zaehlernummer'
  | 'vertragsnummer'
  | 'liegenschaftsadresse'
  | 'objektnummer'
  | 'iban'

export interface Zuordnungsvorschlag {
  objektId: string | null
  /** Womit begründet — für die Anzeige und für das Protokoll. */
  begruendung: string
  sicherheit: 'gruen' | 'orange' | 'rot'
  /** Mehr als ein Objekt kam infrage. */
  mehrdeutig: boolean
}

/**
 * Vereinheitlicht einen Wert für den Vergleich.
 *
 * „12 345-6" und „123456" sind dieselbe Kundennummer; ohne Normalisierung
 * lernt das System dieselbe Zuordnung zweimal und findet sie beim dritten
 * Mal wieder nicht.
 */
export function normalisieren(wert: string): string {
  return wert.replace(/[\s.\-/]/g, '').toUpperCase()
}

/** IBAN: zwei Buchstaben, zwei Ziffern, danach der Rest. */
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}\b/g

/**
 * Nummern ab vier Zeichen. Darunter treffen Hausnummern, Steuersätze und
 * Seitenzahlen zufällig — und ein falsch zugeordneter Beleg kostet mehr
 * Zeit, als die Zuordnung spart.
 */
const NUMMER = /\b[\dA-Za-z][\d\-/.]{2,}\d\b/g

/**
 * Zieht Kandidaten aus dem Belegtext.
 *
 * Bewusst konservativ: Lieber ein Merkmal übersehen, das ein Mensch dann
 * bestätigt — und das System lernt es —, als eines erfinden.
 */
export function kandidatenAusText(text: string): string[] {
  const gefunden = new Set<string>()

  for (const treffer of text.matchAll(IBAN)) {
    gefunden.add(normalisieren(treffer[0]))
  }
  for (const treffer of text.matchAll(NUMMER)) {
    const knapp = normalisieren(treffer[0])
    if (knapp.length >= 4) gefunden.add(knapp)
  }

  return [...gefunden]
}

/**
 * Schlägt ein Objekt vor.
 *
 * Der Kreditor engt ein, wenn er bekannt ist: Eine Kundennummer gilt beim
 * Lieferanten, der sie vergeben hat. Merkmale ohne Kreditorbezug — eine
 * Zählernummer etwa — gelten unabhängig davon.
 */
export async function objektVorschlagen(
  c: PoolClient,
  dokumentId: string,
): Promise<Zuordnungsvorschlag> {
  const { rows: belege } = await c.query<{
    mandant_id: string
    kreditor_id: string | null
    text: string | null
  }>(
    `select d.mandant_id, f.kreditor_id,
            (select string_agg(s.text, ' ' order by s.seite)
               from dokument_seite s where s.dokument_id = d.id) as text
       from dokument d
       left join rechnung_fakten f on f.dokument_id = d.id
      where d.id = $1`,
    [dokumentId],
  )
  const beleg = belege[0]
  if (beleg === undefined || beleg.text === null) {
    return {
      objektId: null,
      begruendung: 'Kein Text zum Vergleichen vorhanden.',
      sicherheit: 'rot',
      mehrdeutig: false,
    }
  }

  const kandidaten = kandidatenAusText(beleg.text)
  if (kandidaten.length === 0) {
    return {
      objektId: null,
      begruendung: 'Im Beleg steht kein Merkmal, das eine Zuordnung erlaubt.',
      sicherheit: 'rot',
      mehrdeutig: false,
    }
  }

  // Über app.zuordnungstreffer, nicht direkt: Die Suche muss auch Objekte
  // finden, die der Fragende nicht sehen darf. Sonst wäre dieselbe
  // Zuordnung für den einen mehrdeutig und für den anderen eindeutig — und
  // das Ergebnis hinge vom Zufall der Zuständigkeit ab. Die Begründung steht
  // in der Migration 20260831150000.
  const { rows: treffer } = await c.query<{
    objekt_id: string
    merkmalstyp: string
    wert_normalisiert: string
    objektnummer: string
  }>('select * from app.zuordnungstreffer($1, $2)', [kandidaten, beleg.kreditor_id])

  if (treffer.length === 0) {
    return {
      objektId: null,
      begruendung: 'Kein gelerntes Merkmal aus diesem Beleg ist bekannt.',
      sicherheit: 'rot',
      mehrdeutig: false,
    }
  }

  const objekte = new Set(treffer.map((t) => t.objekt_id))
  if (objekte.size > 1) {
    // Mehrere Kandidaten sind schlechter als keiner (Konzept 14).
    const namen = [...new Set(treffer.map((t) => t.objektnummer))].join(', ')
    return {
      objektId: null,
      begruendung: `Merkmale im Beleg deuten auf mehrere Objekte: ${namen}.`,
      sicherheit: 'rot',
      mehrdeutig: true,
    }
  }

  const erster = treffer[0]
  return {
    objektId: erster.objekt_id,
    begruendung:
      `${erster.merkmalstyp} ${erster.wert_normalisiert} ist für Objekt ` +
      `${erster.objektnummer} gelernt.`,
    sicherheit: 'gruen',
    mehrdeutig: false,
  }
}

/**
 * Lernt ein Merkmal aus einer bestätigten Zuordnung.
 *
 * Erneutes Bestätigen erhöht nur die Trefferzahl — sie ist das Maß dafür,
 * wie verlässlich ein Merkmal ist, und später die Grundlage, um ungenutzte
 * Regeln zu erkennen.
 */
export async function merkmalLernen(
  c: PoolClient,
  eingabe: {
    mandantId: string
    kreditorId?: string | null
    merkmalstyp: Merkmalstyp
    wert: string
    objektId: string
  },
): Promise<void> {
  const wert = normalisieren(eingabe.wert)
  if (wert.length < 4) return // zu kurz, um zu unterscheiden

  await c.query(
    `insert into zuordnungs_merkmal (mandant_id, kreditor_id, merkmalstyp,
                                     wert_normalisiert, objekt_id,
                                     trefferzahl, letzte_bestaetigung)
     values ($1, $2, $3, $4, $5, 1, now())
     on conflict (mandant_id, kreditor_id, merkmalstyp, wert_normalisiert, objekt_id)
     do update set trefferzahl = zuordnungs_merkmal.trefferzahl + 1,
                   letzte_bestaetigung = now(),
                   aktiv = true`,
    [
      eingabe.mandantId,
      eingabe.kreditorId ?? null,
      eingabe.merkmalstyp,
      wert,
      eingabe.objektId,
    ],
  )
}

/**
 * Nimmt eine Korrektur entgegen.
 *
 * Korrigiert ein Bearbeiter die Zuordnung, wird das alte Merkmal auf
 * `aktiv = false` gesetzt und ein neues geschrieben — nicht überschrieben.
 * Die alte Regel erklärt später, warum ein Beleg damals anders zugeordnet
 * wurde (Konzept 15).
 */
export async function zuordnungKorrigieren(
  c: PoolClient,
  eingabe: {
    dokumentId: string
    benutzerId: string
    merkmalstyp: Merkmalstyp
    wert: string
    richtigesObjekt: string
    falschesObjekt?: string | null
  },
): Promise<void> {
  const wert = normalisieren(eingabe.wert)

  const { rows: belege } = await c.query<{ mandant_id: string; kreditor_id: string | null }>(
    `select d.mandant_id, f.kreditor_id
       from dokument d left join rechnung_fakten f on f.dokument_id = d.id
      where d.id = $1`,
    [eingabe.dokumentId],
  )
  const beleg = belege[0]
  if (beleg === undefined) return

  let wirkung: 'regel_neu' | 'regel_ersetzt' = 'regel_neu'

  if (eingabe.falschesObjekt != null) {
    const { rowCount } = await c.query(
      `update zuordnungs_merkmal set aktiv = false
        where mandant_id = $1 and merkmalstyp = $2 and wert_normalisiert = $3
          and objekt_id = $4 and aktiv`,
      [beleg.mandant_id, eingabe.merkmalstyp, wert, eingabe.falschesObjekt],
    )
    if (rowCount !== null && rowCount > 0) wirkung = 'regel_ersetzt'
  }

  await merkmalLernen(c, {
    mandantId: beleg.mandant_id,
    kreditorId: beleg.kreditor_id,
    merkmalstyp: eingabe.merkmalstyp,
    wert,
    objektId: eingabe.richtigesObjekt,
  })

  await c.query(
    `insert into korrektur_ereignis (dokument_id, feld, vorschlag, korrektur,
                                     benutzer_id, wirkung)
     values ($1, 'objekt_id', $2, $3, $4, $5)`,
    [
      eingabe.dokumentId,
      eingabe.falschesObjekt ?? null,
      eingabe.richtigesObjekt,
      eingabe.benutzerId,
      wirkung,
    ],
  )

  // Über app.dokument_zuordnen statt per UPDATE: Die Zuordnung kann den Beleg
  // aus der eigenen Sicht nehmen, und das lässt RLS bei einer gewöhnlichen
  // Änderung nicht zu (Migration 20260831170000).
  await c.query('select app.dokument_zuordnen($1, $2)', [
    eingabe.dokumentId,
    eingabe.richtigesObjekt,
  ])
}

/**
 * Bewertet offene Belege nach einer Korrektur neu.
 *
 * Konzept 15: Ein Nachlauf prüft alle Dokumente, die noch keine Zuordnung
 * haben. Abgeschlossene Läufe bleiben unberührt — eine neue Regel ändert
 * nicht rückwirkend, was bereits entschieden wurde.
 */
export async function nachlaufOhneZuordnung(
  c: PoolClient,
  mandantId: string,
): Promise<Array<{ dokumentId: string; objektId: string }>> {
  const { rows } = await c.query<{ id: string }>(
    `select d.id from dokument d
      where d.mandant_id = $1
        and d.objekt_id is null
        and d.status in ('in_aufbereitung', 'laufend')`,
    [mandantId],
  )

  const zugeordnet: Array<{ dokumentId: string; objektId: string }> = []
  for (const zeile of rows) {
    const vorschlag = await objektVorschlagen(c, zeile.id)
    if (vorschlag.sicherheit !== 'gruen' || vorschlag.objektId === null) continue

    await c.query('select app.dokument_zuordnen($1, $2)', [
      zeile.id,
      vorschlag.objektId,
    ])
    zugeordnet.push({ dokumentId: zeile.id, objektId: vorschlag.objektId })
  }
  return zugeordnet
}
