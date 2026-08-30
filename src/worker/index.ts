/**
 * Worker-Prozess.
 *
 * Laeuft getrennt von der Next.js-Anwendung: OCR, Extraktion und Rendern
 * dauern zu lange fuer einen Request. Gestartet ueber `npm run dev:worker`
 * oder zusammen mit der Anwendung ueber `npm run dev`.
 */

import type { Job } from 'pg-boss'
import { DateisystemAblage } from '../ablage'
import { alsSystem } from '../db'
import { AUFBEREITUNG, queueBeenden, queueStarten, type AufbereitungsAuftrag } from '../queue'
import { aufbereiten } from './aufbereitung'

const ABLAGE_WURZEL = process.env.DMS_ABLAGE ?? '.ablage'

async function start(): Promise<void> {
  const ablage = new DateisystemAblage(ABLAGE_WURZEL)
  const boss = await queueStarten()

  boss.on('error', (fehler: Error) => {
    // Keine Auftragsdaten mitloggen -- sie enthalten Kennungen, die mit
    // Dokumentinhalten verknuepfbar sind.
    console.error('[worker] Queue-Fehler:', fehler.message)
  })

  await boss.work<AufbereitungsAuftrag>(
    AUFBEREITUNG,
    async (auftraege: Job<AufbereitungsAuftrag>[]) => {
      for (const auftrag of auftraege) {
        const { dokumentId, benutzerId } = auftrag.data
        await alsSystem(benutzerId, (c) => aufbereiten(c, ablage, dokumentId))
      }
    },
  )

  console.log('[worker] bereit, Warteschlange:', AUFBEREITUNG)
}

async function beenden(signal: string): Promise<void> {
  console.log(`[worker] ${signal} empfangen, fahre herunter`)
  await queueBeenden()
  process.exit(0)
}

process.on('SIGINT', () => void beenden('SIGINT'))
process.on('SIGTERM', () => void beenden('SIGTERM'))

start().catch((fehler: unknown) => {
  console.error('[worker] Start fehlgeschlagen:', fehler)
  process.exit(1)
})
