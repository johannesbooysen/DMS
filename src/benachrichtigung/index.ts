/**
 * Benachrichtigungen (Konzept §24.9).
 *
 * Das Konzept lässt die Frage offen: „Mail oder nur Zähler in der
 * Oberfläche". Die Antwort ist **beides, verschieden dosiert**:
 *
 *   * Der **Zähler** steht neben dem Postfach und wirkt ständig. Er kostet
 *     nichts und ist die wirksamere Hälfte — wer im System arbeitet, sieht
 *     ihn dauernd.
 *   * Die **Sammelmail** kommt einmal am Tag und nur, wenn es etwas zu sagen
 *     gibt. Eine Mail je Aufgabe hält zwei Wochen; danach filtert sie jeder
 *     in einen Ordner, den niemand öffnet — und dann ist auch die eine Mail
 *     verloren, die wichtig war.
 *
 * **In der Mail steht kein Beleg.** Nur Zahlen und ein Link. Ein Postfach
 * ist schlechter geschützt als dieses System — keine RLS, keine Sitzung,
 * kein Protokoll — und eine Aufzählung der fälligen Belege wäre eine zweite,
 * schwächere Kopie des Bestands, die täglich neu entstünde. Die Weißliste in
 * `src/postausgang/vorlagen.ts` lässt gar nichts anderes zu.
 *
 * **Nichts verlässt das Haus außerhalb des Ausgangsbuchs**: Die Mail wird
 * über `postAnlegen` eingetragen und später vom Worker gesendet. Ein
 * hängender Mailserver darf keinen Durchgang blockieren.
 */

import type { PoolClient } from 'pg'
import { alsAnmeldung, alsBenutzer } from '@/db'
import { postAnlegen } from '@/postausgang'


/**
 * Wohin der Link in der Mail zeigt.
 *
 * Aus der Umgebung und nicht über `basisUrl()`: Die Funktion liest die
 * Kopfzeilen der Anfrage, und der Worker hat keine. Ohne `DMS_BASIS_URL`
 * entsteht **keine** Sammelmail — eine Benachrichtigung mit einem Link ins
 * Leere ist schlechter als keine, weil sie den Empfänger zweimal Zeit
 * kostet: einmal beim Lesen und einmal beim Nachfragen.
 */
export function basisAdresse(): string | null {
  const wert = process.env['DMS_BASIS_URL']
  // Ohne Schrägstrich am Ende — sonst steht in der Mail ein Link mit zwei.
  return wert === undefined || wert === '' ? null : wert.replace(/\/+$/, '')
}

export interface Zaehler {
  offen: number
  ueberfaellig: number
}

/**
 * Offene und überfällige Aufgaben des Angemeldeten.
 *
 * Läuft unter seinen Rechten — ein Zähler, der mehr zählt als die Liste
 * darunter zeigt, ist schlimmer als keiner.
 */
export async function zaehlerLaden(c: PoolClient): Promise<Zaehler> {
  const { rows } = await c.query<{ offen: string; ueberfaellig: string }>(
    'select offen, ueberfaellig from app.aufgaben_zaehler()',
  )
  return {
    offen: Number(rows[0]?.offen ?? 0),
    ueberfaellig: Number(rows[0]?.ueberfaellig ?? 0),
  }
}

export interface Wunsch {
  taeglich: boolean
  stunde: number
}

/** Ohne Zeile gilt an — siehe Migration `20260907100000`. */
export async function wunschLaden(c: PoolClient): Promise<Wunsch> {
  const { rows } = await c.query<{ taeglich: boolean; stunde: number }>(
    `select coalesce(n.taeglich, true) as taeglich, coalesce(n.stunde, 7) as stunde
       from (select 1) x
       left join benachrichtigung n on n.benutzer_id = app.mein_benutzer()`,
  )
  return {
    taeglich: rows[0]?.taeglich ?? true,
    stunde: Number(rows[0]?.stunde ?? 7),
  }
}

export async function wunschSpeichern(
  c: PoolClient,
  wunsch: { taeglich: boolean; stunde: number },
): Promise<void> {
  if (!Number.isInteger(wunsch.stunde) || wunsch.stunde < 0 || wunsch.stunde > 23) {
    throw new Error('Die Stunde muss zwischen 0 und 23 liegen.')
  }
  await c.query(
    `insert into benachrichtigung (benutzer_id, taeglich, stunde, geaendert_am)
     values (app.mein_benutzer(), $1, $2, now())
     on conflict (benutzer_id)
     do update set taeglich = excluded.taeglich, stunde = excluded.stunde,
                   geaendert_am = now()`,
    [wunsch.taeglich, wunsch.stunde],
  )
}

export interface Versandbilanz {
  eingetragen: number
  gescheitert: number
}

/**
 * Trägt die fälligen Sammelmails ins Ausgangsbuch ein.
 *
 * **Eintragen und vermerken in einer Transaktion.** Andersherum entstünde
 * bei einem Abbruch dazwischen entweder eine zweite Mail am selben Tag oder
 * ein Vermerk ohne Mail — und dann wäre der Tag still verloren. Beides ist
 * unnötig, weil beides in dieselbe Transaktion passt.
 *
 * **Wer fällig ist, fragt der Worker ohne Benutzer** — er hat keinen, und
 * `app.benachrichtigung_faellig` ist dafür `security definer` und gibt nur
 * Zahlen heraus. **Eingetragen wird dann unter dem Empfänger**: Sonst fände
 * `postAnlegen` die Vorlage nicht, und der Ausgang landete ohne Mandanten.
 */
export async function sammelmailsEintragen(stunde?: number): Promise<Versandbilanz> {
  const basis = basisAdresse()
  if (basis === null) return { eingetragen: 0, gescheitert: 0 }

  const faellige = await alsAnmeldung(async (c) => {
    const { rows } = await c.query<{
      benutzer_id: string
      name: string
      email: string
      anzahl: string
      ueberfaellig: string
    }>(
      `select benutzer_id, name, email, anzahl, ueberfaellig
         from app.benachrichtigung_faellig(
                coalesce($1::integer, extract(hour from now())::integer))`,
      [stunde ?? null],
    )
    return rows
  })

  let eingetragen = 0
  let gescheitert = 0

  for (const z of faellige) {
    try {
      /*
       * Unter den Rechten des Empfängers, nicht als System.
       *
       * Mein erster Entwurf nahm `alsAnmeldung` — also `dms_app` ohne
       * Benutzer. Dann ist `app.mein_mandant()` leer, die Policy auf
       * `vorlage` liefert nichts, und `postAnlegen` findet die Vorlage
       * nicht. Es entstand kein einziger Ausgang, und der Fehler verschwand
       * im `catch` darunter — gefunden nur, weil ein Test die Zeilen
       * nachzählte, statt das Ausbleiben eines Fehlers zu prüfen.
       *
       * Unter dem Empfänger stimmt außerdem der Mandant von selbst: Der
       * Ausgang gehört in sein Haus, nicht in ein technisches.
       */
      await alsBenutzer(z.benutzer_id, async (c) => {
        await postAnlegen(c, {
          schluessel: 'tagesuebersicht',
          anlass: 'Taegliche Uebersicht',
          empfaenger: z.email,
          werte: {
            empfaenger: z.name,
            anzahl: z.anzahl,
            ueberfaellig: z.ueberfaellig,
            // Der Link fuehrt ins Postfach -- dorthin, wo die Berechtigung
            // gilt. Er ist die einzige Auskunft der Mail ueber den Bestand.
            link: `${basis}/postfach`,
          },
        })
        await c.query('select app.benachrichtigung_vermerken($1)', [z.benutzer_id])
      })
      eingetragen += 1
    } catch {
      /*
       * Keine Adresse und kein Name ins Log -- eine Postfachadresse ist eine
       * personenbezogene Angabe (Projektregel). Der Vermerk bleibt aus, und
       * der naechste Durchgang in derselben Stunde versucht es erneut.
       */
      gescheitert += 1
    }
  }

  return { eingetragen, gescheitert }
}
