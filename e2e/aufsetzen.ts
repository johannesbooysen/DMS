/**
 * Vor dem E2E-Lauf: Datenbank auf den Seed zurücksetzen.
 *
 * Der Grund steht in `playwright.config.ts` — Stempeln ist unumkehrbar, und
 * über HTTP gibt es keinen Rollback wie in den Unit-Tests.
 *
 * Absichtlich **kein** stiller Rückfall: Läuft die Datenbank nicht, bricht
 * der Lauf hier ab, mit einem Satz, der sagt, was zu tun ist. Ein E2E-Test,
 * der gegen eine unbekannte Datenbank läuft, prüft nichts.
 */

import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { poolSchliessen } from '../src/db'
import { belegeAnlegen } from './belege-anlegen'

/**
 * `exec` und nicht `execFile` mit `shell: true`.
 *
 * Letzteres warnt zu Recht: Argumente werden dabei nur aneinandergehängt,
 * nicht maskiert. Hier gibt es zwar nichts zu maskieren — der Befehl ist
 * fest —, aber eine Warnung, die man wegliest, liest man auch weg, wenn sie
 * einmal berechtigt ist.
 */
const ausfuehren = promisify(exec)

export default async function aufsetzen(): Promise<() => Promise<void>> {
  process.stdout.write('  Datenbank zurücksetzen … ')
  const begonnen = Date.now()

  try {
    await ausfuehren('npm run db:reset', {
      // Der Neuaufbau spielt alle Migrationen und den Seed ein.
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (fehler) {
    const grund = fehler instanceof Error ? fehler.message : String(fehler)
    throw new Error(
      'Die Datenbank ließ sich nicht zurücksetzen. Läuft die lokale ' +
        'Supabase-Instanz? `npm run db:start`.\n' +
        grund.split('\n').slice(0, 3).join('\n'),
    )
  }

  process.stdout.write(`${Math.round((Date.now() - begonnen) / 1000)} s\n`)

  /*
   * Und dann echte Dateien an zwei Belege hängen.
   *
   * Ohne sie zeigt der Viewer ein kaputtes Bild und der PDF-Download
   * antwortet mit 404 — nicht wegen eines Fehlers, sondern weil nichts da
   * ist. Ein Test darauf prüfte den Seed, nicht die Anwendung.
   */
  process.stdout.write('  Belege aufbereiten … ')
  const zweiter = Date.now()
  try {
    await belegeAnlegen()
  } finally {
    // Die eigene Verbindung wieder schließen: Playwright wartet sonst am
    // Ende des Laufs auf einen Pool, den niemand mehr braucht.
    await poolSchliessen()
  }
  process.stdout.write(`${Math.round((Date.now() - zweiter) / 1000)} s\n`)

  return workerStarten()
}

/**
 * Den Worker starten — und Playwright sagen, wie er wieder wegkommt.
 *
 * **Nicht** über `webServer`: Der Worker hat keine Adresse, an der man ihn
 * abfragen könnte. Als Port hatte ich den der Datenbank eingetragen; der ist
 * immer belegt, also hielt Playwright ihn für bereits laufend und startete
 * ihn nie. Die Tests warteten dann sechzig Sekunden auf eine Aufbereitung,
 * die niemand machte.
 *
 * Der Rückgabewert einer `globalSetup`-Funktion ist ihr Gegenstück: Was hier
 * zurückkommt, läuft nach dem letzten Test.
 */
function workerStarten(): () => Promise<void> {
  // Ein Befehl als Zeichenkette, keine Argumentliste: Mit `shell: true`
  // wuerden Argumente nur aneinandergehaengt und nicht maskiert -- Node warnt
  // zu Recht davor.
  const kind = spawn('npm run worker', {
    env: { ...process.env, DMS_ABLAGE: '.ablage-e2e' },
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  process.stdout.write('  Worker gestartet\n')

  return async () => {
    kind.kill()
    // Auf Windows überlebt der Kindprozess von `npm` das Töten der Hülle.
    // Ohne diesen Griff bliebe nach jedem Lauf ein Worker stehen, der weiter
    // an der Datenbank hängt.
    if (process.platform === 'win32' && kind.pid !== undefined) {
      await ausfuehren(`taskkill /pid ${kind.pid} /T /F`).catch(() => undefined)
    }
  }
}
