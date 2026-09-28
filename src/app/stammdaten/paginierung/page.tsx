/**
 * Die Paginierung -- wie die Eingangsnummer aussieht.
 *
 * Vergeben wird sie beim Abschluss des Posteingangs, an jedem Beleg einmal,
 * lueckenlos je Haus und Jahr. Hier steht nur die Form; der Zaehlerstand
 * wird gezeigt, nicht gestellt.
 */

import Link from 'next/link'
import { paginierungSetzenAktion } from '@/app/lib/stammdaten-aktionen'
import { Seitenrahmen } from '@/app/lib/darstellung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Fehler, NurLesend } from '@/app/lib/stammdaten-teile'
import { rechtelage } from '@/stammdaten'
import { beispielnummer, paginierungLaden } from '@/stammdaten/paginierung'

export const dynamic = 'force-dynamic'

export default async function Paginierung({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; hinweis?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler, hinweis } = await searchParams
  const [darf, p] = await Promise.all([rechtelage(benutzer), paginierungLaden(benutzer)])
  const jahr = new Date().getFullYear()
  const stand = p.zaehler.find((z) => z.jahr === (p.mitJahr ? jahr : 0))?.naechste ?? 1

  return (
    <Seitenrahmen titel="Paginierung">
      <Fehler text={fehler} />
      {hinweis !== undefined && (
        <p role="status" className="meldung-hinweis">
          {hinweis}
        </p>
      )}
      {!darf.stammdaten && <NurLesend was="die Paginierung" />}

      <p className="einleitung">
        Jeder Beleg bekommt beim Abschluss des Posteingangs eine fortlaufende{' '}
        <strong>Paginiernummer</strong> — lückenlos, je Haus und Jahr, danach unveränderlich. Sie
        steht im Eingangsstempel auf dem Beleg, in der Trefferliste und lässt sich in der Suche
        eingeben. Bestandsübernahmen bekommen keine: Ein Beleg von damals ist nicht heute
        eingegangen.
      </p>
      <p className="absatz-leise">
        Wie der Eingangsstempel aussieht, stellen Sie unter{' '}
        <Link href="/stammdaten/stempel">Stempel</Link> ein (Stempeltyp <em>Posteingang</em>).
        Zurück zu den <Link href="/stammdaten">Stammdaten</Link>.
      </p>

      <form action={paginierungSetzenAktion}>
        <fieldset disabled={!darf.stammdaten} style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="entscheidung-feld" style={{ maxWidth: '24rem' }}>
            <input type="checkbox" name="aktiv" value="ja" defaultChecked={p.aktiv} /> Paginiernummern
            vergeben
          </label>
          <label className="entscheidung-feld" style={{ maxWidth: '24rem' }}>
            Präfix (optional, z. B. <code>PE-</code>)
            <input name="praefix" defaultValue={p.praefix} maxLength={12} />
          </label>
          <label className="entscheidung-feld" style={{ maxWidth: '24rem' }}>
            <input type="checkbox" name="mitJahr" value="ja" defaultChecked={p.mitJahr} /> Jahr im
            Nummernkreis — jedes Jahr beginnt bei 1
          </label>
          <label className="entscheidung-feld" style={{ maxWidth: '24rem' }}>
            Stellen der laufenden Nummer (1–10)
            <input name="stellen" type="number" min={1} max={10} defaultValue={p.stellen} />
          </label>

          <p className="klein">
            Nächste Nummer nach heutigem Stand: <strong>{beispielnummer(p, jahr, stand)}</strong>
          </p>
          {p.zaehler.length > 0 && (
            <p className="klein leise">
              Vergeben bisher:{' '}
              {p.zaehler
                .map((z) => `${z.jahr === 0 ? 'ohne Jahr' : z.jahr}: ${z.naechste - 1}`)
                .join(' · ')}
            </p>
          )}

          {darf.stammdaten && (
            <button type="submit" className="knopf-primaer" style={{ marginTop: '0.5rem' }}>
              Paginierung speichern
            </button>
          )}
        </fieldset>
      </form>
    </Seitenrahmen>
  )
}
