/**
 * Sicherung ziehen (Konzept §24.7).
 *
 *   npm run sicherung [zielverzeichnis]
 *
 * Zwei Dateien: das Abbild der Datenbank und ein **Manifest** mit den
 * Zählwerten. Das Manifest ist der Teil, den man leicht weglässt und ohne
 * den die Probe nichts wert ist — wenn beim Zurückholen die Hälfte der
 * Belege fehlt, sieht die Datenbank in sich völlig stimmig aus. Erst der
 * Vergleich mit den Zahlen von vorher deckt es auf.
 *
 * **Nicht gesichert wird hier der Objektspeicher.** Das ist keine Lücke,
 * sondern eine Grenze: Die Belegdateien liegen in S3 mit Object Lock, und
 * ein zweiter Satz Kopien wäre ein zweiter Ort, an dem sie altern. Wie der
 * Objektspeicher gesichert wird, steht im organisatorischen Teil der
 * Verfahrensdokumentation — dort gehört es hin, weil es eine Entscheidung
 * über Infrastruktur ist und keine über Code.
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { poolSchliessen, verbindungspool } from '../src/db'
import { manifestErstellen } from '../src/sicherung'

const ziel = resolve(process.argv[2] ?? join('sicherung', new Date().toISOString().slice(0, 10)))

/**
 * `pg_dump` — von der PATH, sonst aus dem Container.
 *
 * In der Entwicklung läuft PostgreSQL im Docker-Container von Supabase und
 * `pg_dump` ist auf dem Rechner gar nicht installiert. Auf einem Server ist
 * es umgekehrt. Beides zu können erspart eine Fallunterscheidung in der
 * Anleitung — und eine Anleitung, die auf dem Entwicklungsrechner nicht
 * funktioniert, wird nie ausprobiert.
 */
function dumpBefehl(zieldatei: string): { befehl: string; argumente: string[] } {
  const url = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  const container = process.env['DMS_PG_CONTAINER']

  const gemeinsam = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    /*
     * Nur die Schemata der Anwendung.
     *
     * Ohne diese Einschraenkung nimmt `pg_dump` die internen Schemata der
     * lokalen Supabase-Instanz mit (`vault`, `auth`, `storage` und weitere),
     * die dem Dienst gehoeren und nicht der Anwendung. Gemessen: Das
     * Zurueckholen ergab damit **119 ignorierte Fehler** -- alle aus diesen
     * Schemata, alle folgenlos fuer die Anwendung.
     *
     * Genau solche Fehler sind das Problem. Sie stehen in der Ausgabe, sie
     * bedeuten nichts, und deshalb liest sie nach dem dritten Mal niemand
     * mehr -- auch den einen nicht, der etwas bedeutet hat. Mit dieser
     * Einschraenkung ist das Zurueckholen **fehlerfrei**, und damit ist
     * jeder Fehler ein Befund.
     */
    '--schema=public',
    '--schema=app',
    url,
  ]

  if (container !== undefined && container !== '') {
    /*
     * Im Container gilt die Adresse des Hosts nicht: Dort lauscht PostgreSQL
     * auf 5432, und 127.0.0.1:54322 zeigt ins Leere. Deshalb nicht die
     * DATABASE_URL durchreichen, sondern die Verbindung im Container
     * benennen -- ueberschreibbar ueber DMS_PG_URL_INTERN, falls dort etwas
     * anderes laeuft.
     *
     * Das Abbild kommt ueber die Standardausgabe zurueck; `--file` waere ein
     * Pfad *im* Container und laege dort, wo ihn niemand sucht.
     */
    const intern =
      process.env['DMS_PG_URL_INTERN'] ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
    return {
      befehl: 'docker',
      argumente: ['exec', container, 'pg_dump', ...gemeinsam.slice(0, -1), intern],
    }
  }
  return { befehl: 'pg_dump', argumente: [...gemeinsam, `--file=${zieldatei}`] }
}

async function dumpZiehen(zieldatei: string): Promise<void> {
  const { befehl, argumente } = dumpBefehl(zieldatei)
  const ueberStdout = befehl === 'docker'

  await new Promise<void>((fertig, scheitern) => {
    const kind = spawn(befehl, argumente, {
      stdio: ueberStdout ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'pipe'],
    })

    const stuecke: Buffer[] = []
    if (ueberStdout) kind.stdout?.on('data', (b: Buffer) => stuecke.push(b))

    let fehlertext = ''
    kind.stderr?.on('data', (b: Buffer) => {
      fehlertext += b.toString()
    })

    kind.on('error', (fehler) => {
      scheitern(
        new Error(
          `${befehl} liess sich nicht starten: ${fehler.message}\n` +
            'Ist pg_dump installiert? Sonst DMS_PG_CONTAINER auf den Namen des ' +
            'PostgreSQL-Containers setzen (in der Entwicklung: supabase_db_DMS).',
        ),
      )
    })

    kind.on('close', (code) => {
      if (code !== 0) {
        scheitern(new Error(`${befehl} endete mit ${String(code)}:\n${fehlertext.slice(0, 800)}`))
        return
      }
      if (ueberStdout) {
        void writeFile(zieldatei, Buffer.concat(stuecke)).then(fertig, scheitern)
      } else {
        fertig()
      }
    })
  })
}

await mkdir(ziel, { recursive: true })

const abbild = join(ziel, 'datenbank.dump')
await dumpZiehen(abbild)

/*
 * Das Manifest **nach** dem Abbild.
 *
 * Andersherum koennten zwischen Zaehlen und Abbild Belege dazukommen, und
 * die Probe meldete dann Zeilen, die es zum Zeitpunkt der Zaehlung noch gar
 * nicht gab. So herum kann das Abbild nur *aelter* sein als die Zaehlung --
 * und der Vergleich meldet nur "weniger", nie "mehr".
 */
/*
 * Als Eigentuemer und **nicht** ueber `alsAnmeldung`.
 *
 * Das war der erste Entwurf und war still falsch: `alsAnmeldung` setzt die
 * Rolle `dms_app` ohne Benutzer, und unter RLS liefert dann jede Zaehlung
 * null. Das Manifest haette lauter Nullen enthalten, der Vergleich nach dem
 * Restore waere immer aufgegangen -- eine Probe, die nie etwas findet, ist
 * schlimmer als keine.
 *
 * Hier ist der Eigentuemer richtig: Gezaehlt wird der Bestand, nicht das,
 * was ein bestimmter Benutzer davon sehen darf.
 */
const client = await verbindungspool().connect()
let manifest
try {
  manifest = await manifestErstellen(client)
} finally {
  client.release()
}
await writeFile(join(ziel, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

console.log(`Sicherung in ${ziel}`)
console.log(`  datenbank.dump`)
console.log(`  manifest.json  (${Object.keys(manifest.zaehler).length} Zaehlwerte)`)
console.log(
  '\nDie Sicherung ist erst dann eine, wenn sie zurueckgeholt wurde:\n' +
    '  npm run sicherung:pruefen -- ' +
    ziel,
)

await poolSchliessen()
