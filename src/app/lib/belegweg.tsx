/**
 * Der Belegweg als Grafik -- serverseitig gezeichnetes SVG.
 *
 * Eine Spalte je Schritt, parallele Stufen uebereinander, Verbindungen
 * dazwischen; links der Eingang, rechts das Archiv. Farben sagen den
 * Zustand, und das Wort steht dabei (dieselbe Regel wie bei der Ampel: Rot
 * gegen Gruen erkennt nicht jeder). Unter jeder erledigten Stufe steht,
 * wer wann welchen Stempel gesetzt hat.
 *
 * Kein Client-Code: Die Grafik entsteht aus denselben Zeilen wie der Rest
 * der Seite und aendert sich nur mit ihr. Fuer Vorleseprogramme steht
 * dieselbe Auskunft als Liste darunter; das SVG ist damit Bild, nicht
 * Bedienung.
 */

import type { Belegweg, Stufenzustand, Wegstufe } from '@/belege/belegweg'
import { datum } from '@/app/lib/anzeige'

const SPALTE = 200
const KASTEN_B = 168
const KASTEN_H = 56
const ZEILE = 108
const RAND = 96

const ZUSTAND: Record<Stufenzustand, { wort: string; fuellung: string; rand: string; text: string; strich?: string }> = {
  erledigt: { wort: 'erledigt', fuellung: 'var(--farbe-gruen-hell)', rand: 'var(--farbe-gruen)', text: 'var(--farbe-gruen-text)' },
  aktuell: { wort: 'jetzt hier', fuellung: 'var(--farbe-akzent-hell)', rand: 'var(--farbe-akzent)', text: 'var(--farbe-text)' },
  klaerung: { wort: 'in Klärung', fuellung: 'var(--farbe-orange-hell)', rand: 'var(--farbe-orange)', text: 'var(--farbe-orange-text)' },
  abgelehnt: { wort: 'abgelehnt', fuellung: 'var(--farbe-rot-hell)', rand: 'var(--farbe-rot)', text: 'var(--farbe-rot-text)' },
  ausstehend: { wort: 'ausstehend', fuellung: 'var(--farbe-flaeche)', rand: 'var(--farbe-linie-stark)', text: 'var(--farbe-text-leise)', strich: '4 3' },
  entfallen: { wort: 'entfallen', fuellung: 'var(--farbe-flaeche-leise)', rand: 'var(--farbe-linie)', text: 'var(--farbe-text-leise)', strich: '2 3' },
}

const uhrzeit = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })

function wann(iso: string): string {
  const d = new Date(iso)
  return `${datum.format(d)} ${uhrzeit.format(d)}`
}

function kuerzen(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

function Stufenkasten({ stufe, x, y }: { stufe: Wegstufe; x: number; y: number }) {
  const z = ZUSTAND[stufe.zustand]
  const letzter = stufe.stempel.at(-1)
  const zeile2 =
    letzter !== undefined
      ? `${kuerzen(letzter.name, 18)} · ${kuerzen(letzter.von, 14)}`
      : stufe.bei !== null
        ? `bei ${kuerzen(stufe.bei, 20)}`
        : z.wort
  const zeile3 =
    letzter !== undefined
      ? wann(letzter.zeitpunkt)
      : stufe.faelligAm !== null && (stufe.zustand === 'aktuell' || stufe.zustand === 'klaerung')
        ? `fällig ${datum.format(new Date(stufe.faelligAm))}`
        : ''
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={KASTEN_B}
        height={KASTEN_H}
        rx={6}
        style={{ fill: z.fuellung, stroke: z.rand, strokeWidth: stufe.zustand === 'aktuell' ? 3 : 1.5, strokeDasharray: z.strich }}
      />
      <text x={x + 10} y={y + 20} style={{ fill: 'var(--farbe-text)', fontSize: 13, fontWeight: 600 }}>
        {kuerzen(stufe.bezeichnung, 22)}
      </text>
      <text x={x + 10} y={y + 37} style={{ fill: z.text, fontSize: 11 }}>
        {zeile2}
      </text>
      <text x={x + 10} y={y + 50} style={{ fill: 'var(--farbe-text-leise)', fontSize: 10.5 }}>
        {zeile3}
      </text>
    </g>
  )
}

export function BelegwegGrafik({ weg }: { weg: Belegweg }) {
  const spalten = weg.schritte.length
  const zeilen = Math.max(1, ...weg.schritte.map((s) => s.stufen.length))
  const breite = RAND * 2 + spalten * SPALTE
  const hoehe = 40 + zeilen * ZEILE
  const mitte = 40 + ((zeilen - 1) * ZEILE) / 2 + KASTEN_H / 2

  const endpunkt = (cx: number, beschriftung: string, unter: string, voll: boolean) => (
    <g>
      <circle
        cx={cx}
        cy={mitte}
        r={14}
        style={{ fill: voll ? 'var(--farbe-akzent)' : 'var(--farbe-flaeche)', stroke: 'var(--farbe-akzent)', strokeWidth: 2 }}
      />
      <text x={cx} y={mitte - 22} textAnchor="middle" style={{ fill: 'var(--farbe-text)', fontSize: 12, fontWeight: 600 }}>
        {beschriftung}
      </text>
      <text x={cx} y={mitte + 32} textAnchor="middle" style={{ fill: 'var(--farbe-text-leise)', fontSize: 11 }}>
        {unter}
      </text>
    </g>
  )

  const zusammenfassung = weg.schritte
    .flatMap((s) => s.stufen)
    .map((s) => `${s.bezeichnung}: ${ZUSTAND[s.zustand].wort}`)
    .join(', ')

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        role="img"
        aria-label={`Belegweg — ${zusammenfassung}`}
        viewBox={`0 0 ${breite} ${hoehe}`}
        width={breite}
        height={hoehe}
        style={{ display: 'block', maxWidth: 'none', fontFamily: 'inherit' }}
      >
        <line
          x1={RAND / 2 + 14}
          y1={mitte}
          x2={breite - RAND / 2 - 14}
          y2={mitte}
          style={{ stroke: 'var(--farbe-linie-stark)', strokeWidth: 2 }}
        />
        {endpunkt(RAND / 2, 'Eingang', datum.format(new Date(weg.eingangAm)), true)}
        {endpunkt(
          breite - RAND / 2,
          'Archiv',
          weg.archiviertAm === null ? 'noch offen' : datum.format(new Date(weg.archiviertAm)),
          weg.archiviertAm !== null,
        )}
        {weg.schritte.map((schritt, i) => {
          const x = RAND + i * SPALTE + (SPALTE - KASTEN_B) / 2
          const block = schritt.stufen.length * ZEILE - (ZEILE - KASTEN_H)
          const oben = mitte - block / 2
          return (
            <g key={i}>
              {schritt.stufen.length > 1 && (
                <>
                  {/* Senkrechte Klammer: gleichzeitig */}
                  <line x1={x - 8} y1={oben + KASTEN_H / 2} x2={x - 8} y2={oben + block - KASTEN_H / 2} style={{ stroke: 'var(--farbe-linie-stark)', strokeWidth: 2 }} />
                  <line x1={x + KASTEN_B + 8} y1={oben + KASTEN_H / 2} x2={x + KASTEN_B + 8} y2={oben + block - KASTEN_H / 2} style={{ stroke: 'var(--farbe-linie-stark)', strokeWidth: 2 }} />
                  <text x={x + KASTEN_B / 2} y={oben - 8} textAnchor="middle" style={{ fill: 'var(--farbe-text-leise)', fontSize: 10.5 }}>
                    gleichzeitig
                  </text>
                </>
              )}
              {schritt.stufen.map((stufe, j) => {
                const y = oben + j * ZEILE
                return (
                  <g key={stufe.id}>
                    {schritt.stufen.length > 1 && (
                      <>
                        <line x1={x - 8} y1={y + KASTEN_H / 2} x2={x} y2={y + KASTEN_H / 2} style={{ stroke: 'var(--farbe-linie-stark)', strokeWidth: 2 }} />
                        <line x1={x + KASTEN_B} y1={y + KASTEN_H / 2} x2={x + KASTEN_B + 8} y2={y + KASTEN_H / 2} style={{ stroke: 'var(--farbe-linie-stark)', strokeWidth: 2 }} />
                      </>
                    )}
                    {/* Der Kasten deckt die Grundlinie ab */}
                    <rect x={x - 1} y={y - 1} width={KASTEN_B + 2} height={KASTEN_H + 2} rx={7} style={{ fill: 'var(--farbe-flaeche)' }} />
                    <Stufenkasten stufe={stufe} x={x} y={y} />
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function Belegweg({ weg }: { weg: Belegweg }) {
  return (
    <section aria-labelledby="belegweg-titel">
      <h2 id="belegweg-titel">Belegweg</h2>
      {weg.schritte.length === 0 ? (
        <p className="leise">
          {weg.laufStatus === 'ohne_lauf'
            ? 'Dieser Beleg hat keinen Lauf — er ist übernommen oder archiviert, ohne durch einen Ablauf gegangen zu sein.'
            : 'Für den Ablauf dieses Belegs liegt kein Stufenbaum vor.'}
        </p>
      ) : (
        <>
          <p className="leise klein" style={{ marginTop: 0 }}>
            {weg.fassung}
            {weg.laufStatus === 'abgeschlossen' && ' · abgeschlossen'}
            {weg.laufStatus === 'klaerung' && ' · in Klärung'}
            {weg.laufStatus === 'storniert' && ' · storniert'}
          </p>
          <BelegwegGrafik weg={weg} />
        </>
      )}
      <details style={{ marginTop: '0.5rem' }}>
        <summary className="klein" style={{ cursor: 'pointer' }}>
          Als Liste: {weg.ereignisse.length === 0 ? 'noch kein Stempel' : `${weg.ereignisse.length} Stempel`}
        </summary>
        {weg.ereignisse.length === 0 ? (
          <p className="leise klein">Seit dem Eingang am {datum.format(new Date(weg.eingangAm))} wurde noch nicht entschieden.</p>
        ) : (
          <ol className="klein" style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
            {weg.ereignisse.map((e, i) => (
              <li key={i}>
                {wann(e.zeitpunkt)} — <strong>{e.name}</strong> an „{e.stufe}“ durch {e.von}
                {e.kommentar !== null && e.kommentar !== '' && <span className="leise"> — {e.kommentar}</span>}
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  )
}
