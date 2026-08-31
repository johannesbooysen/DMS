/**
 * Anmelden.
 *
 * Die Seite zeigt keine Eingabefelder — es gibt im DMS kein Passwort. Sie
 * zeigt eine Schaltfläche, die den Weg zum Identitätsanbieter beginnt, und
 * gegebenenfalls den Grund, warum der letzte Versuch nicht geklappt hat.
 */

import { redirect } from 'next/navigation'
import { anmeldungBeginnenAktion } from '@/app/lib/anmelde-aktionen'
import { sitzung } from '@/app/lib/sitzung'

export const dynamic = 'force-dynamic'

/**
 * Die Gründe im Klartext. Der Rückweg reicht nur einen Schlüssel weiter, nie
 * einen fertigen Text — sonst könnte jemand über die Adresszeile beliebige
 * Meldungen auf die Anmeldeseite schreiben und sie für einen Hinweis des
 * Systems ausgeben lassen.
 */
const GRUENDE: Record<string, string> = {
  unbekannt:
    'Die Anmeldung hat geklappt, aber zu diesem Konto gibt es im DMS keinen ' +
    'Zugang. Wenden Sie sich an die Verwaltung — ein Zugang wird dort ' +
    'eingerichtet, nicht durch die Anmeldung selbst.',
  gesperrt: 'Dieser Zugang ist gesperrt.',
  abgelaufen: 'Die Anmeldung hat zu lange gedauert. Bitte erneut versuchen.',
  abgelehnt: 'Die Anmeldung wurde abgebrochen oder abgelehnt.',
  abgemeldet: 'Sie sind abgemeldet.',
}

export default async function Anmeldeseite({
  searchParams,
}: {
  searchParams: Promise<{ grund?: string; weiter?: string }>
}) {
  const { grund, weiter } = await searchParams

  // Wer schon angemeldet ist, hat auf dieser Seite nichts zu suchen -- außer
  // er kommt gerade von der Abmeldung.
  if (grund !== 'abgemeldet' && (await sitzung()) !== null) redirect('/postfach')

  const meldung = grund === undefined ? null : (GRUENDE[grund] ?? null)

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: '30rem',
        padding: '4rem 1.5rem',
      }}
    >
      <h1 style={{ fontSize: '1.375rem' }}>DMS Immobilienverwaltung</h1>

      {meldung !== null && (
        <p
          role="alert"
          style={{
            background: grund === 'abgemeldet' ? '#EEF3EE' : '#F6DCD9',
            color: grund === 'abgemeldet' ? '#2F6F4E' : '#6B1D15',
            padding: '0.75rem',
          }}
        >
          {meldung}
        </p>
      )}

      <p style={{ color: '#555' }}>
        Die Anmeldung läuft über Ihr Geschäftskonto. Das DMS kennt kein eigenes
        Passwort.
      </p>

      <form action={anmeldungBeginnenAktion}>
        <input type="hidden" name="weiter" value={weiter ?? '/postfach'} />
        <button
          type="submit"
          style={{
            background: '#3B4A80',
            border: 0,
            borderRadius: '0.25rem',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '0.7rem 1.2rem',
          }}
        >
          Anmelden
        </button>
      </form>
    </main>
  )
}
