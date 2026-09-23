/**
 * Posteingang.
 *
 * Die Tür, die bisher fehlte: `dokumentAufnehmen` gab es schon, aber
 * außerhalb eines Demoskripts rief es niemand auf — es gab keinen Weg, einen
 * Beleg ins System zu bringen.
 *
 * Zwei Wege, und die Unterscheidung ist eine Entscheidung des Menschen, nicht
 * eine Erkennung: Ein einzelner Beleg geht direkt in den Lauf. Ein Stapel aus
 * dem Scanner geht zuerst in die Trennung — dort ist noch nichts geschrieben,
 * was zurückgenommen werden müsste (Konzept 24.1).
 */

import { offeneStapel } from '@/stapel'
import { postAufnehmenAktion } from '@/app/lib/posteingang-aktionen'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { datum, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

export default async function Posteingang({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>
}) {
  const { fehler } = await searchParams
  const stapel = await offeneStapel(await angemeldeterBenutzer())

  return (
    <Seitenrahmen titel="Posteingang">
      {fehler !== undefined && (
        <p role="alert" className="meldung-fehler">
          {fehler}
        </p>
      )}

      <form action={postAufnehmenAktion} className="karte filterzeile" style={{ marginTop: 0 }}>
        <label className="feld">
          Datei
          <input type="file" name="datei" accept="application/pdf,image/*,message/rfc822" required />
        </label>

        <label className="klein">
          <input type="checkbox" name="stapel" value="ja" /> Stapelscan — enthält mehrere Belege
        </label>

        <button type="submit" className="knopf-primaer">
          Aufnehmen
        </button>
      </form>

      <p className="leise klein">
        Ein einzelner Beleg geht sofort in den Ablauf. Ein Stapelscan wird erst getrennt und
        geprüft — bis zur Übernahme entsteht kein Dokument.
      </p>

      <h2>Stapel in Prüfung</h2>

      {stapel.length === 0 ? (
        <p className="leise">Kein Stapel wartet auf Prüfung.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Datei</th>
              <th>Eingang</th>
              <th>Seiten</th>
              <th>Erkannte Belege</th>
            </tr>
          </thead>
          <tbody>
            {stapel.map((s) => (
              <tr key={s.stapelId}>
                <td>
                  <a href={`/posteingang/${s.stapelId}`}>{s.dateiname}</a>
                  <span className="leise klein"> · {s.eingangskanal}</span>
                </td>
                <td>{datum.format(new Date(s.eingangAm))}</td>
                <td>{s.seitenzahl}</td>
                <td>{s.belege}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seitenrahmen>
  )
}
