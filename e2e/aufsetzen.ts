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

import { exec } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * `exec` und nicht `execFile` mit `shell: true`.
 *
 * Letzteres warnt zu Recht: Argumente werden dabei nur aneinandergehängt,
 * nicht maskiert. Hier gibt es zwar nichts zu maskieren — der Befehl ist
 * fest —, aber eine Warnung, die man wegliest, liest man auch weg, wenn sie
 * einmal berechtigt ist.
 */
const ausfuehren = promisify(exec)

export default async function aufsetzen(): Promise<void> {
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
}
