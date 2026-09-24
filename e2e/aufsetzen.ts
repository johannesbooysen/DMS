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
 * Die Marke, an der ein E2E-Worker auf der Prozessliste zu erkennen ist.
 *
 * Sie steht als Argument in der Befehlszeile (`tsx src/worker/index.ts
 * --marke=e2e`; der Worker liest keine Argumente und stört sich nicht
 * daran). Grund: `taskkill /T` auf die npm-Hülle hat den Worker **nicht**
 * immer erwischt — nachgestellt am 24.09.2026: Ein Worker aus dem Lauf von
 * 14:32 lief um 16:30 noch, mit `.ablage-e2e`, und holte sich Aufträge der
 * Vorschau ab. Jeder dritte Auftrag scheiterte dann mit ENOENT auf einem
 * Pfad, den es nur im Test gibt. Ein Prozess, den man an seiner
 * Befehlszeile erkennt, lässt sich auch dann beenden, wenn die Hülle längst
 * weg ist.
 */
const MARKE = '--marke=e2e'

/** Alle Worker mit der Marke beenden — vorher (Reste) und nachher (der eigene). */
async function markierteWorkerBeenden(): Promise<number> {
  if (process.platform === 'win32') {
    const befehl =
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${MARKE}*' ` +
      `-and $_.CommandLine -notlike '*Get-CimInstance*' } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`
    const { stdout } = await ausfuehren(`powershell -NoProfile -Command "${befehl}"`).catch(() => ({
      stdout: '',
    }))
    return stdout.split(/\r?\n/).filter((z) => z.trim() !== '').length
  }
  const { stdout } = await ausfuehren(`pkill -f -- '${MARKE}' && echo 1`).catch(() => ({ stdout: '' }))
  return stdout.trim() === '' ? 0 : 1
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
async function workerStarten(): Promise<() => Promise<void>> {
  const reste = await markierteWorkerBeenden()
  if (reste > 0) {
    process.stdout.write(`  ${reste} verwaiste(n) Worker aus einem früheren Lauf beendet\n`)
  }

  // Ein Befehl als Zeichenkette, keine Argumentliste: Mit `shell: true`
  // wuerden Argumente nur aneinandergehaengt und nicht maskiert -- Node warnt
  // zu Recht davor.
  const kind = spawn(`npm run worker -- ${MARKE}`, {
    env: { ...process.env, DMS_ABLAGE: '.ablage-e2e' },
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  process.stdout.write('  Worker gestartet\n')

  return async () => {
    kind.kill()
    // Auf Windows überlebt der Kindprozess von `npm` das Töten der Hülle.
    if (process.platform === 'win32' && kind.pid !== undefined) {
      await ausfuehren(`taskkill /pid ${kind.pid} /T /F`).catch(() => undefined)
    }
    // Und was die Hülle nicht mitnahm, nimmt die Marke.
    await markierteWorkerBeenden()
  }
}
