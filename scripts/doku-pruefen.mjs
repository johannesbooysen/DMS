/**
 * Prueft, ob die Dokumentation zum Repository passt.
 *
 * Laeuft als `npm run docs:check` und im Pre-Commit-Hook. Geprueft wird nur,
 * was sich sicher entscheiden laesst -- eine Pruefung, die bei jeder zweiten
 * Aenderung falsch anschlaegt, wird abgeschaltet und nuetzt dann niemandem:
 *
 *   1. docs/stand.md ist auf dem aktuellen Stand
 *   2. jedes npm-Skript ist in der CLAUDE.md erwaehnt
 *   3. jede Migration ist in docs/stand.md gelistet
 *   4. jedes ADR steht im Verzeichnis docs/adr/README.md
 *   5. das Handbuch erwaehnt jeden Befehl, den ein Mensch braucht
 *
 * Ob eine Beschreibung noch stimmt, kann das Skript nicht wissen. Dafuer
 * gibt es den Agenten `doku-pflege`.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { standErzeugen } from './stand-erzeugen.mjs'

const WURZEL = fileURLToPath(new URL('..', import.meta.url))
const lies = (pfad) => readFile(join(WURZEL, pfad), 'utf8')

/** Befehle, die im Handbuch stehen muessen -- der Rest ist Werkzeugkram. */
const BEFEHLE_FUER_MENSCHEN = ['dev', 'test', 'db:start', 'db:reset']

const maengel = []
const meldung = (regel, text) => maengel.push({ regel, text })

// 1 -- Stand aktuell?
{
  const erwartet = await standErzeugen()
  let vorhanden = ''
  try {
    vorhanden = await lies('docs/stand.md')
  } catch {
    meldung('stand', 'docs/stand.md fehlt. Anlegen mit: npm run docs:stand')
  }
  if (vorhanden !== '' && vorhanden.replace(/\r\n/g, '\n') !== erwartet) {
    meldung(
      'stand',
      'docs/stand.md ist veraltet. Neu schreiben mit: npm run docs:stand',
    )
  }
}

// 2 -- npm-Skripte in der CLAUDE.md
{
  const paket = JSON.parse(await lies('package.json'))
  const claude = await lies('CLAUDE.md')
  for (const name of Object.keys(paket.scripts ?? {})) {
    if (!claude.includes(`npm run ${name}`) && !claude.includes(`npm ${name}`)) {
      meldung('befehle', `Skript "${name}" ist in der CLAUDE.md nicht erwaehnt`)
    }
  }
}

// 3 -- Migrationen im Stand
{
  const stand = await lies('docs/stand.md')
  const dateien = (await readdir(join(WURZEL, 'supabase/migrations'))).filter((d) =>
    d.endsWith('.sql'),
  )
  for (const datei of dateien) {
    if (!stand.includes(datei)) {
      meldung('migrationen', `Migration ${datei} fehlt in docs/stand.md`)
    }
  }
}

// 4 -- ADR-Verzeichnis vollstaendig
{
  let verzeichnis = ''
  try {
    verzeichnis = await lies('docs/adr/README.md')
  } catch {
    meldung('adr', 'docs/adr/README.md fehlt -- ohne Verzeichnis findet niemand die ADRs')
  }
  if (verzeichnis !== '') {
    const dateien = (await readdir(join(WURZEL, 'docs/adr'))).filter(
      (d) => d.endsWith('.md') && d !== 'README.md',
    )
    for (const datei of dateien) {
      if (!verzeichnis.includes(datei)) {
        meldung('adr', `${datei} fehlt im Verzeichnis docs/adr/README.md`)
      }
    }
  }
}

// 5 -- Handbuch nennt die Befehle fuer Menschen
{
  let handbuch = ''
  try {
    handbuch = await lies('docs/handbuch.md')
  } catch {
    meldung('handbuch', 'docs/handbuch.md fehlt')
  }
  if (handbuch !== '') {
    for (const name of BEFEHLE_FUER_MENSCHEN) {
      if (!handbuch.includes(`npm run ${name}`) && !handbuch.includes(`npm ${name}`)) {
        meldung('handbuch', `Befehl "${name}" fehlt im Handbuch`)
      }
    }
  }
}

if (maengel.length === 0) {
  console.log('Dokumentation passt zum Repository.')
  process.exit(0)
}

console.error(`${maengel.length} Abweichung(en) zwischen Code und Dokumentation:\n`)
for (const m of maengel) console.error(`  [${m.regel}] ${m.text}`)
console.error('\nBehebbar meist mit: npm run docs:stand')
process.exit(1)
