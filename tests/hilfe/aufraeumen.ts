/**
 * Testbelege wieder loswerden.
 *
 * Aufwendiger als erwartet, und das ist gut so: Ein Beleg, an dem gestempelt
 * wurde, lässt sich im Betrieb nicht entfernen (Hash-Kette, append-only), und
 * ein archivierter erst recht nicht (Konzept 19). Beides sind Schutzregeln,
 * die genau das verhindern sollen, was ein Test hier tut.
 *
 * Für den Test werden sie kurz ausgesetzt. Im Betrieb tut das niemand — und
 * dass es hier so umständlich ist, ist die Erinnerung daran.
 */

import { verbindungspool } from '../../src/db'

const SCHUTZ: Array<[string, string]> = [
  ['stempel_ereignis', 'stempel_ereignis_unveraenderlich'],
  ['dokument', 'dokument_archiv_schutz'],
  ['kontierung', 'kontierung_archiv_schutz'],
  ['rechnung_fakten', 'rechnung_fakten_archiv_schutz'],
  ['archiv_eintrag', 'archiv_eintrag_unveraenderlich'],
]

export async function belegEntfernen(dokumentId: string): Promise<void> {
  const c = await verbindungspool().connect()
  try {
    for (const [tabelle, trigger] of SCHUTZ) {
      await c.query(`alter table ${tabelle} disable trigger ${trigger}`)
    }
    await c.query('delete from dokument where id = $1', [dokumentId])
  } finally {
    for (const [tabelle, trigger] of SCHUTZ) {
      await c.query(`alter table ${tabelle} enable trigger ${trigger}`)
    }
    c.release()
  }
}
