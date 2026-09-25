/**
 * Der Belegweg -- die Kette dieses Belegs, mit dem, was darin geschehen ist.
 *
 * "Warum hier" erklaert die aktuelle Stufe in Saetzen. Der Belegweg zeigt
 * den ganzen Weg: jede Stufe des Ablaufs in der Reihenfolge, die fuer
 * **diesen** Beleg gilt (mit seinem Betrag, seiner Kategorie -- dieselbe
 * Simulation wie im Ablaufeditor, nur mit echtem Kontext), und je Stufe,
 * ob sie erledigt, offen, ausstehend oder entfallen ist, wer dort was
 * gestempelt hat und wann.
 *
 * Nichts wird hier behauptet, was nicht in `aufgabe` und `stempel_ereignis`
 * steht. Die Kette ist die Simulation der aktiven Fassung des Laufs; hat
 * ein Stempel ein Ereignis an einer Stufe, die die Simulation nicht mehr
 * kennt (Fassung gewechselt, Bedingung anders), steht er trotzdem in der
 * Liste unter der Grafik -- eine Grafik, die ein Ereignis verschluckt,
 * waere ein falsches Protokoll.
 *
 * Alles unter der RLS: Wer den Beleg nicht sehen darf, bekommt null.
 */

import { alsBenutzer } from '../db'
import { baumLaden, simulieren } from '../workflow/baum'
import { kontextLaden } from '../workflow/engine'

export type Stufenzustand = 'erledigt' | 'aktuell' | 'klaerung' | 'abgelehnt' | 'ausstehend' | 'entfallen'

export interface Stempelschritt {
  stufeId: string | null
  stufe: string
  name: string
  farbe: string | null
  entscheidung: string
  von: string
  zeitpunkt: string
  kommentar: string | null
}

export interface Wegstufe {
  id: string
  bezeichnung: string
  stufentyp: string
  zustand: Stufenzustand
  /** Wer die offene Aufgabe hat -- Name, sonst Rolle oder Gruppe als Text. */
  bei: string | null
  faelligAm: string | null
  erledigtAm: string | null
  stempel: Stempelschritt[]
}

export interface Belegweg {
  laufStatus: string
  eingangAm: string
  archiviertAm: string | null
  fassung: string
  /** Die Kette: ein Schritt je Spalte, mehrere Stufen darin laufen gleichzeitig. */
  schritte: Array<{ stufen: Wegstufe[] }>
  /** Alle Stempelereignisse in Folge -- das Protokoll zur Grafik. */
  ereignisse: Stempelschritt[]
}

export async function belegwegLaden(benutzerId: string, dokumentId: string): Promise<Belegweg | null> {
  return alsBenutzer(benutzerId, async (c) => {
    const { rows: koepfe } = await c.query<{
      eingang_am: string
      archiviert_am: string | null
      lauf_id: string | null
      lauf_status: string | null
      definition_id: string | null
      belegart: string | null
      version: number | null
    }>(
      `select d.eingang_am, ar.archiviert_am, l.id as lauf_id, l.status as lauf_status,
              l.definition_id, p.belegart, l.definition_version as version
         from dokument d
         left join archiv_eintrag ar on ar.dokument_id = d.id
         left join dokument_lauf l on l.dokument_id = d.id
         left join prozessdefinition p on p.id = l.definition_id
        where d.id = $1`,
      [dokumentId],
    )
    const kopf = koepfe[0]
    if (kopf === undefined) return null

    const ereignisse = await ereignisseLaden(c, kopf.lauf_id)

    if (kopf.lauf_id === null || kopf.definition_id === null) {
      return {
        laufStatus: kopf.lauf_status ?? 'ohne_lauf',
        eingangAm: kopf.eingang_am,
        archiviertAm: kopf.archiviert_am,
        fassung: '',
        schritte: [],
        ereignisse,
      }
    }

    const wurzel = await baumLaden(c, kopf.definition_id)
    const kontext = await kontextLaden(c, dokumentId)
    const kette = wurzel === null ? [] : simulieren(wurzel, kontext)

    const { rows: aufgaben } = await c.query<{
      stufe_id: string
      status: string
      faellig_am: string | null
      erledigt_am: string | null
      bei: string | null
    }>(
      `select a.stufe_id, a.status, a.faellig_am, a.erledigt_am,
              coalesce(b.name, r.name, g.name) as bei
         from aufgabe a
         left join benutzer b on b.id = a.zugewiesen_benutzer
         left join rolle r on r.id = a.zugewiesen_rolle
         left join gruppe g on g.id = a.zugewiesen_gruppe
        where a.lauf_id = $1
        order by a.erstellt_am`,
      [kopf.lauf_id],
    )
    const aufgabeJeStufe = new Map<string, (typeof aufgaben)[number]>()
    for (const a of aufgaben) {
      // Die juengste Aufgabe je Stufe zaehlt -- nach einem Ruecksprung gibt
      // es zwei, und die aeltere ist erledigt oder entfallen.
      aufgabeJeStufe.set(a.stufe_id, a)
    }

    const schritte = kette.map((schritt) => ({
      stufen: schritt.stufen.map((s): Wegstufe => {
        const a = aufgabeJeStufe.get(s.id)
        const stempel = ereignisse.filter((e) => e.stufeId === s.id)
        const letzter = stempel.at(-1)
        let zustand: Stufenzustand = 'ausstehend'
        if (a?.status === 'offen' || a?.status === 'in_arbeit') {
          zustand = kopf.lauf_status === 'klaerung' ? 'klaerung' : 'aktuell'
        } else if (letzter?.entscheidung === 'ablehnung') {
          zustand = 'abgelehnt'
        } else if (letzter?.entscheidung === 'freigabe' || a?.status === 'erledigt') {
          zustand = 'erledigt'
        } else if (a?.status === 'entfallen') {
          zustand = 'entfallen'
        }
        return {
          id: s.id,
          bezeichnung: s.bezeichnung,
          stufentyp: s.stufentyp,
          zustand,
          bei: zustand === 'aktuell' || zustand === 'klaerung' ? (a?.bei ?? null) : null,
          faelligAm: a?.faellig_am ?? null,
          erledigtAm: a?.erledigt_am ?? null,
          stempel,
        }
      }),
    }))

    return {
      laufStatus: kopf.lauf_status ?? 'laufend',
      eingangAm: kopf.eingang_am,
      archiviertAm: kopf.archiviert_am,
      fassung: `${kopf.belegart ?? ''}, Fassung ${kopf.version ?? ''}`,
      schritte,
      ereignisse,
    }
  })
}

async function ereignisseLaden(
  c: Parameters<Parameters<typeof alsBenutzer>[1]>[0],
  laufId: string | null,
): Promise<Stempelschritt[]> {
  if (laufId === null) return []
  const { rows } = await c.query<{
    stufe_id: string | null
    stufe: string | null
    name: string | null
    farbe: string | null
    entscheidung: string
    von: string | null
    zeitpunkt: string
    kommentar: string | null
  }>(
    `select e.stufe_id, s.bezeichnung as stufe, t.name, t.farbe, e.entscheidung,
            b.name as von, e.zeitpunkt, e.kommentar
       from stempel_ereignis e
       left join prozessstufe s on s.id = e.stufe_id
       left join stempeltyp t on t.id = e.stempeltyp_id
       left join benutzer b on b.id = e.benutzer_id
      where e.lauf_id = $1
      order by e.folge`,
    [laufId],
  )
  return rows.map((z) => ({
    stufeId: z.stufe_id,
    stufe: z.stufe ?? '—',
    name: z.name ?? entscheidungName(z.entscheidung),
    farbe: z.farbe,
    entscheidung: z.entscheidung,
    von: z.von ?? 'System',
    zeitpunkt: z.zeitpunkt,
    kommentar: z.kommentar,
  }))
}

function entscheidungName(e: string): string {
  return (
    { freigabe: 'Freigabe', ablehnung: 'Ablehnung', klaerung: 'Klärung', rueckgabe: 'Rückgabe', verfallen: 'verfallen' } as Record<
      string,
      string
    >
  )[e] ?? e
}
