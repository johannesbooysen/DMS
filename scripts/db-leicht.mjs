/**
 * Die leichte Entwicklungsdatenbank -- echtes PostgreSQL 17, ohne Docker.
 *
 *   npm run db:leicht          # starten; beim ersten Mal anlegen, migrieren, Seed
 *   npm run db:leicht:reset    # Datenverzeichnis loeschen und frisch aufbauen
 *
 * **Warum.** Die lokale Supabase-Instanz startet elf Container, von denen
 * die Anwendung einen braucht -- und davor Docker Desktop, das ueber Nacht
 * gern beendet ist. Beim Bedienen zweimal in einer Sitzung: Datenbank "tot",
 * dabei lief nur Docker nicht. Das Paket `embedded-postgres` bringt die
 * Postgres-Binaerdateien mit und startet eine Instanz in ein, zwei Sekunden
 * im Projektordner `.pgdata/` (nicht versioniert).
 *
 * **Warum kein SQLite.** Die Sicherheitsgrenze liegt in der Datenbank:
 * Zeilenrechte, security-definer-Funktionen, Trigger, Volltext, Trigramme.
 * Eine andere Datenbank wuerde genau das nicht pruefen. Hier laeuft dieselbe
 * Fassung wie im Betrieb (17), mit denselben Migrationen und demselben Seed.
 *
 * **Derselbe Port wie Supabase (15322)**, damit `DATABASE_URL` nirgends
 * gesetzt werden muss: `npm run vorschau`, `npm test` und die Skripte finden
 * die Datenbank wie bisher. Beide zugleich gehen deshalb nicht -- das Skript
 * sagt es, statt still zu scheitern.
 *
 * Migrationen spielt die Supabase-CLI ein (`migration up --db-url`), wie bei
 * jeder anderen Datenbank auch; der Seed laeuft als eine Abfrage ueber `pg`.
 * `npm run e2e` braucht weiter die Supabase-Instanz: Es setzt ueber
 * `supabase db reset` zurueck.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const PORT = 15322
const DIR = path.resolve('.pgdata')
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
const befehl = process.argv[2] ?? 'start'

function portFrei() {
  return new Promise((aufloesen) => {
    const s = createServer()
    s.once('error', () => aufloesen(false))
    s.once('listening', () => s.close(() => aufloesen(true)))
    s.listen(PORT, '127.0.0.1')
  })
}

if (!(await portFrei())) {
  console.error(
    `Auf Port ${PORT} antwortet schon eine Datenbank -- die Supabase-Instanz oder eine zweite leichte.\n` +
      'Erst beenden (npm run db:stop beziehungsweise Strg+C im anderen Fenster), dann erneut.',
  )
  process.exit(1)
}

if (befehl === 'reset' && existsSync(DIR)) {
  rmSync(DIR, { recursive: true, force: true })
  console.log('Datenverzeichnis geloescht.')
}

const frisch = !existsSync(path.join(DIR, 'PG_VERSION'))

const db = new EmbeddedPostgres({
  databaseDir: DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  // Dieselbe Spracheinstellung wie die Supabase-Instanz (en_US.UTF-8), damit
  // Sortierung und Gross-/Kleinschreibung (ilike auf Umlaute) gleich laufen.
  initdbFlags: ['--encoding=UTF8', '--locale=en-US', '--lc-messages=C'],
  onLog: () => {},
  onError: (m) => console.error(String(m instanceof Error ? m.message : m)),
})

const start = Date.now()
if (frisch) {
  console.log('Lege die Datenbank an …')
  await db.initialise()
}
await db.start()
console.log(`Postgres laeuft auf ${URL} (${Math.round((Date.now() - start) / 100) / 10} s)`)

if (frisch) {
  console.log('Migrationen …')
  // Eine Befehlszeile statt Argumentliste: Unter Windows braucht npx die Shell,
  // und Node warnt bei shell: true mit Argumenten -- die URL enthaelt nichts,
  // was eine Shell deutet.
  const cli = spawnSync(`npx supabase migration up --db-url ${URL}`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    encoding: 'utf8',
  })
  if (cli.status !== 0) {
    console.error(cli.stdout, cli.stderr)
    console.error('Migrationen fehlgeschlagen -- die Datenbank bleibt leer. npm run db:leicht:reset versucht es erneut.')
    await db.stop()
    process.exit(1)
  }
  const angewandt = (cli.stdout.match(/\.sql/g) ?? []).length
  console.log(`  ${angewandt} Migrationen eingespielt`)

  console.log('Seed …')
  const client = new pg.Client({ connectionString: URL })
  await client.connect()
  try {
    await client.query(readFileSync('supabase/seed.sql', 'utf8'))
  } finally {
    await client.end()
  }
  console.log('  Testdaten geladen')
}

console.log('\nBereit. Strg+C beendet die Datenbank; die Daten bleiben in .pgdata/.')
console.log('Keine Seitenbilder zu sehen? npm run vorschau:befuellen\n')

let beendet = false
const beenden = async () => {
  if (beendet) return
  beendet = true
  console.log('\nBeende Postgres …')
  await db.stop()
  process.exit(0)
}
process.on('SIGINT', () => void beenden())
process.on('SIGTERM', () => void beenden())
// Offen halten, bis ein Signal kommt.
setInterval(() => {}, 1 << 30)
