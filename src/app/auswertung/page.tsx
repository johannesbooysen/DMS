/**
 * Auswertungen (Konzept §24.11).
 *
 * Drei Zahlen, die im Betrieb fehlen — und die man nirgends sonst sieht,
 * weil jeder nur sein eigenes Postfach kennt:
 *
 *   * **Wo bleibt die Arbeit liegen** — Durchlaufzeiten je Stufe.
 *   * **Was hat das gekostet** — verfallene Skonti, in Euro.
 *   * **Welcher Beleg wartet am längsten** — der Einzelfall, nach dem der
 *     Lieferant anruft.
 *
 * Die Reihenfolge ist Absicht: Das Geld steht oben. Eine Kennzahlenseite,
 * die mit Durchschnittsstunden beginnt, wird einmal angesehen und dann nicht
 * mehr.
 */

import Link from 'next/link'
import { aeltesteOffene, durchlaufzeiten, skonto } from '@/auswertung'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const zelle = {
  borderBottom: '1px solid #eee',
  padding: '0.45rem 0.5rem',
  verticalAlign: 'top',
} as const

const kopfzelle = { ...zelle, color: '#555', fontWeight: 600 } as const
const zahl = { ...zelle, textAlign: 'right' } as const
const zahlkopf = { ...kopfzelle, textAlign: 'right' } as const

const LAGE: Record<string, string> = {
  zu_spaet: 'zu spät gezahlt',
  verfallen: 'noch nicht gezahlt',
}

/**
 * Stunden lesbar machen.
 *
 * „62,4 Stunden" muss man umrechnen, „2 Tage" nicht — und wer eine Kennzahl
 * erst umrechnen muss, liest sie nicht.
 */
function dauer(stunden: number): string {
  if (!Number.isFinite(stunden)) return '—'
  if (stunden < 1) return `${Math.round(stunden * 60)} min`
  if (stunden < 48) return `${stunden.toLocaleString('de-DE')} h`
  return `${(stunden / 24).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tage`
}

export default async function Auswertungen({
  searchParams,
}: {
  searchParams: Promise<{ von?: string; bis?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { von, bis } = await searchParams

  const zeitraum = { von: von ?? null, bis: bis ?? null }

  // Drei unabhängige Abfragen, nebenläufig. Nacheinander wären es drei
  // Wartezeiten hintereinander für eine Seite, die niemand teilweise
  // gebrauchen kann.
  const [zeiten, geld, offene] = await Promise.all([
    durchlaufzeiten(benutzer, zeitraum),
    skonto(benutzer, zeitraum),
    aeltesteOffene(benutzer),
  ])

  const gesamtverlust = geld.summe.reduce((s, z) => s + z.verlust, 0)

  return (
    <Seitenrahmen titel="Auswertungen">
      <p style={{ color: '#555', fontSize: '0.85rem', marginTop: 0 }}>
        {von == null && bis == null
          ? 'Durchlaufzeiten der letzten 90 Tage. Skonti und offene Belege über den gesamten Bestand.'
          : `Zeitraum ${von ?? '…'} bis ${bis ?? '…'}.`}
      </p>

      <h2 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Verfallene Skonti</h2>
      {geld.summe.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.9rem' }}>
          Kein Skonto verfallen. Entweder wird zügig gezahlt oder es ist keines
          vereinbart — beides steht am Beleg.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '0.9rem', margin: '0 0 0.5rem' }}>
            Zusammen <strong>{euro.format(gesamtverlust)}</strong>
            {geld.summe.map((z) => (
              <span key={z.lage} style={{ color: '#555' }}>
                {' · '}
                {z.anzahl}× {LAGE[z.lage] ?? z.lage}: {euro.format(z.verlust)}
              </span>
            ))}
          </p>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={kopfzelle}>Kreditor</th>
                <th style={kopfzelle}>Rechnung</th>
                <th style={zahlkopf}>Brutto</th>
                <th style={zahlkopf}>Skonto</th>
                <th style={kopfzelle}>Frist</th>
                <th style={kopfzelle}>Lage</th>
                <th style={zahlkopf}>Verlust</th>
              </tr>
            </thead>
            <tbody>
              {geld.faelle.map((f) => (
                <tr key={f.dokumentId}>
                  <td style={zelle}>{f.kreditor ?? '—'}</td>
                  <td style={zelle}>
                    <Link href={`/beleg/${f.dokumentId}`}>
                      {f.rechnungsnummer ?? 'ohne Nummer'}
                    </Link>
                  </td>
                  <td style={zahl}>{euro.format(f.brutto)}</td>
                  <td style={zahl}>{f.skontoProzent.toLocaleString('de-DE')} %</td>
                  <td style={zelle}>{datum.format(new Date(f.skontoBis))}</td>
                  <td style={zelle}>{LAGE[f.lage] ?? f.lage}</td>
                  <td style={{ ...zahl, fontWeight: 600 }}>{euro.format(f.verlust)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {geld.faelle.length === 50 && (
            <p style={{ color: '#555', fontSize: '0.8rem' }}>
              Die 50 größten Einzelfälle. Die Summe oben zählt alle.
            </p>
          )}
        </>
      )}

      <h2 style={{ fontSize: '1rem', marginBottom: '0.25rem', marginTop: '2rem' }}>
        Durchlaufzeiten je Stufe
      </h2>
      {zeiten.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.9rem' }}>
          Im Zeitraum wurde keine Stufe abgeschlossen.
        </p>
      ) : (
        <>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={kopfzelle}>Stufe</th>
                <th style={zahlkopf}>Stempel</th>
                <th style={zahlkopf}>Median</th>
                <th style={zahlkopf}>Mittel</th>
                <th style={zahlkopf}>9 von 10 unter</th>
              </tr>
            </thead>
            <tbody>
              {zeiten.map((z) => (
                <tr key={z.stufeId}>
                  <td style={zelle}>
                    {z.bezeichnung}
                    <span style={{ color: '#6F6F6F' }}> · {z.stufentyp}</span>
                  </td>
                  <td style={zahl}>{z.anzahl}</td>
                  {/* Der Median steht **vor** dem Mittel und fett: Ein
                      einzelner Beleg über dem Jahreswechsel zieht das Mittel
                      so weit hoch, dass es nichts mehr aussagt. */}
                  <td style={{ ...zahl, fontWeight: 600 }}>{dauer(z.medianStunden)}</td>
                  <td style={{ ...zahl, color: '#6F6F6F' }}>{dauer(z.mittelStunden)}</td>
                  <td style={zahl}>{dauer(z.p90Stunden)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: '#555', fontSize: '0.8rem' }}>
            Gemessen vom Eintritt in die Stufe bis zum Stempel, der sie beendet.
            Klärung und Rückgabe halten die Stufe an, statt sie zu beenden — die
            Wartezeit läuft weiter und erscheint beim nächsten Stempel.
          </p>
        </>
      )}

      <h2 style={{ fontSize: '1rem', marginBottom: '0.25rem', marginTop: '2rem' }}>
        Älteste offene Belege
      </h2>
      {offene.length === 0 ? (
        <p style={{ color: '#555', fontSize: '0.9rem' }}>Kein Beleg ist offen.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', width: '100%' }}>
          <thead>
            <tr>
              <th style={zahlkopf}>Tage</th>
              <th style={kopfzelle}>Kreditor</th>
              <th style={kopfzelle}>Rechnung</th>
              <th style={zahlkopf}>Brutto</th>
              <th style={kopfzelle}>Steht in</th>
            </tr>
          </thead>
          <tbody>
            {offene.map((o) => (
              <tr key={o.dokumentId}>
                <td style={{ ...zahl, fontWeight: o.tage > 30 ? 600 : 400 }}>{o.tage}</td>
                <td style={zelle}>{o.kreditor ?? '—'}</td>
                <td style={zelle}>
                  <Link href={`/beleg/${o.dokumentId}`}>
                    {o.rechnungsnummer ?? 'ohne Nummer'}
                  </Link>
                </td>
                <td style={zahl}>{o.brutto == null ? '—' : euro.format(o.brutto)}</td>
                <td style={zelle}>
                  {o.stufe ?? '—'}
                  {o.laufStatus === 'klaerung' && (
                    <span style={{ color: '#8a6d1f' }}> · in Klärung</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ color: '#555', fontSize: '0.8rem' }}>
        Gerechnet ab Eingang im Haus, nicht ab Start des Ablaufs — danach fragt
        der Lieferant. Belege in Klärung zählen als offen: Sie sind nicht
        erledigt, sie sind nur woanders.
      </p>
    </Seitenrahmen>
  )
}
