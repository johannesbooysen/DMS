/**
 * Notfallzugriff (Konzept §24.10).
 *
 * Die Seite zeigt **alle** laufenden Zugriffe des Mandanten, nicht nur die
 * eigenen — Sichtbarkeit ist hier der Ersatz für die Vorabfreigabe, die im
 * Notfall niemand geben kann. Das Formular sieht nur, wer das Recht trägt;
 * abgewiesen wird trotzdem in der Datenbank.
 */

import { alsBenutzer } from '@/db'
import {
  HOECHSTDAUER_TAGE,
  benutzerZurAuswahl,
  darfEinrichten,
  laufende,
  objekteZurAuswahl,
} from '@/notfall'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { notfallBeendenAktion, notfallEinrichtenAktion } from '@/app/lib/notfall-aktionen'

export const dynamic = 'force-dynamic'

export default async function Seite({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const { fehler } = await searchParams
  const benutzer = await angemeldeterBenutzer()

  const { zugriffe, personen, objekte, darf } = await alsBenutzer(benutzer, async (c) => ({
    zugriffe: await laufende(c),
    personen: await benutzerZurAuswahl(c),
    objekte: await objekteZurAuswahl(c),
    darf: await darfEinrichten(c),
  }))

  return (
    <Seitenrahmen titel="Notfallzugriff">
      {fehler !== undefined && (
        <p role="alert" style={{ color: '#B3271E' }}>
          {fehler}
        </p>
      )}

      <p style={{ maxWidth: '46rem' }}>
        Ein Notfallzugriff erweitert die <strong>Reichweite</strong> vorhandener Rechte
        auf ein weiteres Objekt — nie ihre Art. Wer nie stempeln durfte, stempelt auch
        hier nicht, und Stammdaten- oder Benutzerverwaltung bleiben außen vor. Die
        Rollenvergabe bleibt unberührt.
      </p>

      <h2 style={{ fontSize: '1.05rem' }}>Laufende Zugriffe</h2>
      {zugriffe.length === 0 ? (
        <p>Zurzeit läuft kein Notfallzugriff.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '0.25rem 0.5rem' }}>Wer</th>
              <th style={{ padding: '0.25rem 0.5rem' }}>Objekt</th>
              <th style={{ padding: '0.25rem 0.5rem' }}>Grund</th>
              <th style={{ padding: '0.25rem 0.5rem' }}>Bis</th>
              <th style={{ padding: '0.25rem 0.5rem' }} />
            </tr>
          </thead>
          <tbody>
            {zugriffe.map((z) => (
              <tr key={z.id} style={{ borderTop: '1px solid #ddd' }}>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  {z.benutzer}
                  {z.eigener && ' (Sie)'}
                </td>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  {z.objektnummer} — {z.objektname}
                </td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{z.grund}</td>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  {z.ende.toLocaleDateString('de-DE')}
                </td>
                <td style={{ padding: '0.25rem 0.5rem' }}>
                  {/* Beenden darf, wer einrichten darf, und der Betroffene
                      selbst -- Anna soll nach ihrer Rueckkehr nicht warten
                      muessen. Die Policy entscheidet, nicht diese Bedingung. */}
                  {(darf || z.eigener) && (
                    <form action={notfallBeendenAktion}>
                      <input type="hidden" name="id" value={z.id} />
                      <button type="submit">Beenden</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {darf && (
        <>
          <h2 style={{ fontSize: '1.05rem', marginTop: '1.5rem' }}>Zugriff einrichten</h2>
          <form action={notfallEinrichtenAktion} style={{ display: 'grid', gap: '0.5rem', maxWidth: '34rem' }}>
            <label>
              Wer bekommt den Zugriff
              <select name="benutzer_id" required style={{ display: 'block', width: '100%' }}>
                {personen.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Auf welches Objekt
              <select name="objekt_id" required style={{ display: 'block', width: '100%' }}>
                {objekte.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.objektnummer} — {o.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Grund
              <input
                name="grund"
                required
                minLength={10}
                style={{ display: 'block', width: '100%' }}
              />
              <small>
                Sachlich formulieren — der Grund erklärt den Zugriff, nicht die
                Abwesenheit. <strong>Keine Angaben zur Gesundheit</strong>; dieses Feld
                liest der ganze Mandant.
              </small>
            </label>

            <label>
              Dauer in Tagen
              <input
                name="tage"
                type="number"
                min={1}
                max={HOECHSTDAUER_TAGE}
                defaultValue={7}
                required
                style={{ display: 'block', width: '8rem' }}
              />
              <small>
                Höchstens {HOECHSTDAUER_TAGE} Tage. Was länger dauert, ist eine
                Zuständigkeit und gehört in die Stammdaten.
              </small>
            </label>

            <button type="submit" style={{ justifySelf: 'start' }}>
              Zugriff einrichten
            </button>
          </form>
        </>
      )}
    </Seitenrahmen>
  )
}
