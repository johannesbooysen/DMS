/**
 * Pflichtfelder -- welche Angaben an jeder Rechnung erfasst sein muessen.
 *
 * Beim Bedienen gefragt: "Wie kann ich in den Einstellungen festlegen,
 * welche Merkmale ich unbedingt erfassen moechte?" Bis dahin stand die
 * Liste im Quelltext. Jetzt ist sie ein Stammdatum je Haus (Konzept 14,
 * Migration 20260928100000), und diese Seite ist der Ort dafuer.
 *
 * Wirkung, in einem Satz auf der Seite: Die Ampel der Erkennung rechnet
 * ueber diese Felder, und beim Nachtragen von Hand sind sie gekennzeichnet.
 */

import Link from 'next/link'
import { pflichtfelderSetzenAktion } from '@/app/lib/stammdaten-aktionen'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Fehler, NurLesend } from '@/app/lib/stammdaten-teile'
import { rechtelage } from '@/stammdaten'
import { FELDER, pflichtfelderLaden } from '@/stammdaten/pflichtfeld'

export const dynamic = 'force-dynamic'

export default async function Pflichtfelder({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; hinweis?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler, hinweis } = await searchParams
  const [darf, gewaehlt] = await Promise.all([rechtelage(benutzer), pflichtfelderLaden(benutzer, 'rechnung')])

  return (
    <Seitenrahmen titel="Pflichtfelder">
      <Fehler text={fehler} />
      {hinweis !== undefined && (
        <p role="status" className="meldung-hinweis">
          {hinweis}
        </p>
      )}
      {!darf.stammdaten && <NurLesend was="die Pflichtfelder" />}

      <p className="einleitung">
        Welche Angaben an jeder <strong>Rechnung</strong> erfasst sein müssen, bevor sie als
        vollständig gilt. Die Erkennung rechnet ihre Ampel über genau diese Felder: Fehlt eines
        oder ist es unsicher gelesen, steht der Beleg auf Rot und wartet auf einen Menschen.
        Beim Nachtragen von Hand sind die Pflichtfelder gekennzeichnet — sind alle da, wird die
        Ampel grün.
      </p>
      <p className="absatz-leise">
        Die Pflichtangaben nach § 14 UStG für den Vorsteuerabzug werden davon unabhängig immer
        geprüft; sie sind Gesetz, kein Stammdatum. Zurück zu den{' '}
        <Link href="/stammdaten">Stammdaten</Link>.
      </p>

      <form action={pflichtfelderSetzenAktion}>
        <input type="hidden" name="belegart" value="rechnung" />
        <fieldset disabled={!darf.stammdaten} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="klein leise" style={{ marginBottom: '0.5rem' }}>
            Pflichtfelder für Rechnungen
          </legend>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
            {FELDER.map((f) => (
              <li key={f.name}>
                <label>
                  <input type="checkbox" name="feld" value={f.name} defaultChecked={gewaehlt.includes(f.name)} />{' '}
                  {f.label}
                </label>
              </li>
            ))}
          </ul>
          {gewaehlt.length === 0 && (
            <p className="meldung-hinweis klein" role="status">
              Kein Pflichtfeld gewählt — dann gilt jede Erkennung als vollständig. Das ist
              zulässig, aber selten gemeint.
            </p>
          )}
          {darf.stammdaten && (
            <button type="submit" className="knopf-primaer" style={{ marginTop: '0.75rem' }}>
              Pflichtfelder speichern
            </button>
          )}
        </fieldset>
      </form>
    </Seitenrahmen>
  )
}
