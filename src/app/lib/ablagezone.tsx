'use client'

/**
 * Die Ablagezone des Posteingangs: Dateien waehlen oder hierher ziehen.
 *
 * Eine Client-Komponente, weil ein Ablegen per Ziehen nur im Browser
 * stattfindet: `dragover` muss abgefangen werden (sonst oeffnet der Browser
 * die PDF selbst), und die abgelegten Dateien gehoeren in das Dateifeld des
 * **serverseitigen** Formulars -- das Formular und seine Aktion bleiben, wie
 * sie sind. Nach dem Ablegen wird abgeschickt: Wer eine Datei auf den
 * Posteingang zieht, will sie aufnehmen, nicht noch einen Knopf suchen.
 * Wer den Weg ueber "Datei waehlen" geht, drueckt selbst auf Aufnehmen.
 *
 * Kein `DragEvent`, kein `FileList`: `tsconfig` setzt `lib` ohne `DOM`, und
 * das ist ein Riegel (siehe `stempelbewegen.tsx`). Die Ereignisse werden
 * strukturell gelesen -- genau die Felder, die hier gebraucht werden.
 */

import { useRef, useState } from 'react'

interface Dateiliste {
  length: number
  item(i: number): { name: string } | null
}

interface Ziehen {
  preventDefault(): void
  dataTransfer: { files: Dateiliste; dropEffect?: string } | null
}

interface Dateifeld {
  files: Dateiliste | null
  form: { requestSubmit(): void } | null
}

function namen(liste: Dateiliste | null): string[] {
  if (liste === null) return []
  const n: string[] = []
  for (let i = 0; i < liste.length; i += 1) {
    const d = liste.item(i)
    if (d !== null) n.push(d.name)
  }
  return n
}

export function Ablagezone({ accept }: { accept: string }) {
  const feld = useRef<Dateifeld | null>(null)
  const [aktiv, setAktiv] = useState(false)
  const [gewaehlt, setGewaehlt] = useState<string[]>([])

  const ueber = (e: unknown): void => {
    const z = e as Ziehen
    z.preventDefault()
    if (z.dataTransfer !== null) z.dataTransfer.dropEffect = 'copy'
    setAktiv(true)
  }

  const ablegen = (e: unknown): void => {
    const z = e as Ziehen
    z.preventDefault()
    setAktiv(false)
    const dateien = z.dataTransfer?.files ?? null
    if (dateien === null || dateien.length === 0 || feld.current === null) return
    feld.current.files = dateien
    setGewaehlt(namen(dateien))
    feld.current.form?.requestSubmit()
  }

  return (
    <div
      className={aktiv ? 'ablagezone ablagezone--aktiv' : 'ablagezone'}
      onDragEnter={ueber}
      onDragOver={ueber}
      onDragLeave={() => setAktiv(false)}
      onDrop={ablegen}
    >
      <label className="feld">
        Dateien
        <input
          type="file"
          name="datei"
          accept={accept}
          multiple
          required
          ref={(el) => {
            feld.current = el as unknown as Dateifeld | null
          }}
          onChange={() => setGewaehlt(namen(feld.current?.files ?? null))}
        />
      </label>
      <p className="ablagezone-hinweis klein leise">
        {gewaehlt.length === 0
          ? 'Oder Dateien hierher ziehen — sie werden sofort aufgenommen.'
          : `${gewaehlt.length} ${gewaehlt.length === 1 ? 'Datei' : 'Dateien'}: ${gewaehlt.join(', ')}`}
      </p>
    </div>
  )
}
