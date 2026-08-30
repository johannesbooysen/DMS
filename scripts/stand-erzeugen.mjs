/**
 * Erzeugt docs/stand.md aus dem Repository.
 *
 * Diese Datei ist der Einstieg fuer KI-Agenten: sie beantwortet "was gibt es
 * hier eigentlich" ohne dass jemand zwanzig Dateien liest. Sie wird nie von
 * Hand bearbeitet -- `npm run docs:stand` schreibt sie neu.
 *
 * Bewusst OHNE Zeitstempel und ohne Zufall: die Ausgabe haengt nur vom
 * Inhalt des Repositories ab. Nur so kann `npm run docs:check` durch
 * Neuerzeugen und Vergleichen feststellen, ob die Datei veraltet ist.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, nicht URL.pathname: der Projektpfad enthaelt Leerzeichen,
// und pathname liefert sie prozentkodiert zurueck.
const WURZEL = fileURLToPath(new URL('..', import.meta.url))

async function dateienUnter(verzeichnis, endung) {
  const gefunden = []
  async function absteigen(pfad) {
    let eintraege
    try {
      eintraege = await readdir(pfad, { withFileTypes: true })
    } catch {
      return
    }
    for (const eintrag of eintraege.sort((a, b) => a.name.localeCompare(b.name))) {
      const voll = join(pfad, eintrag.name)
      if (eintrag.isDirectory()) await absteigen(voll)
      else if (eintrag.name.endsWith(endung)) gefunden.push(voll)
    }
  }
  await absteigen(join(WURZEL, verzeichnis))
  return gefunden
}

const pfadNachAussen = (voll) => relative(WURZEL, voll).split('\\').join('/')

/** Erste inhaltliche Kommentarzeile einer Datei -- dient als Kurzbeschreibung. */
function kurzbeschreibung(quelltext) {
  for (const zeile of quelltext.split('\n').slice(0, 12)) {
    const sauber = zeile.replace(/^\s*(--|\/\*\*|\*|\/\/)\s?/, '').trim()
    if (sauber === '' || sauber === '/**' || sauber.startsWith('*/')) continue
    if (/^(import|export|const|create|begin|\{)/i.test(sauber)) continue
    return sauber.replace(/\.$/, '')
  }
  return ''
}

async function befehle() {
  const paket = JSON.parse(await readFile(join(WURZEL, 'package.json'), 'utf8'))
  return Object.entries(paket.scripts ?? {})
}

async function migrationen() {
  const dateien = await dateienUnter('supabase/migrations', '.sql')
  const zeilen = []
  for (const datei of dateien) {
    const quelltext = await readFile(datei, 'utf8')
    const tabellen = [...quelltext.matchAll(/^create table (\w+)/gm)].map((t) => t[1])
    const funktionen = [...quelltext.matchAll(/^create or replace function (app\.\w+)/gm)].map(
      (t) => t[1],
    )
    const policies = [...quelltext.matchAll(/^create policy (\w+)/gm)].length
    zeilen.push({
      pfad: pfadNachAussen(datei),
      titel: kurzbeschreibung(quelltext),
      tabellen,
      funktionen,
      policies,
    })
  }
  return zeilen
}

async function module() {
  const dateien = await dateienUnter('src', '.ts')
  const zeilen = []
  for (const datei of dateien) {
    const quelltext = await readFile(datei, 'utf8')
    zeilen.push({ pfad: pfadNachAussen(datei), titel: kurzbeschreibung(quelltext) })
  }
  return zeilen
}

async function tests() {
  const dateien = (await dateienUnter('tests', '.ts')).filter((d) => d.endsWith('.test.ts'))
  const zeilen = []
  for (const datei of dateien) {
    const quelltext = await readFile(datei, 'utf8')
    const faelle = [...quelltext.matchAll(/^\s*it\(/gm)].length
    const gruppen = [...quelltext.matchAll(/^\s*describe\('([^']+)'/gm)].map((t) => t[1])
    zeilen.push({ pfad: pfadNachAussen(datei), faelle, gruppen })
  }
  return zeilen
}

async function entscheidungen() {
  const dateien = (await dateienUnter('docs/adr', '.md')).filter(
    (d) => !d.endsWith('README.md'),
  )
  const zeilen = []
  for (const datei of dateien) {
    const quelltext = await readFile(datei, 'utf8')
    const titel = quelltext.match(/^#\s+(.+)$/m)?.[1] ?? pfadNachAussen(datei)
    const stand = quelltext.match(/^Stand:.*·\s*(\w+)/m)?.[1] ?? 'unbekannt'
    zeilen.push({ pfad: pfadNachAussen(datei), titel, stand })
  }
  return zeilen
}

/** Offene Punkte, die im Quelltext als solche markiert sind. */
async function offenePunkte() {
  const dateien = await dateienUnter('src', '.ts')
  const treffer = []
  for (const datei of dateien) {
    const quelltext = await readFile(datei, 'utf8')
    quelltext.split('\n').forEach((zeile, index) => {
      if (/\bOFFEN\b/.test(zeile)) {
        treffer.push({ pfad: pfadNachAussen(datei), zeile: index + 1 })
      }
    })
  }
  return treffer
}

function tabelle(kopf, zeilen) {
  if (zeilen.length === 0) return '_keine_\n'
  return [
    `| ${kopf.join(' | ')} |`,
    `|${kopf.map(() => '---').join('|')}|`,
    ...zeilen.map((z) => `| ${z.join(' | ')} |`),
    '',
  ].join('\n')
}

export async function standErzeugen() {
  const [b, m, mo, t, e, o] = await Promise.all([
    befehle(),
    migrationen(),
    module(),
    tests(),
    entscheidungen(),
    offenePunkte(),
  ])

  const testfaelle = t.reduce((summe, d) => summe + d.faelle, 0)
  const tabellen = m.flatMap((d) => d.tabellen)
  const policies = m.reduce((summe, d) => summe + d.policies, 0)

  return `# Stand des Systems

<!-- ERZEUGT von scripts/stand-erzeugen.mjs -- nicht von Hand bearbeiten. -->
<!-- Neu schreiben mit: npm run docs:stand -->

Diese Datei ist der Einstieg fuer Agenten und beantwortet, was im Repository
vorhanden ist. Das *Warum* steht in [konzept.md](konzept.md) und den
[Architekturentscheidungen](adr/), das *Wie bediene ich es* im
[Handbuch](handbuch.md).

Auf einen Blick: ${tabellen.length} Tabellen, ${policies} Policies,
${mo.length} Module, ${testfaelle} Testfaelle in ${t.length} Dateien,
${e.length} Architekturentscheidungen, ${o.length} markierte offene Stellen.

## Befehle

${tabelle(['Befehl', 'Wirkung'], b.map(([name, wert]) => [`\`npm run ${name}\``, `\`${wert}\``]))}
## Migrationen

${m
  .map(
    (d) =>
      `### \`${d.pfad}\`\n\n${d.titel}\n\n` +
      (d.tabellen.length > 0 ? `Tabellen: ${d.tabellen.map((x) => `\`${x}\``).join(', ')}\n\n` : '') +
      (d.funktionen.length > 0
        ? `Funktionen: ${d.funktionen.map((x) => `\`${x}\``).join(', ')}\n\n`
        : '') +
      (d.policies > 0 ? `Policies: ${d.policies}\n` : ''),
  )
  .join('\n')}
## Module

${tabelle(['Datei', 'Aufgabe'], mo.map((d) => [`[\`${d.pfad}\`](../${d.pfad})`, d.titel]))}
## Tests

${tabelle(
  ['Datei', 'Faelle', 'Gruppen'],
  t.map((d) => [`[\`${d.pfad}\`](../${d.pfad})`, String(d.faelle), d.gruppen.join(', ')]),
)}
## Architekturentscheidungen

${tabelle(['Entscheidung', 'Stand'], e.map((d) => [`[${d.titel}](${d.pfad.replace('docs/', '')})`, d.stand]))}
## Im Quelltext markierte offene Stellen

${tabelle(['Fundstelle'], o.map((d) => [`[\`${d.pfad}:${d.zeile}\`](../${d.pfad})`]))}`
}

// Nur schreiben, wenn direkt aufgerufen -- doku-pruefen.mjs importiert die
// Funktion, um zu vergleichen, und darf dabei nichts veraendern.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { writeFile } = await import('node:fs/promises')
  const inhalt = await standErzeugen()
  await writeFile(join(WURZEL, 'docs/stand.md'), inhalt, 'utf8')
  console.log('docs/stand.md geschrieben')
}
