/**
 * Berechtigungs-Presets je Verwaltungsart (Konzept §24.13).
 *
 * „Damit die Ersteinrichtung nicht bei null beginnt." Ein frisches Haus hat
 * keine Rollen, keine Rechte und keine Stempelzuordnung — und wer das von
 * Hand aufbaut, baut es beim ersten Mal falsch, weil man erst nach ein paar
 * Wochen merkt, welche Trennung im Alltag trägt.
 *
 * **Ein Preset ist ein Startwert, keine Bindung.**
 *
 * Nach dem Anwenden stehen gewöhnliche Zeilen in `rolle`, `rolle_recht` und
 * `stempel_recht` — und nichts verweist zurück. Es gibt bewusst **keine**
 * `preset_id` an der Rolle: Sie würde eine Herkunft behaupten, die keine
 * Wirkung hat, und die Frage „warum darf diese Rolle das" wäre plötzlich an
 * zwei Stellen zu beantworten. Wer ein Preset später ändert, ändert nichts
 * an einem Haus, das es schon angewendet hat. Das ist Absicht.
 *
 * **Warum im Quelltext und nicht als Tabelle.** Eine Preset-Tabelle wäre
 * mandantenübergreifend — und damit die erste Tabelle im System ohne
 * Mandantenfilter. Presets sind außerdem keine laufende Konfiguration,
 * sondern ein einmaliger Anschub; die Konfiguration entsteht erst durch das
 * Anwenden und ist ab dann Stammdatum wie jedes andere.
 *
 * **Nichts wird überschrieben.** Eine Rolle mit demselben Kurzcode bleibt,
 * wie sie ist; Rechte kommen hinzu, nie weg. Ein Preset, das auf ein
 * laufendes Haus angewendet wird, darf niemandem etwas nehmen — das würde
 * genau dann auffallen, wenn jemand eine Freigabe braucht.
 */

import type { PoolClient } from 'pg'

export class NichtErlaubt extends Error {}
export class NichtMoeglich extends Error {}

export interface PresetRolle {
  kurzcode: string
  name: string
  beschreibung: string
  /** Aktionen aus `rolle_recht.aktion`. */
  rechte: string[]
  /** Kurzcodes aus `stempeltyp`; fehlende werden gemeldet, nicht angelegt. */
  stempel: string[]
}

export interface Preset {
  id: string
  verwaltungsart: 'weg' | 'miet' | 'se'
  name: string
  beschreibung: string
  rollen: PresetRolle[]
}

/*
 * Die drei Zuschnitte.
 *
 * Sie bilden übliche Praxis ab, nicht Gesetz — und sind ausdrücklich zum
 * Anpassen gedacht. Der Unterschied zwischen ihnen ist die Teamgröße und
 * wer entscheidet:
 *
 *   * **WEG**: Die Eigentümergemeinschaft entscheidet, der Beirat sieht mit.
 *     Strikte Trennung von sachlicher und rechnerischer Prüfung, Freigabe
 *     über der Grenze bei der Geschäftsleitung.
 *   * **Miet**: Der Eigentümer ist Auftraggeber, die Verwaltung handelt im
 *     Alltag mit Vollmacht. Kleinere Teams — die Objektbearbeitung kontiert
 *     mit.
 *   * **SE**: Der kleinste Zuschnitt, oft eine Person je Eigentümer. Eine
 *     Rolle für die Arbeit, eine für die Verwaltung des Systems.
 */
export const PRESETS: Preset[] = [
  {
    id: 'weg',
    verwaltungsart: 'weg',
    name: 'WEG-Verwaltung',
    beschreibung:
      'Drei Rollen mit strikter Trennung: sachliche Prüfung am Objekt, ' +
      'rechnerische Prüfung und Kontierung in der Buchhaltung, Freigabe über ' +
      'der Eskalationsgrenze bei der Geschäftsleitung.',
    rollen: [
      {
        kurzcode: 'OB',
        name: 'Objektbearbeitung',
        beschreibung: 'Sachliche Prüfung und Bearbeitung am eigenen Objekt.',
        rechte: ['ansehen', 'bearbeiten', 'stempeln'],
        stempel: ['SACHL', 'KLAER', 'ABL'],
      },
      {
        kurzcode: 'BH',
        name: 'Buchhaltung',
        beschreibung: 'Mandantenweite Sicht, rechnerische Prüfung und Kontierung.',
        rechte: ['ansehen', 'kontieren', 'stempeln', 'stammdaten_pflegen'],
        stempel: ['RECHN', 'KLAER', 'KONT', 'ZAHL'],
      },
      {
        kurzcode: 'GL',
        name: 'Geschäftsleitung',
        beschreibung: 'Freigabe über der Eskalationsgrenze, Konfiguration, Verwaltung.',
        rechte: [
          'ansehen',
          'stempeln',
          'delegieren',
          'prozess_konfigurieren',
          'stammdaten_pflegen',
          'benutzer_verwalten',
          'notfallzugriff',
        ],
        stempel: ['FREI', 'ABL', 'KLAER'],
      },
    ],
  },
  {
    id: 'miet',
    verwaltungsart: 'miet',
    name: 'Mietverwaltung',
    beschreibung:
      'Wie die WEG-Verwaltung, aber die Objektbearbeitung kontiert mit — ' +
      'in kleineren Teams ist die Trennung von Prüfung und Kontierung mehr ' +
      'Reibung als Kontrolle, solange die Freigabe getrennt bleibt.',
    rollen: [
      {
        kurzcode: 'OB',
        name: 'Objektbearbeitung',
        beschreibung: 'Sachliche Prüfung, Bearbeitung und Kontierung am eigenen Objekt.',
        rechte: ['ansehen', 'bearbeiten', 'kontieren', 'stempeln'],
        stempel: ['SACHL', 'KLAER', 'ABL', 'KONT'],
      },
      {
        kurzcode: 'BH',
        name: 'Buchhaltung',
        beschreibung: 'Mandantenweite Sicht, rechnerische Prüfung, Zahlungsübergabe.',
        rechte: ['ansehen', 'kontieren', 'stempeln', 'stammdaten_pflegen'],
        stempel: ['RECHN', 'KLAER', 'ZAHL'],
      },
      {
        kurzcode: 'GL',
        name: 'Geschäftsleitung',
        beschreibung: 'Freigabe über der Vollmachtsgrenze, Konfiguration, Verwaltung.',
        rechte: [
          'ansehen',
          'stempeln',
          'delegieren',
          'prozess_konfigurieren',
          'stammdaten_pflegen',
          'benutzer_verwalten',
          'notfallzugriff',
        ],
        stempel: ['FREI', 'ABL', 'KLAER'],
      },
    ],
  },
  {
    id: 'se',
    verwaltungsart: 'se',
    name: 'Sondereigentumsverwaltung',
    beschreibung:
      'Der kleinste Zuschnitt: eine Rolle für die Arbeit am Beleg, eine für ' +
      'die Verwaltung des Systems. Die Freigabe bleibt trotzdem getrennt — ' +
      'sie ist der Grund, warum es überhaupt Stufen gibt.',
    rollen: [
      {
        kurzcode: 'VW',
        name: 'Verwaltung',
        beschreibung: 'Prüfen, kontieren, Einsicht gewähren, Stammdaten pflegen.',
        rechte: [
          'ansehen',
          'bearbeiten',
          'kontieren',
          'stempeln',
          'exportieren',
          'freigeben_einsicht',
          'stammdaten_pflegen',
        ],
        stempel: ['SACHL', 'RECHN', 'KLAER', 'ABL', 'KONT', 'ZAHL'],
      },
      {
        kurzcode: 'GL',
        name: 'Geschäftsleitung',
        beschreibung: 'Freigabe, Konfiguration, Benutzerverwaltung.',
        rechte: [
          'ansehen',
          'stempeln',
          'delegieren',
          'prozess_konfigurieren',
          'stammdaten_pflegen',
          'benutzer_verwalten',
          'notfallzugriff',
        ],
        stempel: ['FREI', 'ABL', 'KLAER'],
      },
    ],
  },
]

export interface Bilanz {
  rollenAngelegt: string[]
  /** Kurzcodes, die es schon gab — sie bleiben unverändert. */
  rollenVorhanden: string[]
  rechteAngelegt: number
  stempelrechteAngelegt: number
  /**
   * Stempelkurzcodes, zu denen es in diesem Haus keinen Stempeltyp gibt.
   *
   * **Wird gemeldet, nicht angelegt.** Einen Stempeltyp zu erzeugen ist
   * Ablaufkonfiguration und verlangt ein anderes Recht
   * (`prozess_konfigurieren`); ein Preset, das nebenbei Stempeltypen
   * erfindet, baut einen Ablauf, den niemand entworfen hat.
   */
  ohneStempeltyp: string[]
}

export function preset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id)
  if (p === undefined) throw new NichtMoeglich(`Unbekanntes Preset "${id}".`)
  return p
}

/**
 * Wendet ein Preset auf den Mandanten des Angemeldeten an.
 *
 * **Idempotent von Hand, nicht über `on conflict`.** Der naheliegende Weg
 * wäre `on conflict do nothing` — er trüge hier nicht: Der eindeutige Index
 * auf `rolle_recht` schließt `belegart` und `ordnungsgruppe_id` ein, und
 * beide sind hier `null`. In einem eindeutigen Index ist `null` von `null`
 * verschieden, der Konflikt entstünde also nie und jeder Lauf legte die
 * Rechte erneut an. `stempel_recht` hat überhaupt keine Eindeutigkeit.
 * Deshalb `where not exists`.
 */
export async function anwenden(
  c: PoolClient,
  presetId: string,
  /**
   * Für welches Haus — nur bei der **Ersteinrichtung** anzugeben.
   *
   * Presets sollen die Ersteinrichtung tragen, aber sie anzuwenden verlangt
   * `benutzer_verwalten` — und das entsteht erst durch das Preset. Diese
   * Henne fängt `scripts/einrichten.ts` ein: Es läuft als Eigentümer der
   * Tabellen, außerhalb der RLS, wie Migration und Seed. Für ein Haus, das
   * schon Benutzer hat, bleibt der gewöhnliche Weg über die Oberfläche —
   * dort greift die Policy.
   */
  mandantId: string | null = null,
): Promise<Bilanz> {
  const p = preset(presetId)
  const bilanz: Bilanz = {
    rollenAngelegt: [],
    rollenVorhanden: [],
    rechteAngelegt: 0,
    stempelrechteAngelegt: 0,
    ohneStempeltyp: [],
  }

  try {
    for (const r of p.rollen) {
      const { rows: da } = await c.query<{ id: string }>(
        `select id from rolle
          where mandant_id = coalesce($2::uuid, app.mein_mandant()) and kurzcode = $1`,
        [r.kurzcode, mandantId],
      )

      let rolleId = da[0]?.id
      if (rolleId === undefined) {
        const { rows } = await c.query<{ id: string }>(
          `insert into rolle (mandant_id, name, kurzcode, beschreibung)
           values (coalesce($4::uuid, app.mein_mandant()), $1, $2, $3) returning id`,
          [r.name, r.kurzcode, r.beschreibung, mandantId],
        )
        rolleId = rows[0]?.id
        if (rolleId === undefined) throw new NichtErlaubt(FEHLT)
        bilanz.rollenAngelegt.push(r.kurzcode)
      } else {
        bilanz.rollenVorhanden.push(r.kurzcode)
      }

      for (const aktion of r.rechte) {
        const e = await c.query(
          `insert into rolle_recht (rolle_id, aktion)
           select $1, $2
            where not exists (select 1 from rolle_recht
                               where rolle_id = $1 and aktion = $2
                                 and belegart is null and ordnungsgruppe_id is null)`,
          [rolleId, aktion],
        )
        bilanz.rechteAngelegt += e.rowCount ?? 0
      }

      for (const kurzcode of r.stempel) {
        const { rows: st } = await c.query<{ id: string }>(
          `select id from stempeltyp
            where mandant_id = coalesce($2::uuid, app.mein_mandant()) and kurzcode = $1`,
          [kurzcode, mandantId],
        )
        const typId = st[0]?.id
        if (typId === undefined) {
          if (!bilanz.ohneStempeltyp.includes(kurzcode)) bilanz.ohneStempeltyp.push(kurzcode)
          continue
        }
        const e = await c.query(
          `insert into stempel_recht (stempeltyp_id, rolle_id)
           select $1, $2
            where not exists (select 1 from stempel_recht
                               where stempeltyp_id = $1 and rolle_id = $2)`,
          [typId, rolleId],
        )
        bilanz.stempelrechteAngelegt += e.rowCount ?? 0
      }
    }
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler)
    if (text.includes('row-level security')) throw new NichtErlaubt(FEHLT)
    throw fehler
  }

  return bilanz
}

const FEHLT =
  'Dafür fehlt das Recht. Ein Preset legt Rollen, Rechte und ' +
  'Stempelzuordnungen an — das darf, wer Benutzer verwaltet.'
