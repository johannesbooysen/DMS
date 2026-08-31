/**
 * Objektakte für den Verwalterwechsel erzeugen.
 *
 *   npx tsx scripts/objektakte.ts <objektnummer> [zielverzeichnis]
 *
 * Konzept 19 nennt das „eine Funktion, kein Migrationsprojekt". Genau deshalb
 * gibt es sie jetzt und nicht dann, wenn sie gebraucht wird — im Ernstfall
 * wird sie unter Zeitdruck geschrieben, von jemandem, der das Konzept nicht
 * mehr im Kopf hat.
 *
 * Läuft unter der Kennung aus `DMS_BENUTZER_EXPORT` und damit unter der RLS:
 * Wer das Objekt nicht sehen darf, bekommt eine leere Akte. Das ist kein
 * Umweg, sondern der Punkt — ein Export, der die Rechte umgeht, ist ein
 * zweiter Zugang zu allen Daten.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { alsBenutzer, poolSchliessen } from '../src/db'
import { objektakteZusammenstellen } from '../src/archiv'
import type { Ablage } from '../src/ablage'
import { DateisystemAblage } from '../src/ablage'

const [objektnummer, zielRoh] = process.argv.slice(2)

if (objektnummer === undefined) {
  console.error('Aufruf: npx tsx scripts/objektakte.ts <objektnummer> [ziel]')
  process.exit(1)
}

const benutzer = process.env['DMS_BENUTZER_EXPORT']
if (benutzer === undefined || benutzer === '') {
  console.error(
    'DMS_BENUTZER_EXPORT fehlt. Der Export laeuft unter der Kennung eines ' +
      'Benutzers und damit unter dessen Rechten -- absichtlich.',
  )
  process.exit(1)
}

const ablage: Ablage = new DateisystemAblage(
  process.env['DMS_ABLAGE'] ?? resolve('.ablage'),
)
const ziel = resolve(zielRoh ?? join('export', `objekt-${objektnummer}`))

const ergebnis = await alsBenutzer(benutzer, async (c) => {
  const { rows } = await c.query<{ id: string }>(
    'select id from objekt where objektnummer = $1',
    [objektnummer],
  )
  const objekt = rows[0]
  if (objekt === undefined) return null

  return objektakteZusammenstellen(
    c,
    ablage,
    objekt.id,
    new Date().toISOString().slice(0, 10),
  )
})

if (ergebnis === null) {
  console.error(`Objekt ${objektnummer} nicht gefunden oder nicht sichtbar.`)
  await poolSchliessen()
  process.exit(1)
}

// Direkt ins Dateisystem und nicht ueber die Ablage: Die Akte verlaesst das
// System, sie gehoert nicht in dessen Speicher.
await mkdir(ziel, { recursive: true })

for (const d of ergebnis.dokumente) {
  if (d.inhalt !== null) {
    const pfad = join(ziel, d.dateiname)
    await mkdir(dirname(pfad), { recursive: true })
    await writeFile(pfad, d.inhalt)
  }
  await writeFile(
    join(ziel, `${d.dokumentId}.json`),
    JSON.stringify(d.metadaten, null, 2),
    'utf8',
  )
}

await writeFile(join(ziel, 'manifest.txt'), ergebnis.manifest, 'utf8')

console.log(`Objektakte ${ergebnis.objektnummer} — ${ergebnis.bezeichnung}`)
console.log(`  ${ergebnis.dokumente.length} Dokumente nach ${ziel}`)
if (ergebnis.ohneDatei.length > 0) {
  console.log(`  ${ergebnis.ohneDatei.length} ohne Originaldatei:`)
  for (const id of ergebnis.ohneDatei) console.log(`    ${id}`)
}
console.log('  Pruefen mit: sha256sum -c manifest.txt')

await poolSchliessen()
