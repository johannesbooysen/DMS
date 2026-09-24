/**
 * Die drei Postfaecher.
 *
 * Alle drei sind Sichten auf `aufgabe` beziehungsweise `klaerung` -- keine
 * eigenen Ablagen (Konzept 8.5). Deshalb stehen sie auf einer Seite: Es ist
 * dieselbe Arbeit, nur anders gefiltert. Zum Arbeiten geht es an den
 * Arbeitsplatz; hier ist die Liste zum Ueberblicken.
 */

import Link from 'next/link'
import {
  klaerungsPostfach,
  ohneZustaendigkeit,
  persoenlichesPostfach,
  poolPostfach,
  type Postfachzeile,
} from '@/app/lib/postfach'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'
import { wunschLaden } from '@/benachrichtigung'
import { wunschSpeichernAktion } from '@/app/lib/benachrichtigung-aktionen'
import { Ampel, belegAnriss, belegBezeichnung, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

function Aufgabenliste({ zeilen, leer }: { zeilen: Postfachzeile[]; leer: string }) {
  if (zeilen.length === 0) return <p className="leise">{leer}</p>

  return (
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Beleg</th>
          <th>Objekt</th>
          <th>Stufe</th>
          <th className="rechts">Betrag</th>
          <th>Fällig</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => (
          <tr key={z.aufgabeId}>
            <td>
              <Ampel wert={z.ampel} />
            </td>
            <td>
              <a href={`/aufgabe/${z.aufgabeId}`}>{belegBezeichnung(z)}</a>
            </td>
            <td>{z.objektnummer ?? '—'}</td>
            <td>{z.stufe}</td>
            <td className="rechts">{z.brutto === null ? '—' : euro.format(z.brutto)}</td>
            <td>{z.faelligAm === null ? '—' : datum.format(new Date(z.faelligAm))}</td>
            <td className="klein">
              <Link href={`/arbeitsplatz/${z.aufgabeId}`}>am Arbeitsplatz</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default async function Postfaecher() {
  const benutzer = await angemeldeterBenutzer()
  const [persoenlich, spezial, klaerungen, wunsch, herrenlos] = await Promise.all([
    persoenlichesPostfach(benutzer),
    poolPostfach(benutzer),
    klaerungsPostfach(benutzer),
    alsBenutzer(benutzer, wunschLaden),
    ohneZustaendigkeit(benutzer),
  ])

  return (
    <Seitenrahmen titel="Postfächer">
      <div className="kennzahlen">
        <div className="kennzahl">
          <strong>{persoenlich.length}</strong>
          <span>persönlich</span>
        </div>
        <div className="kennzahl">
          <strong>{spezial.length}</strong>
          <span>im Pool</span>
        </div>
        <div className="kennzahl">
          <strong>{klaerungen.length}</strong>
          <span>in Klärung</span>
        </div>
      </div>

      <section>
        <h2>Persönlich ({persoenlich.length})</h2>
        <Aufgabenliste zeilen={persoenlich} leer="Nichts zugewiesen." />
      </section>

      <section>
        <h2>Pool: Spezialgebiet und Rolle ({spezial.length})</h2>
        <Aufgabenliste zeilen={spezial} leer="Nichts im Pool." />
      </section>

      {herrenlos.length > 0 && (
        <section>
          <h2>Ohne Zuständigkeit ({herrenlos.length})</h2>
          <p className="leise klein">
            Belege ohne Objekt -- meist ein Scan ohne erkannte Angaben. Am Arbeitsplatz lassen sich
            Objekt, Kreditor und Betrag nachtragen; danach hat die Aufgabe ihren Bearbeiter.
          </p>
          <table>
            <thead>
              <tr>
                <th>Beleg</th>
                <th>Stufe</th>
                <th>Eingang</th>
                <th>Fällig</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {herrenlos.map((z) => (
                <tr key={z.aufgabeId}>
                  <td>
                    <Ampel wert={z.ampel} /> <a href={`/beleg/${z.dokumentId}`}>{belegBezeichnung(z)}</a>
                    <br />
                    <span className="leise klein">{belegAnriss(z)}</span>
                  </td>
                  <td>{z.stufe}</td>
                  <td>{datum.format(new Date(z.eingangAm))}</td>
                  <td>{z.faelligAm === null ? '—' : datum.format(new Date(z.faelligAm))}</td>
                  <td>
                    <a href={`/arbeitsplatz/${z.aufgabeId}`}>Angaben nachtragen</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Klärung ({klaerungen.length})</h2>
        {klaerungen.length === 0 ? (
          <p className="leise">Nichts in Klärung.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Beleg</th>
                <th className="rechts">Betrag</th>
                <th>Wiedervorlage</th>
                <th>Kommentar</th>
              </tr>
            </thead>
            <tbody>
              {klaerungen.map((k) => (
                <tr key={k.klaerungId}>
                  <td>
                    <a href={`/beleg/${k.dokumentId}`}>{belegBezeichnung(k)}</a>
                  </td>
                  <td className="rechts">{k.brutto === null ? '—' : euro.format(k.brutto)}</td>
                  <td>{datum.format(new Date(k.wiedervorlageAm))}</td>
                  <td className="leise">{k.kommentar}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="karte klein">
        <h2 style={{ marginTop: 0 }}>Tägliche Übersicht</h2>
        <p className="leise" style={{ margin: '0 0 0.75rem' }}>
          Eine Sammelmail am Tag — und nur, wenn etwas offen ist. Keine Mail je Aufgabe: Die
          filtert nach zwei Wochen jeder in einen Ordner, den niemand öffnet, und dann ist
          auch die eine verloren, die wichtig war.{' '}
          <strong>Belegdaten stehen nicht darin</strong>, nur Zahlen und ein Link hierher.
        </p>
        <form action={wunschSpeichernAktion} className="filterzeile" style={{ marginBottom: 0 }}>
          <input type="hidden" name="zurueck" value="/postfach" />
          <label className="feld">
            Sammelmail
            <select name="taeglich" defaultValue={wunsch.taeglich ? 'ja' : 'nein'}>
              <option value="ja">ja</option>
              <option value="nein">nein</option>
            </select>
          </label>
          <label className="feld">
            Uhrzeit
            <select name="stunde" defaultValue={String(wunsch.stunde)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="knopf-primaer">
            Übernehmen
          </button>
        </form>
      </section>
    </Seitenrahmen>
  )
}
