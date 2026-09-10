'use client'

/**
 * Die Belegvorschau am Entscheidungsbildschirm — groß und skalierbar.
 *
 * **Warum das die erste Client-Komponente des Projekts ist.**
 *
 * Bis hierher ist alles serverseitig gerendert, und das ist gut so: weniger
 * bewegliche Teile, kein Hydrationsaufwand, und die Sicherheitsgrenze liegt
 * ohnehin in der Datenbank. Ein Zoom ließe sich auch ohne JavaScript bauen —
 * über einen Abfrageparameter und ein Neuladen der Seite.
 *
 * Genau daran scheitert es hier: Auf dieser Seite steht ein Kommentarfeld.
 * Wer beim Prüfen einer Rechnung den Beleg vergrößert, während er schon
 * einen Satz getippt hat, verlöre ihn bei jedem Klick. Ein Zoom, der die
 * Arbeit wegwirft, ist keiner.
 *
 * **Warum es überhaupt nötig war.** Vorher stand hier eine Miniatur von
 * 240 Pixeln — auf dem Bildschirm, auf dem entschieden wird, ob eine
 * Rechnung sachlich richtig ist. Rückmeldung beim ersten Rundgang: „das Bild
 * der PDF-Datei ist zu klein, dies muss skalierbar sein". Die Vorlage lag
 * dabei längst bereit: Der Worker rendert jede Seite zusätzlich in
 * Lesegröße (1240 px), und die kostet beim Ausliefern nichts extra.
 */

import Link from 'next/link'
import { useState } from 'react'

/*
 * Prozentwerte, zwischen denen die Größe läuft.
 *
 * **Knöpfe und kein Schieberegler** -- und der Grund steht in der
 * `tsconfig.json`: `lib` ist auf `ES2023` gesetzt, ohne `DOM`. Das ist kein
 * Versehen, sondern ein Riegel -- so kann Servercode `document`, `window`
 * oder `localStorage` gar nicht erst versehentlich benutzen, in einem
 * Projekt, dessen Sicherheitsgrenze serverseitig liegt.
 *
 * Ein `<input type="range">` braucht `e.target.value` und damit DOM-Typen.
 * Den Riegel für einen Schieberegler zu öffnen wäre der falsche Tausch;
 * `onClick`-Handler, die das Ereignis gar nicht ansehen, brauchen ihn
 * nicht. In 25er-Schritten von 50 auf 300 Prozent ist die Größe ebenso zu
 * treffen -- mit Tastatur sogar leichter.
 */
const KLEINSTE = 50
const GROESSTE = 300
const SCHRITT = 25

export function Belegvorschau({
  dokumentId,
  seite = 1,
}: {
  dokumentId: string
  seite?: number
}) {
  const [zoom, setZoom] = useState(100)

  return (
    <figure style={{ margin: 0, minWidth: 0 }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.4rem',
        }}
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(KLEINSTE, z - SCHRITT))}
          aria-label="Kleiner"
          style={knopf}
        >
          −
        </button>

        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(GROESSTE, z + SCHRITT))}
          aria-label="Größer"
          style={knopf}
        >
          +
        </button>

        <span style={{ color: '#555', fontSize: '0.8rem', minWidth: '3rem' }}>{zoom} %</span>

        <button type="button" onClick={() => setZoom(100)} style={{ ...knopf, width: 'auto' }}>
          Zurücksetzen
        </button>
      </div>

      <div
        style={{
          background: '#f6f6f6',
          border: '1px solid #ddd',
          maxHeight: '78vh',
          overflow: 'auto',
          padding: '0.5rem',
        }}
      >
        {/*
          Die **Lesefassung**, nicht die Miniatur: Sie ist 1240 px breit und
          bleibt beim Vergrößern scharf. Sie liegt fertig vor -- gerendert
          hat der Worker beim Eingang, nicht der Browser beim Ansehen.
        */}
        <img
          src={`/api/beleg/${dokumentId}/seite/${seite}`}
          alt={`Seite ${seite} des Belegs`}
          style={{ display: 'block', width: `${zoom}%`, minWidth: `${zoom}%` }}
        />
      </div>

      <figcaption style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>
        <Link href={`/beleg/${dokumentId}`}>Alle Seiten, Stempel und Notizen</Link>
      </figcaption>
    </figure>
  )
}

const knopf: React.CSSProperties = {
  border: '1px solid #bbb',
  borderRadius: '0.2rem',
  cursor: 'pointer',
  fontSize: '1rem',
  lineHeight: 1,
  padding: '0.25rem 0.5rem',
}
