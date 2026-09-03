/**
 * Eine Fassung der Verfahrensdokumentation freigeben.
 *
 *   DMS_BENUTZER_FREIGABE=<kennung> npm run verfahrensdoku:freigeben [gueltig-ab]
 *
 * Freigeben heißt: Der heutige Stand von `docs/verfahrensdokumentation.md`
 * wird mit seinem Hash in der Ablage abgelegt, und ab dem angegebenen Tag
 * trägt jeder archivierte Beleg diese Versionsnummer. Ab da ist beantwortbar,
 * nach welchem Verfahren er verarbeitet wurde — auch in zehn Jahren, wenn das
 * Repository längst anders aussieht.
 *
 * **Nicht jeder Stand ist eine Fassung.** Sonst gäbe es je Commit eine, und
 * die Frage „welches Verfahren galt damals" hätte hundert Antworten im Jahr.
 * Freigegeben wird, wenn sich am Verfahren etwas geändert hat, das jemanden
 * interessiert — deshalb ist das hier ein eigener Befehl und kein Teil von
 * `npm run docs:stand`.
 *
 * Läuft unter der Kennung eines Benutzers, wie die Objektakte: Eine Freigabe
 * ist eine Handlung, und es soll dabeistehen, wer sie vorgenommen hat.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { DateisystemAblage, type Ablage } from '../src/ablage'
import { s3AusUmgebung } from '../src/ablage-s3'
import { fassungFreigeben } from '../src/verfahrensdoku'
import { verfahrensdokuErzeugen } from './verfahrensdoku-erzeugen.mjs'

const WURZEL = fileURLToPath(new URL('..', import.meta.url))
const DATEI = join(WURZEL, 'docs/verfahrensdokumentation.md')

const benutzer = process.env['DMS_BENUTZER_FREIGABE']
if (benutzer === undefined || benutzer === '') {
  console.error(
    'DMS_BENUTZER_FREIGABE fehlt. Eine Freigabe ist eine Handlung -- es soll ' +
      'dabeistehen, wer sie vorgenommen hat.',
  )
  process.exit(1)
}

const gueltigAb = process.argv[2] ?? new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(gueltigAb)) {
  console.error(`Kein Datum: ${gueltigAb}. Erwartet wird JJJJ-MM-TT.`)
  process.exit(1)
}

const text = await readFile(DATEI, 'utf8').catch(() => null)
if (text === null) {
  console.error(
    'docs/verfahrensdokumentation.md fehlt. Erst `npm run verfahrensdoku`, ' +
      'dann freigeben.',
  )
  process.exit(1)
}

/*
 * Kein Freigeben eines veralteten Standes.
 *
 * Das ist die wichtigste Pruefung hier. Wer eine Fassung freigibt, die nicht
 * mehr zum Code passt, dokumentiert ein Verfahren, nach dem nicht gearbeitet
 * wird -- und das ist schlimmer als gar keine Dokumentation: Es behauptet
 * Kontrollen, die es nicht gibt, und wer eine davon nachprueft, zieht danach
 * alles andere in Zweifel.
 */
const frisch: string = await verfahrensdokuErzeugen()
if (frisch !== text) {
  console.error(
    'docs/verfahrensdokumentation.md ist nicht auf dem Stand des Repositories.\n' +
      'Eine Fassung, die ein anderes Verfahren beschreibt als das laufende, ist\n' +
      'schlimmer als keine. Erst `npm run verfahrensdoku`, dann freigeben.',
  )
  process.exit(1)
}

const ablage: Ablage =
  s3AusUmgebung() ?? new DateisystemAblage(process.env['DMS_ABLAGE'] ?? resolve('.ablage'))

const ergebnis = await alsBenutzer(benutzer, async (c) => {
  /*
   * Die Versionsnummer traegt das Datum, an dem die Fassung gilt -- plus
   * einen Zaehler, falls an einem Tag zweimal freigegeben wird. Eine
   * fortlaufende Nummer ohne Datum waere kuerzer und in einer Pruefung
   * nutzlos: Dort wird nach dem Verfahren *zu einem Zeitpunkt* gefragt.
   */
  const { rows } = await c.query<{ version: string }>(
    'select version from verfahrensdokumentation where version like $1',
    [`${gueltigAb}%`],
  )
  const version = rows.length === 0 ? gueltigAb : `${gueltigAb}.${rows.length + 1}`

  const titel = text.match(/^#\s+(.+)$/m)?.[1] ?? 'Verfahrensdokumentation'
  return { version, ...(await fassungFreigeben(c, ablage, { version, gueltigAb, titel, text })) }
})

console.log(`Fassung ${ergebnis.version} freigegeben, gueltig ab ${gueltigAb}.`)
console.log(`  Hash:   ${ergebnis.inhaltHash}`)
console.log(`  Ablage: ${ergebnis.storageKey}`)
console.log(
  '\nAb jetzt traegt jeder archivierte Beleg diese Fassung. Was vorher\n' +
    'archiviert wurde, bleibt ohne -- das ist keine Luecke, die sich\n' +
    'nachtraeglich schliessen liesse, und sie steht sichtbar in\n' +
    '`app.archiv_ohne_verfahrensdoku()`.',
)

await poolSchliessen()
