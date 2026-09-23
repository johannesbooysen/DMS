/**
 * Wartecontainer.
 *
 * Belege, bei denen im Haus alles getan ist und ein externes Ereignis fehlt —
 * eine Erstattung, eine Zahlungsbestätigung, eine Antwort auf eine
 * Gewährleistungsrüge.
 *
 * Die Seite ist nach **Fälligkeit** sortiert und hebt Überfälliges hervor.
 * Das ist ihr ganzer Zweck: Ein Wartecontainer ohne Wiedervorlage wäre ein
 * Ort, an dem Belege verschwinden, und eine Liste ohne Fälligkeit wäre
 * dasselbe mit mehr Schritten.
 */

import { wartendeLaden } from '@/nebenlauf'
import {
  wartenBeendenAktion,
} from '@/app/lib/nebenlauf-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const EREIGNIS: Record<string, string> = {
  erstattung: 'Erstattung',
  versicherungszahlung: 'Zahlung der Versicherung',
  gewaehrleistungsantwort: 'Antwort zur Gewährleistung',
}

const zelle = { borderBottom: '1px solid var(--farbe-linie)', padding: '0.5rem', verticalAlign: 'top' } as const

export default async function Wartende({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const { fehler } = await searchParams
  const zeilen = await wartendeLaden(await angemeldeterBenutzer())
  const faellig = zeilen.filter((z) => z.ueberfaellig)

  return (
    <Seitenrahmen titel="Warten auf ein externes Ereignis">
      {fehler !== undefined && (
        <p role="alert" className="meldung-fehler">
          {fehler}
        </p>
      )}

      <p style={{ color: 'var(--farbe-text-leise)' }}>
        {zeilen.length === 0
          ? 'Kein Beleg wartet.'
          : `${zeilen.length === 1 ? 'Ein Beleg wartet' : `${zeilen.length} Belege warten`}${
              faellig.length > 0 ? `, davon ${faellig.length} überfällig` : ''
            }.`}
      </p>

      {zeilen.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: 'var(--farbe-text-leise)', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Beleg</th>
              <th style={zelle}>Wartet auf</th>
              <th style={zelle}>Wiedervorlage</th>
              <th style={{ ...zelle, minWidth: '18rem' }}>Ergebnis eintragen</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.containerId}>
                <td style={zelle}>
                  <a href={`/beleg/${z.dokumentId}`}>
                    {z.kreditor ?? 'Ohne Kreditor'}
                  </a>
                  <div style={{ color: 'var(--farbe-text-leise)', fontSize: '0.78rem' }}>
                    {[
                      z.objektnummer !== null && `Objekt ${z.objektnummer}`,
                      z.brutto !== null && euro.format(z.brutto),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>
                <td style={zelle}>
                  {z.art}
                  <div style={{ color: 'var(--farbe-text-leise)', fontSize: '0.78rem' }}>
                    {EREIGNIS[z.erwartetesEreignis] ?? z.erwartetesEreignis}
                    {z.erwarteterBetrag !== null && ` · ${euro.format(z.erwarteterBetrag)}`}
                  </div>
                </td>
                <td style={{ ...zelle, color: z.ueberfaellig ? 'var(--farbe-rot)' : 'var(--farbe-text)' }}>
                  {datum.format(new Date(z.wiedervorlageAm))}
                  {z.ueberfaellig && (
                    <div style={{ fontSize: '0.78rem' }}>
                      {z.ueberfaelligTage === 0
                        ? 'heute fällig'
                        : `${z.ueberfaelligTage} Tage überfällig`}
                    </div>
                  )}
                </td>
                <td style={zelle}>
                  <form
                    action={wartenBeendenAktion}
                    style={{ display: 'flex', gap: '0.4rem' }}
                  >
                    <input type="hidden" name="containerId" value={z.containerId} />
                    <input
                      name="ergebnis"
                      placeholder="Was ist eingetreten?"
                      required
                      style={{ flex: 1, padding: '0.3rem' }}
                    />
                    <button type="submit" style={{ cursor: 'pointer', padding: '0.3rem 0.7rem' }}>
                      erledigt
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seitenrahmen>
  )
}
