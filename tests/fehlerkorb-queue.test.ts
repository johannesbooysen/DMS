/**
 * Der Weg von der Warteschlange in den Korb.
 *
 * Die übrigen Fehlerkorb-Tests prüfen, was mit einem gemeldeten Fehler
 * geschieht. Dieser prüft, ob überhaupt einer ankommt — und das ist die
 * Stelle, an der eine Annahme über pg-boss falsch sein könnte:
 *
 *   * Landet ein Auftrag nach erschöpften Versuchen wirklich im `deadLetter`?
 *   * Trägt er dort die **ursprüngliche Nutzlast** oder eine Hülle darum?
 *   * Stehen `output` und `sourceName` in den Metadaten, oder sind sie leer?
 *
 * Alle drei Fragen sind mit einem Blick in die Typen nur halb beantwortet.
 * Hier laufen sie gegen die echte Datenbank.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { JobWithMetadata } from 'pg-boss'
import { verbindungspool, poolSchliessen } from '../src/db'
import { queueBeenden, queueStarten } from '../src/queue'

const MANDANT = '10000000-0000-0000-0000-000000000001'
const ANNA = '20000000-0000-0000-0000-000000000001'

/** Eigene Namen, damit der Test die Warteschlangen des Betriebs nicht anfasst. */
const QUELLE = 'test-scheitert'
const KORB = 'test-scheitert-korb'

interface Nutzlast {
  dokumentId: string
  mandantId: string
  benutzerId: string
}

async function direkt<T>(frage: string, werte: unknown[] = []): Promise<T[]> {
  const c = await verbindungspool().connect()
  try {
    const { rows } = await c.query(frage, werte)
    return rows as T[]
  } finally {
    c.release()
  }
}

/** Wartet, bis `pruefen` etwas liefert — die Queue arbeitet nebenläufig. */
async function bisEs<T>(pruefen: () => Promise<T | null>, maxMs = 15_000): Promise<T> {
  const ende = Date.now() + maxMs
  for (;;) {
    const treffer = await pruefen()
    if (treffer !== null) return treffer
    if (Date.now() > ende) throw new Error('Zeitüberschreitung beim Warten auf die Queue')
    await new Promise((f) => setTimeout(f, 200))
  }
}

beforeAll(async () => {
  const boss = await queueStarten()
  await boss.createQueue(KORB)
  await boss.createQueue(QUELLE, { retryLimit: 1, retryDelay: 1, deadLetter: KORB })
})

afterEach(async () => {
  await direkt('delete from pgboss.job where name in ($1, $2)', [QUELLE, KORB])
})

afterAll(async () => {
  const boss = await queueStarten()
  await boss.deleteQueue(QUELLE)
  await boss.deleteQueue(KORB)
  await queueBeenden()
  await poolSchliessen()
})

describe('Toter Briefkasten', () => {
  it('reicht Nutzlast, Grund und Herkunft weiter', async () => {
    const boss = await queueStarten()
    const nutzlast: Nutzlast = {
      dokumentId: '00000000-0000-0000-0000-0000000000aa',
      mandantId: MANDANT,
      benutzerId: ANNA,
    }

    let versuche = 0
    const arbeiter = await boss.work<Nutzlast>(QUELLE, { pollingIntervalSeconds: 1 }, async () => {
      versuche += 1
      throw new Error('ocrmypdf: exit 2')
    })

    const angekommen: JobWithMetadata<Nutzlast>[] = []
    const korbarbeiter = await boss.work(
      KORB,
      { includeMetadata: true, pollingIntervalSeconds: 1 },
      async (auftraege: JobWithMetadata<Nutzlast>[]) => {
        angekommen.push(...auftraege)
      },
    )

    await boss.send(QUELLE, nutzlast)

    const eintrag = await bisEs(async () => angekommen[0] ?? null)

    await boss.offWork(arbeiter)
    await boss.offWork(korbarbeiter)

    // Erst nach erschoepften Versuchen -- nicht beim ersten Fehlschlag.
    expect(versuche).toBeGreaterThan(1)

    // Die Nutzlast kommt unveraendert an, nicht in einer Huelle. Genau darauf
    // baut der Worker, wenn er `dokumentId` und `benutzerId` ausliest.
    expect(eintrag.data).toMatchObject(nutzlast)

    // `output` traegt den Grund. Ohne ihn stuende im Korb nur, dass etwas
    // schiefging -- und das hilft niemandem weiter.
    expect(JSON.stringify(eintrag.output)).toContain('ocrmypdf: exit 2')

    // `sourceName` sagt, woher. Bei mehreren Warteschlangen am selben Korb
    // ist das der Unterschied zwischen Beleg und Stapel.
    expect(eintrag.sourceName).toBe(QUELLE)
  }, 40_000)
})
