/**
 * Die Restore-Probe (Konzept §24.7).
 *
 *   npm run sicherung:pruefen -- <sicherungsverzeichnis>
 *
 * „Ein Archiv ohne getesteten Restore ist kein Archiv." Dieses Skript ist
 * der Test. Es holt die Sicherung in eine **eigene, wegwerfbare Datenbank**
 * zurück und stellt dort die Fragen, die ein erfolgreicher `pg_restore`
 * nicht beantwortet:
 *
 *   1. Ist das Zurückholen fehlerfrei durchgelaufen?
 *   2. Sind alle Zeilen da? (gegen das Manifest)
 *   3. Trägt die Hash-Kette?
 *   4. Greifen RLS, Policies und die append-only-Trigger noch?
 *   5. Liegen die archivierten Dateien noch, und sind es dieselben?
 *
 * Die vierte Frage ist die, wegen der es dieses Skript gibt. `pg_restore`
 * bringt Zeilen zurück und sagt nichts darüber, ob die Schutzmechanismen
 * daran hängen — und ein System ohne RLS sieht im Betrieb völlig normal aus.
 *
 * **Es wird in eine neue Datenbank zurückgeholt, nie in die laufende.** Eine
 * Probe, die den Betrieb überschreiben kann, wird aus gutem Grund nie
 * ausgeführt — und damit ist sie keine Probe mehr, sondern eine Notiz.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Client, type PoolClient } from 'pg'
import { DateisystemAblage, type Ablage } from '../src/ablage'
import { s3AusUmgebung } from '../src/ablage-s3'
import {
  archivPruefen,
  manifestErstellen,
  manifestVergleichen,
  type Befund,
  type Manifest,
} from '../src/sicherung'

const quelle = process.argv[2]
if (quelle === undefined || quelle === '') {
  console.error('Aufruf: npm run sicherung:pruefen -- <sicherungsverzeichnis>')
  process.exit(1)
}
const verzeichnis = resolve(quelle)

const BASIS =
  process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:15322/postgres'
const CONTAINER = process.env['DMS_PG_CONTAINER']
const imContainer = CONTAINER !== undefined && CONTAINER !== ''
const INTERN =
  process.env['DMS_PG_URL_INTERN'] ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'

/** Ein Name, den niemand versehentlich für die Produktivdatenbank hält. */
const PROBE = `dms_probe_${Date.now().toString(36)}`

const aufDatenbank = (url: string, name: string): string => url.replace(/\/[^/]*$/, `/${name}`)

interface Ergebnis {
  code: number
  aus: string
  fehler: string
}

function lauf(befehl: string, argumente: string[], eingabe?: Buffer): Promise<Ergebnis> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(befehl, argumente, {
      stdio: [eingabe === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let aus = ''
    let fehler = ''
    kind.stdout?.on('data', (b: Buffer) => {
      aus += b.toString()
    })
    kind.stderr?.on('data', (b: Buffer) => {
      fehler += b.toString()
    })
    kind.on('error', (f) =>
      scheitern(
        new Error(
          `${befehl} liess sich nicht starten: ${f.message}\n` +
            'Sind psql und pg_restore installiert? Sonst DMS_PG_CONTAINER auf den ' +
            'Namen des PostgreSQL-Containers setzen (Entwicklung: supabase_db_DMS).',
        ),
      ),
    )
    // Der Rueckgabewert wird zurueckgegeben, nicht bewertet: `pg_restore`
    // bricht bei einem Fehler nicht ab, sondern zaehlt ihn und macht weiter.
    // Ob die Sicherung taugt, entscheiden die Pruefungen danach.
    kind.on('close', (code) => fertig({ code: code ?? 0, aus, fehler }))
    if (eingabe !== undefined) {
      kind.stdin?.write(eingabe)
      kind.stdin?.end()
    }
  })
}

/** psql gegen eine Datenbank. Fehler hier sind echte Abbrüche. */
async function psql(sql: string, datenbank = 'postgres'): Promise<void> {
  const url = aufDatenbank(imContainer ? INTERN : BASIS, datenbank)
  const e = imContainer
    ? await lauf('docker', ['exec', CONTAINER as string, 'psql', url, '-v', 'ON_ERROR_STOP=1', '-c', sql])
    : await lauf('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', sql])
  if (e.code !== 0) {
    throw new Error(`psql endete mit ${String(e.code)}:\n${e.fehler.slice(0, 800)}`)
  }
}

async function restore(abbild: Buffer): Promise<string> {
  const url = aufDatenbank(imContainer ? INTERN : BASIS, PROBE)
  const e = imContainer
    ? await lauf('docker', ['exec', '-i', CONTAINER as string, 'pg_restore', '--dbname', url], abbild)
    : await lauf('pg_restore', ['--dbname', url], abbild)
  return e.fehler
}

/**
 * Fehlerzeilen von `pg_restore` werden Befunde — nicht Hinweise.
 *
 * Der erste Entwurf schrieb die erste Zeile als „Hinweis" ins Protokoll und
 * meldete anschließend „Die Sicherung trägt". Bei 119 ignorierten Fehlern.
 * Eine Probe, die einen Fehlschlag als Randbemerkung führt, ist keine.
 *
 * Möglich ist die Strenge erst, seit die Sicherung auf `public` und `app`
 * eingeschränkt ist: Vorher kamen 119 folgenlose Fehler aus den internen
 * Schemata der lokalen Supabase-Instanz, und in solchem Rauschen liest
 * niemand mehr die eine Zeile, die etwas bedeutet.
 */
function restorebefunde(ausgabe: string): Befund[] {
  return ausgabe
    .split('\n')
    .filter((z) => z.includes('error:'))
    .slice(0, 20)
    .map((z) => ({
      art: 'restore_fehler',
      schwere: 'hart' as const,
      gegenstand: 'pg_restore',
      text: z.replace(/^pg_restore:\s*/, '').trim(),
    }))
}

const manifestVorher = JSON.parse(
  await readFile(join(verzeichnis, 'manifest.json'), 'utf8'),
) as Manifest
const abbild = await readFile(join(verzeichnis, 'datenbank.dump'))

console.log(`Probe in Datenbank ${PROBE}`)
console.log(`  Sicherung vom ${manifestVorher.erstellt}`)

let bericht: Awaited<ReturnType<typeof archivPruefen>> | null = null
const befunde: Befund[] = []

await psql(`create database ${PROBE}`)
try {
  /*
   * Das leere `public` weg, bevor zurueckgeholt wird.
   *
   * `create database` legt es an, und die Sicherung bringt ein
   * `create schema public` mit -- das ergaebe einen Fehler, der nichts
   * bedeutet. Ihn wegzuraeumen ist besser, als ihn spaeter
   * wegzuklassifizieren: Eine Ausnahmeliste waechst, und irgendwann steht
   * darin auch der Fehler, der zaehlt.
   */
  await psql('drop schema if exists public cascade', PROBE)

  befunde.push(...restorebefunde(await restore(abbild)))

  const client = new Client(aufDatenbank(BASIS, PROBE))
  await client.connect()
  try {
    const alsPool = client as unknown as PoolClient
    befunde.push(...manifestVergleichen(manifestVorher, await manifestErstellen(alsPool)))

    /*
     * Die Ablage ist dieselbe wie im Betrieb -- die Dateien werden ja nicht
     * mitgesichert (siehe scripts/sicherung.ts). Geprueft wird, ob die
     * zurueckgeholten Archiveintraege noch auf vorhandene, unveraenderte
     * Dateien zeigen.
     */
    const ablage: Ablage =
      s3AusUmgebung() ?? new DateisystemAblage(process.env['DMS_ABLAGE'] ?? resolve('.ablage'))

    bericht = await archivPruefen(alsPool, ablage)
    befunde.push(...bericht.befunde)
  } finally {
    await client.end()
  }
} finally {
  // Immer aufraeumen, auch nach einem Fehlschlag: Eine liegengebliebene
  // Probedatenbank waere beim naechsten Mal ein zweiter Kandidat mit
  // denselben Daten -- und irgendwann fragt jemand, welche die echte ist.
  await psql(`drop database if exists ${PROBE} with (force)`).catch(() => {
    console.error(`  Die Probedatenbank ${PROBE} liess sich nicht entfernen.`)
  })
}

console.log('\nGeprueft:')
console.log(`  ${bericht?.geprueft.ereignisse ?? 0} Stempelereignisse (Hash-Kette)`)
console.log(`  ${bericht?.geprueft.archiveintraege ?? 0} Archiveintraege`)
console.log(`  ${bericht?.geprueft.dateien ?? 0} Dateien gelesen und nachgerechnet`)

if (befunde.length > 0) {
  console.error(`\n${befunde.length} Befund(e):`)
  for (const b of befunde) console.error(`  [${b.art}] ${b.gegenstand}: ${b.text}`)
  console.error(
    '\nDiese Sicherung ist nicht verwendbar. Was hier steht, faellt sonst erst\n' +
      'im Ernstfall auf -- also dann, wenn es keine zweite Gelegenheit gibt.',
  )
  process.exit(1)
}

/*
 * "Nichts gefunden" ist nicht "nichts zu finden".
 *
 * Bei einer frisch aufgesetzten Datenbank gibt es keine Stempelereignisse
 * und keine Archiveintraege -- die Kettenpruefung und die Dateipruefung
 * laufen dann durch, ohne irgendetwas angesehen zu haben. Genau so meldete
 * der erste Entwurf "Die Sicherung traegt", nachdem er null Zeilen geprueft
 * hatte.
 *
 * Eine Probe, die das nicht sagt, erzieht dazu, ihr zu glauben.
 */
if ((bericht?.geprueft.ereignisse ?? 0) === 0 && (bericht?.geprueft.archiveintraege ?? 0) === 0) {
  console.log('\nZeilen vollstaendig und Schutzmechanismen aktiv.')
  console.log(
    'ABER: Die Sicherung enthaelt weder Stempelereignisse noch Archiveintraege.\n' +
      'Hash-Kette und Dateipruefung haben nichts vorgefunden, was zu pruefen\n' +
      'gewesen waere -- diese Probe belegt sie also nicht.',
  )
  process.exit(0)
}

console.log('\nDie Sicherung traegt: Zurueckholen fehlerfrei, Zeilen vollstaendig,')
console.log('Kette unversehrt, Schutzmechanismen aktiv, Dateien unveraendert.')
process.exit(0)
