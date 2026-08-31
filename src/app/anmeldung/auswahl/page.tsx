/**
 * Benutzerauswahl der Entwicklungsanmeldung.
 *
 * Ersetzt den Umweg über Microsoft. Die Seite gibt es nur, solange
 * `DMS_ANMELDUNG=entwicklung` gesetzt und `NODE_ENV` nicht `production` ist —
 * andernfalls antwortet sie mit 404, so als gäbe es sie nicht.
 *
 * Dass hier Namen und Adressen ohne Anmeldung sichtbar sind, ist der Grund
 * für die Sperre. Es sind die erfundenen Personen aus dem Seed; im Betrieb
 * wären es echte.
 */

import { notFound } from 'next/navigation'
import { ANBIETER_ENTWICKLUNG, anbietername } from '@/anmeldung'
import { verbindungspool } from '@/db'

export const dynamic = 'force-dynamic'

export default async function Benutzerauswahl({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (
    anbietername() !== ANBIETER_ENTWICKLUNG ||
    process.env['DMS_ANMELDUNG'] !== 'entwicklung' ||
    process.env.NODE_ENV === 'production'
  ) {
    return notFound()
  }

  const { state } = await searchParams
  if (state === undefined || state === '') return notFound()

  /*
   * Hier steht bewusst der Eigentümerzugang und nicht `alsAnmeldung`.
   *
   * `alsAnmeldung` läuft als `dms_app` und damit unter der RLS. Ohne gesetzten
   * Benutzer liefert jede Policy nichts — die Liste bliebe leer. Das ist keine
   * Panne, sondern die RLS bei der Arbeit, und genau deshalb ist der Weg für
   * eine Benutzerliste vor der Anmeldung versperrt.
   *
   * Die Alternative wäre eine `security definer`-Funktion „alle Benutzer
   * auflisten". Die stünde dann für immer im Schema und wäre im Betrieb
   * aufrufbar. Diese Seite dagegen ist unter der Sperre am Anfang der Datei
   * gar nicht erreichbar. Von zwei Übeln das kleinere — und das einzige, das
   * ausschließlich in der Entwicklung existiert.
   */
  const c = await verbindungspool().connect()
  let benutzer: Array<{ email: string; name: string; mandant: string }>
  try {
    const { rows } = await c.query<{ email: string; name: string; mandant: string }>(
      `select b.email, b.name, m.name as mandant
         from benutzer b join mandant m on m.id = b.mandant_id
        where b.aktiv order by m.name, b.name`,
    )
    benutzer = rows
  } finally {
    c.release()
  }

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: '30rem',
        padding: '4rem 1.5rem',
      }}
    >
      <h1 style={{ fontSize: '1.375rem' }}>Anmelden als</h1>
      <p style={{ background: '#FDF3E3', color: '#6B4A15', padding: '0.75rem' }}>
        Entwicklungsanmeldung. Es wird nichts geprüft — im Betrieb steht hier
        Microsoft.
      </p>

      <ul style={{ lineHeight: 2, listStyle: 'none', paddingLeft: 0 }}>
        {benutzer.map((b) => (
          <li key={b.email}>
            <a
              href={
                `/api/anmeldung/rueckkehr?state=${encodeURIComponent(state)}` +
                `&benutzer=${encodeURIComponent(b.email)}`
              }
            >
              {b.name}
            </a>{' '}
            <span style={{ color: '#666', fontSize: '0.85rem' }}>· {b.mandant}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}
