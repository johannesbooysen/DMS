/**
 * Wie die Anwendung von außen heißt.
 *
 * Zwei Stellen brauchen das: die Rückkehr-URL der Anmeldung und der Link zur
 * Belegeinsicht. Beide müssen dieselbe Antwort bekommen, sonst schickt die
 * eine den Empfänger woandershin als die andere.
 *
 * Bewusst **keine** `'use server'`-Datei: Was hier steht, ist ein Helfer und
 * keine Formularaktion. In einer Aktionsdatei würde jeder Export zu einem
 * aufrufbaren Endpunkt.
 */

import { headers } from 'next/headers'

/**
 * `DMS_BASIS_URL` hat Vorrang.
 *
 * Hinter einem Reverse Proxy ist der Host im Kopf der Anfrage nicht
 * unbedingt der, unter dem die Anwendung erreichbar ist — und für Entra muss
 * die Rückkehr-URL auf das Zeichen stimmen. Ein Link in einer Mail an einen
 * Mieter hat dasselbe Problem: Er wird woanders geöffnet als er entstand.
 */
export async function basisUrl(): Promise<string> {
  const eingestellt = process.env['DMS_BASIS_URL']
  if (eingestellt !== undefined && eingestellt !== '') return eingestellt.replace(/\/$/, '')

  const kopf = await headers()
  const host = kopf.get('host') ?? 'localhost:3000'
  const schema = kopf.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${schema}://${host}`
}
