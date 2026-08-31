/**
 * Die Belegliste unter Last messen.
 *
 *   npx tsx scripts/belegliste-messen.ts [anzahl]
 *
 * Konzept 21 hat gegen eine Million Dokumente gemessen und daraus drei
 * Designentscheidungen abgeleitet. Diese Entscheidungen stehen jetzt in
 * `src/belege/liste.ts` — also müssen sie hier nachgewiesen werden. „Ohne Zahl
 * keine Optimierung" gilt auch andersherum: Ohne Zahl auch keine übernommene
 * Optimierung.
 *
 * Gemessen wird, was sich unterscheidet:
 *
 *   * Feed naiv gegen Feed mit Top-N je Objekt (LATERAL),
 *   * die Akte eines Objekts — der Regelfall,
 *   * die gefilterte Liste über alle Objekte,
 *   * die Volltextsuche.
 *
 * Die synthetischen Daten liegen in einem eigenen Mandanten und bleiben nach
 * dem Lauf stehen -- entfernt werden sie mit `npm run db:reset`. Warum nicht
 * per DELETE: siehe `abschlusshinweis`.
 */

import { verbindungspool, poolSchliessen } from '../src/db'

const ANZAHL = Number(process.argv[2] ?? 1_000_000)
const OBJEKTE = 500
const OBJEKTE_JE_BENUTZER = 50
/** So viele Belege bekommen Seitentext — Volltext über alles wäre zu groß. */
const MIT_TEXT = 100_000

const MANDANT = '19000000-0000-0000-0000-000000000001'
const BENUTZER = '29000000-0000-0000-0000-000000000001'
const RAHMEN = '39000000-0000-0000-0000-000000000001'
const GRUPPE = '49000000-0000-0000-0000-000000000001'

const pool = verbindungspool()

async function alsEigentuemer<T>(aktion: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    return await aktion(c)
  } finally {
    c.release()
  }
}

/** Führt `frage` als dms_app im Namen des Testbenutzers aus und misst. */
async function messen(
  name: string,
  frage: string,
  werte: unknown[] = [],
  laeufe = 7,
): Promise<{ name: string; median: number; min: number; max: number; zeilen: number }> {
  const c = await pool.connect()
  const zeiten: number[] = []
  let zeilen = 0
  try {
    await c.query('begin')
    await c.query('set local role dms_app')
    await c.query('select set_config($1, $2, true)', ['app.benutzer_id', BENUTZER])

    // Zwei Aufwaermlaeufe: Der erste Aufruf zahlt den Planungsaufwand und
    // holt Seiten von der Platte. Gemessen werden soll der Betrieb, nicht der
    // Kaltstart.
    for (let i = 0; i < 2; i++) await c.query(frage, werte)

    for (let i = 0; i < laeufe; i++) {
      const start = process.hrtime.bigint()
      const { rows } = await c.query(frage, werte)
      zeiten.push(Number(process.hrtime.bigint() - start) / 1e6)
      zeilen = rows.length
    }
    await c.query('commit')
  } finally {
    c.release()
  }

  zeiten.sort((a, b) => a - b)
  return {
    name,
    median: zeiten[Math.floor(zeiten.length / 2)],
    min: zeiten[0],
    max: zeiten[zeiten.length - 1],
    zeilen,
  }
}

async function aufbauen(): Promise<void> {
  console.log(`Baue ${ANZAHL.toLocaleString('de-DE')} Belege auf ${OBJEKTE} Objekten auf …`)
  const start = Date.now()

  await alsEigentuemer(async (c) => {
    await c.query(
      `insert into mandant (id, name) values ($1, 'Messung (synthetisch)')
       on conflict (id) do nothing`,
      [MANDANT],
    )
    await c.query(
      `insert into benutzer (id, mandant_id, name, email)
       values ($1, $2, 'Messbenutzer', 'messung@example.invalid')
       on conflict (id) do nothing`,
      [BENUTZER, MANDANT],
    )
    await c.query(
      `insert into kontenrahmen (id, mandant_id, name)
       values ($1, $2, 'Messung') on conflict (id) do nothing`,
      [RAHMEN, MANDANT],
    )
    await c.query(
      `insert into ordnungsgruppe (id, mandant_id, name, kurzcode, sortierung, farbe)
       values ($1, $2, 'Messung', 'MSG', 10, '#2F6F4E')
       on conflict (id) do nothing`,
      [GRUPPE, MANDANT],
    )

    await c.query(
      `insert into objekt (id, mandant_id, objektnummer, bezeichnung, adresse,
                           verwaltungsart, kontenrahmen_id)
       select ('59000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
              $1, 'M' || g, 'Messobjekt ' || g, 'Teststrasse ' || g, 'weg', $2
         from generate_series(1, $3) g
       on conflict (id) do nothing`,
      [MANDANT, RAHMEN, OBJEKTE],
    )

    // Der Benutzer ist fuer 50 Objekte zustaendig -- wie in Konzept 21.
    await c.query(
      `insert into objekt_zustaendigkeit (objekt_id, benutzer_id, art)
       select ('59000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
              $1, 'hauptverantwortlich'
         from generate_series(1, $2) g
       on conflict do nothing`,
      [BENUTZER, OBJEKTE_JE_BENUTZER],
    )

    // Bewusst *keine* Rolle: Der Messbenutzer soll seine Sichtbarkeit
    // ausschliesslich aus der Objektzustaendigkeit beziehen. Mit einer
    // mandantenweiten Rolle saehe er alle 500 Objekte, und der Feed maesse
    // etwas anderes als den gemeinten Fall.

    console.log('  Dokumente …')
    await c.query(
      `insert into dokument (mandant_id, objekt_id, belegart, ordnungsgruppe_id,
                             eingangskanal, eingang_am, inhalt_hash,
                             storage_praefix, seitenzahl, ampel_gesamt, status)
       select $1,
              ('59000000-0000-0000-0000-' || lpad(((g % $3) + 1)::text, 12, '0'))::uuid,
              'rechnung', $2, 'mail',
              now() - (g % 3000) * interval '1 hour',
              md5(g::text), 'messung/' || g, 2,
              case g % 10 when 0 then 'rot' when 1 then 'orange' else 'gruen' end,
              'archiviert'
         from generate_series(1, $4) g`,
      [MANDANT, GRUPPE, OBJEKTE, ANZAHL],
    )

    console.log('  Seitentext …')
    await c.query(
      `insert into dokument_seite (dokument_id, seite, text)
       select d.id, 1,
              'Rechnung ueber Hausreinigung und Dachrinnenreinigung. '
              || 'Vorgangsnummer ' || d.storage_praefix
         from dokument d
        where d.mandant_id = $1
        order by d.eingang_am desc
        limit $2`,
      [MANDANT, MIT_TEXT],
    )

    console.log('  Statistiken …')
    await c.query('analyze dokument')
    await c.query('analyze dokument_seite')
  })

  console.log(`  fertig in ${Math.round((Date.now() - start) / 1000)} s`)
}

/**
 * Räumt **nicht** auf — und das ist die Lehre aus dem ersten Lauf.
 *
 * `delete from dokument where mandant_id = …` über eine Million Zeilen lief
 * nach zwanzig Minuten noch: Jede Zeile zieht Kaskaden über ein Dutzend
 * Kindtabellen nach sich, und solange sie läuft, hält sie Sperren, an denen
 * jede Migration hängen bleibt.
 *
 * `npm run db:reset` baut in etwa dreißig Sekunden alles neu auf. Für eine
 * Entwicklungsdatenbank mit wegwerfbaren Daten ist das der richtige Weg — und
 * ehrlicher, als zwanzig Minuten Löschen als „Aufräumen" auszugeben.
 */
function abschlusshinweis(): void {
  console.log('')
  console.log('Die synthetischen Daten bleiben stehen. Zum Entfernen:')
  console.log('  npm run db:reset')
}

/** Bricht ab, wenn schon Messdaten liegen — sonst misst der zweite Lauf doppelt. */
async function pruefenObFrei(): Promise<void> {
  const vorhanden = await alsEigentuemer(async (c) => {
    const { rows } = await c.query<{ n: string }>(
      'select count(*) as n from dokument where mandant_id = $1',
      [MANDANT],
    )
    return Number(rows[0].n)
  })
  if (vorhanden > 0) {
    console.error(
      `Es liegen bereits ${vorhanden.toLocaleString('de-DE')} Messbelege in der ` +
        'Datenbank. Erst `npm run db:reset`, dann erneut messen.',
    )
    process.exit(1)
  }
}

const SPALTEN = `d.id, d.eingang_am, d.ampel_gesamt, o.objektnummer`
const VERBINDUNG = `left join objekt o on o.id = d.objekt_id`

await pruefenObFrei()
await aufbauen()

try {

  const ergebnisse = [
    await messen(
      'Feed naiv (any(array) + order by + limit)',
      `select ${SPALTEN} from dokument d ${VERBINDUNG}
        where d.objekt_id = any (app.meine_objekte())
        order by d.eingang_am desc limit 50`,
    ),
    await messen(
      'Feed Top-N je Objekt (LATERAL)',
      `select ${SPALTEN}
         from unnest(app.meine_objekte()) as mein(objekt_id)
         cross join lateral (
           select dd.* from dokument dd
            where dd.objekt_id = mein.objekt_id
            order by dd.eingang_am desc limit 50
         ) d ${VERBINDUNG}
        order by d.eingang_am desc limit 50`,
    ),
    await messen(
      'Akte eines Objekts',
      `select ${SPALTEN} from dokument d ${VERBINDUNG}
        where d.objekt_id = '59000000-0000-0000-0000-000000000001'
        order by d.eingang_am desc limit 50`,
    ),
    await messen(
      'Gefilterte Liste (Ampel rot)',
      `select ${SPALTEN} from dokument d ${VERBINDUNG}
        where d.ampel_gesamt = 'rot'
        order by d.eingang_am desc limit 50`,
    ),
    await messen(
      'Volltext (ein Wort)',
      `select ${SPALTEN} from dokument d ${VERBINDUNG}
        where exists (select 1 from dokument_seite s
                       where s.dokument_id = d.id
                         and s.text_tsv @@ websearch_to_tsquery('german', 'Dachrinnenreinigung'))
        order by d.eingang_am desc limit 50`,
    ),
    await messen(
      'Zaehlung der gefilterten Liste',
      `select count(*) from dokument d where d.ampel_gesamt = 'rot'`,
    ),
  ]

  console.log('')
  console.log('| Abfrage | Median | Min | Max | Zeilen |')
  console.log('|---|---|---|---|---|')
  for (const e of ergebnisse) {
    const z = (w: number): string => `${w.toFixed(1)} ms`
    console.log(`| ${e.name} | **${z(e.median)}** | ${z(e.min)} | ${z(e.max)} | ${e.zeilen} |`)
  }
  console.log('')
} finally {
  abschlusshinweis()
  await poolSchliessen()
}
