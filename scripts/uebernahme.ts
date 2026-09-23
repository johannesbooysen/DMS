/**
 * Bestandsuebernahme aus dem abzuloesenden System (Konzept 24.12).
 *
 *   DMS_BENUTZER_UEBERNAHME=<kennung> npm run uebernahme -- <exportordner> --probe
 *   DMS_BENUTZER_UEBERNAHME=<kennung> npm run uebernahme -- <exportordner>
 *
 * Im Exportordner liegen die Dateien, die CSV mit den Eigenschaften und
 * eine `uebernahme.json`, die sagt, welche Spalte was ist (Vorlage:
 * docs/handbuch.md, Abschnitt Bestandsuebernahme).
 *
 * **Erst die Probe.** `--probe` liest alles, prueft Dateien, Objekte,
 * Ordnungsgruppen und Kreditoren, sagt, was schon uebernommen ist -- und
 * schreibt nichts. Der Lauf ohne `--probe` uebernimmt Zeile fuer Zeile, jede
 * in ihrer eigenen Transaktion; was scheitert, steht mit Grund im
 * Protokoll, und der Rest geht weiter. Ein zweiter Lauf ueber denselben
 * Export ueberspringt, was schon da ist.
 *
 * Laeuft unter der Kennung eines Benutzers, wie die Objektakte: Die
 * Uebernahme ist eine Handlung, und sie unterliegt dessen Rechten --
 * Kreditoren anlegen darf nur, wer Stammdaten pflegen darf.
 */

import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DateisystemAblage, type Ablage } from '../src/ablage'
import { s3AusUmgebung } from '../src/ablage-s3'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { queueBeenden } from '../src/queue'
import {
  belegUebernehmen,
  bestandPruefen,
  csvLesen,
  laufProtokoll,
  zeileLesen,
  zuordnungPruefen,
  type Bestandsbeleg,
} from '../src/uebernahme'

const argumente = process.argv.slice(2)
const probe = argumente.includes('--probe')
const ordnerRoh = argumente.find((a) => !a.startsWith('--'))

if (ordnerRoh === undefined) {
  console.error('Aufruf: npm run uebernahme -- <exportordner> [--probe]')
  process.exit(1)
}
const ordner = resolve(ordnerRoh)

const benutzer = process.env['DMS_BENUTZER_UEBERNAHME']
if (benutzer === undefined || benutzer === '') {
  console.error(
    'DMS_BENUTZER_UEBERNAHME fehlt. Die Uebernahme laeuft unter der Kennung ' +
      'eines Benutzers und damit unter dessen Rechten -- absichtlich.',
  )
  process.exit(1)
}

const zuordnungRoh: unknown = JSON.parse(await readFile(join(ordner, 'uebernahme.json'), 'utf8'))
const csvText = await readFile(join(ordner, (zuordnungRoh as { index?: string }).index ?? 'index.csv'), 'utf8')
const vorlaeufig = zuordnungPruefen(zuordnungRoh)
const zeilen = csvLesen(csvText, vorlaeufig.trennzeichen)
const kopf = Object.keys(zeilen[0] ?? {})
const zuordnung = zuordnungPruefen(zuordnungRoh, kopf)

const dateibasis = zuordnung.dateibasis === undefined ? ordner : join(ordner, zuordnung.dateibasis)
const pfad = (datei: string) => join(dateibasis, datei)
const vorhanden = async (datei: string) =>
  stat(pfad(datei))
    .then((s) => s.isFile())
    .catch(() => false)

const belege: Bestandsbeleg[] = zeilen.map((z, i) => zeileLesen(z, zuordnung, i + 2))
console.log(`${belege.length} Zeilen in ${zuordnung.index}, Quelle ${zuordnung.quelle}`)

const mandantId = await alsBenutzer(benutzer, async (c) => {
  const { rows } = await c.query<{ mandant_id: string }>('select mandant_id from benutzer where id = $1', [benutzer])
  return rows[0]?.mandant_id ?? null
})
if (mandantId === null) {
  console.error('Der Benutzer ist unbekannt.')
  process.exit(1)
}

// Die Probe laeuft immer -- auch vor dem echten Lauf. Was sie als Fehler
// meldet, wird gar nicht erst versucht.
const bericht = await alsBenutzer(benutzer, (c) => bestandPruefen(c, zuordnung.quelle, belege, vorhanden))
const mitFehler = bericht.filter((b) => b.fehler.length > 0)
const schon = bericht.filter((b) => b.schonUebernommen)
const mitHinweis = bericht.filter((b) => b.fehler.length === 0 && b.hinweise.length > 0)

console.log(`  ${schon.length} schon uebernommen (werden uebersprungen)`)
console.log(`  ${mitFehler.length} mit Fehler (werden nicht uebernommen)`)
console.log(`  ${mitHinweis.length} mit Hinweis (werden uebernommen, mit Luecke)`)
for (const b of mitFehler.slice(0, 30)) {
  console.log(`    Zeile ${b.zeile} [${b.altKennung}]: ${b.fehler.join('; ')}`)
}
if (mitFehler.length > 30) console.log(`    … und ${mitFehler.length - 30} weitere`)
const hinweisArten = new Map<string, number>()
for (const b of mitHinweis) for (const h of b.hinweise) hinweisArten.set(h.replace(/„.*“/, '…'), (hinweisArten.get(h.replace(/„.*“/, '…')) ?? 0) + 1)
for (const [art, n] of hinweisArten) console.log(`    ${n}× ${art}`)

if (probe) {
  console.log('\nProbe -- nichts geschrieben. Ohne --probe wird uebernommen.')
  await poolSchliessen()
  process.exit(mitFehler.length > 0 ? 1 : 0)
}

const ablage: Ablage =
  s3AusUmgebung() ?? new DateisystemAblage(process.env['DMS_ABLAGE'] ?? resolve('.ablage'))
const lauf = { kennung: new Date().toISOString(), quelle: zuordnung.quelle }
const uebersprungen = new Set([...mitFehler, ...schon].map((b) => b.altKennung))

let zaehler = { uebernommen: 0, dublette: 0, fehler: 0 }
let n = 0
for (const b of belege) {
  if (uebersprungen.has(b.altKennung)) continue
  n += 1
  const inhalt = await readFile(pfad(b.datei))
  const ergebnis = await belegUebernehmen(ablage, benutzer, mandantId, b, inhalt, lauf)
  zaehler = { ...zaehler, [ergebnis.ergebnis]: zaehler[ergebnis.ergebnis] + 1 }
  if (ergebnis.ergebnis !== 'uebernommen') {
    console.log(`  Zeile ${b.zeile} [${b.altKennung}]: ${ergebnis.ergebnis} -- ${ergebnis.grund ?? ''}`)
  }
  if (n % 100 === 0) console.log(`  … ${n} bearbeitet`)
}

const protokoll = await alsBenutzer(benutzer, (c) => laufProtokoll(c, lauf.kennung))
console.log(`\nLauf ${lauf.kennung}: ${protokoll.length} Vermerke`)
console.log(`  ${zaehler.uebernommen} uebernommen, ${zaehler.dublette} Dubletten, ${zaehler.fehler} Fehler`)
console.log('Jeder uebernommene Beleg ist archiviert; die Objektsperre setzt der Worker im naechsten Durchgang.')

await queueBeenden().catch(() => undefined)
await poolSchliessen()
