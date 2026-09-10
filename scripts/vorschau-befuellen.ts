/**
 * Gibt der Vorschau echte Belege.
 *
 *   npm run vorschau:befuellen
 *
 * WARUM ES DAS BRAUCHT
 *
 * Der Seed ist reine Datenbank: Belege, Laeufe, Aufgaben -- aber keine
 * einzige Datei. Fuer die Regeltests unter `tests/` ist das richtig, dort
 * geht es um Zeilen. Im Browser faellt es sofort auf: Der Viewer zeigt ein
 * kaputtes Bild, der PDF-Download antwortet mit 404. Wer die Oberflaeche
 * ansieht, sieht dann nicht die Anwendung, sondern eine Luecke in den
 * Testdaten -- und haelt das eine fuer das andere.
 *
 * WARUM ES ALLE BELEGE SIND UND NICHT ZWEI
 *
 * Der erste Entwurf rief nur die E2E-Vorbereitung auf: Sie gibt genau zwei
 * Belegen eine Datei, weil die Tests genau zwei brauchen. Beim ersten
 * Rundgang durch die Oberflaeche traf das prompt daneben -- vier von sechs
 * Belegen hatten keine, und wer einen davon anklickte, sah weder Seite noch
 * Stempel. "Die PDF-Dateien sind nicht sichtbar, die optischen Stempel auch
 * nicht." Eine Vorschau, in der zwei Drittel der Klicks ins Leere gehen,
 * beweist nichts ueber die Anwendung.
 *
 * Deshalb bekommt hier **jeder** Beleg eine Datei, der Seiten behauptet
 * (`seitenzahl > 0`) und keine hat -- durch die **gewoehnliche**
 * Aufbereitung, dieselbe, die der Worker faehrt. Seitentext, Vorschaubilder
 * und die freien Stempelplaetze entstehen so, wie sie im Betrieb entstehen;
 * nichts wird abgekuerzt.
 */

import type { PoolClient } from 'pg'
import { belegeAnlegen } from '../e2e/belege-anlegen'
import { DateisystemAblage, inhaltHash } from '../src/ablage'
import { poolSchliessen, verbindungspool } from '../src/db'
import { aufbereiten } from '../src/worker/aufbereitung'
import { stempeln } from '../src/workflow/engine'
import { pdfBauen } from '../tests/hilfe/pdf-bauen'

const WURZEL = process.env['DMS_ABLAGE'] ?? '.ablage'
/**
 * Eva und nicht Anna: Sie sieht mandantenweit.
 *
 * Anna traegt die Objektbearbeitung nur fuer Objekt 42 -- beim Befuellen
 * scheiterte deshalb der erste Beleg eines anderen Objekts an der Policy
 * (`new row violates row-level security policy`). Das ist die RLS bei der
 * Arbeit und kein Fehler; das Skript braucht nur jemanden, der weit genug
 * sieht.
 */
const EVA = '20000000-0000-0000-0000-000000000005'

interface Offen {
  id: string
  praefix: string
  bezeichnung: string
  seitenzahl: number
}

/**
 * Fuehrt `aktion` als Tabelleneigentuemer aus, mit gesetztem Benutzer.
 *
 * **Warum nicht `alsBenutzer`.** Der erste Entwurf nahm Anna, dann Eva --
 * beide scheiterten an `new row violates row-level security policy`, weil
 * die Policy auf `dokument_datei` an der Sichtbarkeit des Belegs haengt und
 * die Testbelege ueber mehrere Objekte streuen. Das ist die RLS bei der
 * Arbeit und kein Fehler.
 *
 * Ein Einrichtungsskript gehoert aber ohnehin auf dieselbe Ebene wie Seed
 * und Migration: unter den Eigentuemer, ausserhalb der RLS. Der
 * Benutzerkontext wird trotzdem gesetzt -- `aufbereiten` schreibt Spalten,
 * die nach `app.mein_benutzer()` fragen, und ein leeres Feld dort waere ein
 * Beleg ohne Urheber.
 */
async function alsEinrichter<T>(aktion: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await verbindungspool().connect()
  try {
    await c.query('begin')
    await c.query('select set_config($1, $2, true)', ['app.benutzer_id', EVA])
    const ergebnis = await aktion(c)
    await c.query('commit')
    return ergebnis
  } catch (fehler) {
    await c.query('rollback')
    throw fehler
  } finally {
    c.release()
  }
}

/** Belege, die Seiten behaupten, aber keine Datei haben. */
async function ohneDatei(c: PoolClient): Promise<Offen[]> {
  const { rows } = await c.query<Offen>(
    `select d.id,
            d.storage_praefix as praefix,
            coalesce(k.name || ' ' || coalesce(r.rechnungsnummer, ''), 'Beleg') as bezeichnung,
            d.seitenzahl
       from dokument d
       left join rechnung_fakten r on r.dokument_id = d.id
       left join kreditor k on k.id = r.kreditor_id
      where d.seitenzahl > 0
        and not exists (select 1 from dokument_datei f
                         where f.dokument_id = d.id and f.variante = 'original')
      order by d.eingang_am`,
  )
  return rows
}

/** Ein schlichtes, aber echtes PDF mit so vielen Seiten wie behauptet. */
function vorlage(b: Offen): { zeilen: string[] }[] {
  return Array.from({ length: b.seitenzahl }, (_, i) => ({
    zeilen: [
      b.bezeichnung.trim(),
      `Seite ${i + 1} von ${b.seitenzahl}`,
      'Beispielbeleg der Vorschau -- erfundene Daten, keine echten Personen.',
      'Dieser Text ist echter Textlayer und damit durchsuchbar.',
    ],
  }))
}

async function main(): Promise<void> {
  console.log(`Belege aufbereiten nach ${WURZEL} …`)

  const ablage = new DateisystemAblage(WURZEL)

  /*
   * **Wiederholbar.** `belegeAnlegen` ist es nicht: Es startet fuer einen
   * Beleg einen eigenen Lauf, und beim zweiten Aufruf kollidiert der mit dem
   * ersten (`dokument_lauf_dokument_id_key`). Im E2E-Lauf faellt das nie
   * auf, weil dort immer ein `db:reset` davor steht.
   *
   * Hier nicht: Wer die Vorschau befuellt, ruft das irgendwann ein zweites
   * Mal auf -- und ein Skript, das dann mit einem Datenbankfehler abbricht,
   * sieht aus wie ein kaputtes System. Also erst nachsehen, ob schon etwas
   * da ist.
   */
  const c = await verbindungspool().connect()
  let schonDa: boolean
  let offen: Offen[]
  try {
    const { rows } = await c.query<{ n: number }>(
      "select count(*)::int as n from dokument_datei where variante = 'original'",
    )
    schonDa = (rows[0]?.n ?? 0) > 0
    if (!schonDa) {
      c.release()
      // Die beiden ausgearbeiteten Belege der E2E-Vorbereitung: Sie tragen
      // richtige Rechnungstexte und einen eigenen Lauf.
      await belegeAnlegen(WURZEL)
    }
    const k = schonDa ? c : await verbindungspool().connect()
    try {
      offen = await ohneDatei(k)
    } finally {
      k.release()
    }
  } catch (fehler) {
    c.release()
    throw fehler
  }
  if (schonDa) console.log('  (bereits befuellt -- nur die offenen Belege)')

  for (const b of offen) {
    const pdf = await pdfBauen(vorlage(b))
    const schluessel = `${b.praefix}/original.pdf`
    await ablage.schreiben(schluessel, pdf)

    await alsEinrichter(async (k) => {
      await k.query(
        `insert into dokument_datei (dokument_id, variante, storage_key, mime, groesse)
         values ($1, 'original', $2, 'application/pdf', $3)
         on conflict do nothing`,
        [b.id, schluessel, pdf.byteLength],
      )
      await k.query('update dokument set inhalt_hash = $2 where id = $1', [b.id, inhaltHash(pdf)])
      // Der gewoehnliche Weg, nicht abgekuerzt: derselbe `aufbereiten`, den
      // der Worker fuer einen frisch hochgeladenen Beleg fährt.
      await aufbereiten(k, ablage, b.id, null)
    })
    console.log(`  ${b.bezeichnung.trim()} — ${b.seitenzahl} Seite(n)`)
  }

  /*
   * **Ein Stempel steht von Anfang an auf einem Beleg.**
   *
   * Sonst zeigt die Vorschau eine leere Seite, und wer nicht weiss, dass man
   * erst ueber das Postfach stempeln muss, sieht die halbe Anwendung nicht:
   * "die optischen Stempel auch nicht [sichtbar]". Ein Stempel, den man
   * sofort sieht, erklaert mehr als jede Beschreibung.
   *
   * Gestempelt wird ueber die **gewoehnliche** Engine, nicht per Insert --
   * damit Hash-Kette, Layer und Aufgabenfortschritt so entstehen wie im
   * Betrieb. Die uebrigen Aufgaben bleiben offen, es gibt also weiterhin
   * etwas zum Ausprobieren.
   */
  const gestempelt = await alsEinrichter(async (k) => {
    const { rows } = await k.query<{
      id: string
      lauf_id: string
      stufe_id: string
      benutzer: string
      stempeltyp: string | null
    }>(
      /*
       * Nur ein Lauf mit **Blockbaum**. Der erste Entwurf nahm die naechste
       * faellige Aufgabe und scheiterte an "Kein Blockbaum zur Definition":
       * Nicht jede Definition im Seed hat `prozessknoten`, und die Engine
       * laeuft einen Baum ab. Ein Einrichtungsskript, das daran abbricht,
       * sieht aus wie ein kaputtes System.
       */
      /*
       * **Mit Stempeltyp.** Ohne ihn entsteht ein Stempel ohne Aussage: Der
       * Trigger baut den Layertext aus dem Namen des Typs, und der Layer las
       * dann " · Anna Ahrens · 10.09.2026". Die Oberflaeche gibt den Typ
       * mit, weil die Stufe vorgibt, welche Stempel dort erlaubt sind --
       * hier muss er ebenso mitkommen.
       */
      `select a.id, a.lauf_id, a.stufe_id, a.zugewiesen_benutzer as benutzer,
              (select st.stempeltyp_id
                 from prozessstufe_stempeltyp st
                 join stempeltyp t on t.id = st.stempeltyp_id
                where st.stufe_id = a.stufe_id and t.entscheidung = 'freigabe'
                order by st.sortierung
                limit 1) as stempeltyp
         from aufgabe a
         join dokument_lauf l on l.id = a.lauf_id
         join dokument_datei f on f.dokument_id = l.dokument_id
                             and f.variante = 'ansicht_webp'
        where a.status = 'offen'
          and a.zugewiesen_benutzer is not null
          and exists (select 1 from prozessknoten n
                       where n.definition_id = l.definition_id)
        order by a.faellig_am
        limit 1`,
    )
    const a = rows[0]
    if (a === undefined) return false
    await k.query('select set_config($1, $2, true)', ['app.benutzer_id', a.benutzer])
    if (a.stempeltyp === null) return false
    await stempeln(k, {
      laufId: a.lauf_id,
      stufeId: a.stufe_id,
      benutzerId: a.benutzer,
      stempeltypId: a.stempeltyp,
      entscheidung: 'freigabe',
    })
    return true
  })

  console.log(`Fertig: 2 ausgearbeitete Belege, ${offen.length} weitere aufbereitet.`)
  console.log('Jeder Beleg mit Seiten hat jetzt eine Datei -- kein Klick geht ins Leere.')
  if (gestempelt) {
    console.log('Ein Beleg ist bereits gestempelt -- der Stempel steht sichtbar auf der Seite.')
  }
}

main()
  .catch((fehler: unknown) => {
    console.error('Befuellen fehlgeschlagen:', fehler instanceof Error ? fehler.message : fehler)
    process.exitCode = 1
  })
  .finally(poolSchliessen)
