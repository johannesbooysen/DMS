/**
 * Eskalation -- die Aufgabe wandert, die Rolle bleibt (Konzept 8, 17).
 *
 * Ein Durchgang im Worker: Aufgaben, die laenger als die an der Stufe
 * hinterlegte Spanne ueber ihrer Faelligkeit liegen, bekommt die dort
 * hinterlegte Person persoenlich -- einmal, protokolliert. Die eigentliche
 * Regel steht in `app.eskalation_durchgang()` (Migration 20260926130000),
 * weil sie ueber alle Mandanten laeuft und der Worker keinen Benutzer hat:
 * `security definer`, wie die Sammelmail.
 *
 * Hier nur der Aufruf und die Bilanz. Kein Mailversand an die Person: Die
 * Aufgabe steht in ihrem Postfach, die Zahl in der Navigation wird rot,
 * und die Sammelmail nennt sie am naechsten Morgen -- dieselben drei Wege
 * wie fuer jede andere Aufgabe (Konzept 24.9).
 */

import { alsAnmeldung } from '../db'

export interface Eskalationsbilanz {
  eskaliert: number
}

export async function eskalationDurchgang(): Promise<Eskalationsbilanz> {
  return alsAnmeldung(async (c) => {
    const { rows } = await c.query<{ aufgabe_id: string }>(
      'select aufgabe_id from app.eskalation_durchgang()',
    )
    return { eskaliert: rows.length }
  })
}
