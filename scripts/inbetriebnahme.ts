/**
 * Inbetriebnahmeprüfung — vor dem ersten Beleg, und danach jederzeit.
 *
 *   npm run inbetriebnahme
 *
 * Läuft von der Wartungsmaschine aus, wie die Migrationen: Repository
 * ausgecheckt, die `.env` des Servers in die Umgebung geladen, die
 * Datenbank durch den SSH-Tunnel (`DATABASE_URL`). Nur so sind alle vier
 * Dinge zugleich erreichbar, die es braucht — Umgebung, Objektspeicher,
 * Datenbank und das Repository (für Migrationsdateien und den Text der
 * Verfahrensdokumentation).
 *
 * **Rückgabewert 1 bei einem harten Befund.** Ein weicher steht in der
 * Ausgabe und braucht jemanden, aber nicht heute.
 *
 * Was hier geprüft wird, ist nicht die Checkliste im Handbuch, sondern ihr
 * Ergebnis: Ob der Eimer wirklich sperrt, ob die Freigabe wirklich diesen
 * Stand beschreibt, ob wirklich geprobt wurde. Eine Checkliste wird
 * abgehakt; das hier wird gemessen.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poolSchliessen, verbindungspool } from '../src/db'
import { s3AusUmgebung } from '../src/ablage-s3'
import {
  datenbankPruefen,
  hatHarte,
  hintergrundPruefen,
  objektspeicherPruefen,
  sicherungsprobePruefen,
  umgebungPruefen,
  verfahrensdokuPruefen,
  type Bereich,
} from '../src/betrieb/inbetriebnahme'
import { verfahrensdokuErzeugen } from './verfahrensdoku-erzeugen.mjs'

const WURZEL = fileURLToPath(new URL('..', import.meta.url))

async function dateiOderNull(pfad: string): Promise<string | null> {
  return readFile(pfad, 'utf8').catch(() => null)
}

function ausgeben(b: Bereich): void {
  console.log(`\n== ${b.name}`)
  for (const z of b.geprueft) console.log(`   geprüft  ${z}`)
  for (const f of b.befunde) console.log(`   ${f.schwere === 'hart' ? 'HART    ' : 'weich   '} ${f.text}`)
  if (b.geprueft.length === 0 && b.befunde.length === 0) console.log('   (nichts geprüft)')
}

async function main(): Promise<void> {
  const bereiche: Bereich[] = []

  bereiche.push(umgebungPruefen(process.env))

  // Objektspeicher: nur, wenn einer eingerichtet ist -- dass keiner
  // eingerichtet ist, hat die Umgebungspruefung schon als hart gemeldet.
  let ablage = null
  try {
    ablage = s3AusUmgebung()
  } catch (fehler) {
    bereiche.push({
      name: 'Objektspeicher',
      geprueft: [],
      befunde: [{ schwere: 'hart', text: fehler instanceof Error ? fehler.message : String(fehler) }],
    })
  }
  if (ablage !== null) {
    try {
      bereiche.push(await objektspeicherPruefen(ablage, process.env['DMS_S3_EIMER'] ?? ''))
    } catch (fehler) {
      bereiche.push({
        name: 'Objektspeicher',
        geprueft: [],
        befunde: [{ schwere: 'hart', text: `Nicht erreichbar: ${fehler instanceof Error ? fehler.name : 'Fehler'}` }],
      })
    }
  }

  const c = await verbindungspool().connect()
  try {
    const migrationen = resolve(WURZEL, 'supabase/migrations')
    bereiche.push(await datenbankPruefen(c, migrationen))

    let text: string | null = null
    try {
      text = await verfahrensdokuErzeugen()
    } catch {
      text = null
    }
    bereiche.push(
      await verfahrensdokuPruefen(c, text, {
        verfahren: await dateiOderNull(join(WURZEL, 'docs/verfahrensdoku-organisation.md')),
        verzeichnis: await dateiOderNull(join(WURZEL, 'docs/verzeichnis-organisation.md')),
      }),
    )
    bereiche.push(await sicherungsprobePruefen(c))
  } finally {
    c.release()
  }

  bereiche.push(await hintergrundPruefen())

  for (const b of bereiche) ausgeben(b)

  const harte = bereiche.flatMap((b) => b.befunde).filter((f) => f.schwere === 'hart').length
  const weiche = bereiche.flatMap((b) => b.befunde).filter((f) => f.schwere === 'weich').length
  console.log('')
  if (hatHarte(bereiche)) {
    console.error(`${harte} harte(r) und ${weiche} weiche(r) Befund(e). So geht es nicht in Betrieb.`)
    process.exitCode = 1
  } else if (weiche > 0) {
    console.log(`Kein harter Befund; ${weiche} weiche(r), die jemanden brauchen, aber nicht heute.`)
  } else {
    console.log('Kein Befund. Alles, was sich prüfen lässt, ist geprüft -- der Rest steht im organisatorischen Teil.')
  }
}

main()
  .catch((fehler: unknown) => {
    // Keine Verbindungszeichenfolge in die Ausgabe -- sie traegt Kennung und
    // Rechnername (Projektregel).
    console.error('Prüfung abgebrochen:', fehler instanceof Error ? fehler.message : fehler)
    process.exitCode = 1
  })
  .finally(poolSchliessen)
