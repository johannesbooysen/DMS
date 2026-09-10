/**
 * Die Layer über dem Seitenbild.
 *
 * Gerechnet wird in **Prozent**, nicht in Pixeln: Das Seitenbild ist
 * `width: 100%` und ändert seine Größe mit dem Fenster. Absolute Pixel wären
 * beim ersten Zusammenschieben des Browsers verrutscht — und eine Schwärzung,
 * die verrutscht, verdeckt das Falsche.
 *
 * Nach innen ist das eine Überlagerung, nach außen wird eingebrannt
 * (`src/einsicht/schwaerzung.ts`). Der Unterschied ist Absicht: Innen soll
 * man eine Notiz anklicken und ausblenden können, außen darf nichts
 * abschaltbar sein.
 */

import { layerAnlegenAktion, layerAusblendenAktion } from '@/app/lib/layer-aktionen'
import type { Layerzeile } from '@/layer'

const FARBE: Record<string, string> = {
  highlight: 'rgba(255, 214, 82, 0.38)',
  notiz: 'rgba(59, 74, 128, 0.10)',
}

export function Layerschicht({
  layer,
  breite,
  hoehe,
}: {
  layer: Layerzeile[]
  breite: number
  hoehe: number
}) {
  // Ohne bekannte Seitenmasse laesst sich nichts umrechnen. Dann lieber
  // nichts zeichnen als etwas an der falschen Stelle.
  if (!(breite > 0) || !(hoehe > 0) || layer.length === 0) return null

  const prozent = (l: Layerzeile) => ({
    left: `${(l.x / breite) * 100}%`,
    top: `${(l.y / hoehe) * 100}%`,
    width: `${(l.breite / breite) * 100}%`,
    height: `${(l.hoehe / hoehe) * 100}%`,
  })

  return (
    <div
      aria-hidden="false"
      style={{ inset: 0, pointerEvents: 'none', position: 'absolute' }}
    >
      {layer.map((l) => {
        if (l.typ === 'schwaerzung') {
          return (
            <div
              key={l.id}
              title="Geschwärzt"
              style={{ ...prozent(l), background: '#000', position: 'absolute' }}
            />
          )
        }

        if (l.typ === 'stempel') {
          /*
           * **Ein Stempel muss wie ein Stempel aussehen.**
           *
           * Der erste Entwurf zeichnete ihn als dünn umrandetes Kästchen mit
           * 0,5rem Schrift auf fast weißem Grund — technisch ein Layer an der
           * richtigen Stelle, optisch ein Formularfeld. Beim ersten Rundgang
           * durch die Oberfläche war die Rückmeldung entsprechend: „hiervon
           * sehe ich noch nichts".
           *
           * Die Daten waren dabei längst da: Farbe am Stempeltyp (rot für
           * Ablehnung, grün für Freigabe), Entscheidung, Name, Datum, und ein
           * Platz, den der Worker so gewählt hat, dass kein Text darunter
           * verschwindet. Es fehlte allein die Darstellung.
           *
           * Der Text kommt als eine Zeile „Entscheidung · Name · Datum" aus
           * dem Trigger. Hier wird sie geteilt, damit die **Entscheidung**
           * trägt und Name und Datum als Beleg darunter stehen — wie auf
           * einem echten Stempel. Geteilt wird in der Anzeige und nicht in
           * der Datenbank: Der Layertext ist zugleich der durchsuchbare
           * Inhalt (`inhalt_tsv`), und den zerlegt man nicht für die Optik.
           */
          const teile = (l.text ?? '').split(' · ')
          const entscheidung = teile[0] ?? ''
          const beleg = teile.slice(1).join(' · ')
          const farbe = l.farbe ?? '#3B4A80'

          return (
            <div
              key={l.id}
              style={{
                ...prozent(l),
                alignItems: 'center',
                /* Leicht getönt statt weiß: Der Seitentext darunter bleibt
                   ahnbar, der Stempel wirkt aufgedrückt und nicht eingefügt. */
                background: 'rgba(255, 255, 255, 0.78)',
                border: `0.18rem solid ${farbe}`,
                borderRadius: '0.2rem',
                boxSizing: 'border-box',
                color: farbe,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                overflow: 'hidden',
                padding: '0.15rem 0.3rem',
                position: 'absolute',
                /* Drei Grad, nicht mehr: Ein Stempel sitzt nie ganz gerade,
                   aber ein schiefer Text ist schlechter zu lesen. */
                transform: 'rotate(-3deg)',
              }}
            >
              <span
                style={{
                  fontSize: 'clamp(0.55rem, 1.15vw, 1rem)',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  lineHeight: 1.1,
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {entscheidung}
              </span>
              {beleg !== '' && (
                <span
                  style={{
                    fontSize: 'clamp(0.4rem, 0.7vw, 0.62rem)',
                    lineHeight: 1.2,
                    opacity: 0.85,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {beleg}
                </span>
              )}
            </div>
          )
        }

        return (
          <div
            key={l.id}
            title={l.text ?? undefined}
            style={{
              ...prozent(l),
              background: FARBE[l.typ] ?? 'transparent',
              border: l.typ === 'notiz' ? '1px dashed #3B4A80' : 'none',
              position: 'absolute',
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * Die Notizen als Liste unter der Seite.
 *
 * Eine Notiz, die nur als Kasten auf dem Bild liegt, ist bei kleiner
 * Darstellung nicht zu lesen — und mit `pointer-events: none` auch nicht
 * anzuklicken. Der Text gehört deshalb zusätzlich als Text auf die Seite,
 * wo er auch von einem Vorleseprogramm gefunden wird.
 */
export function Notizliste({
  layer,
  dokumentId,
}: {
  layer: Layerzeile[]
  dokumentId: string
}) {
  const eigene = layer.filter((l) => l.typ !== 'stempel')
  if (eigene.length === 0) return null

  return (
    <ul style={{ fontSize: '0.85rem', listStyle: 'none', margin: '0.4rem 0 0', paddingLeft: 0 }}>
      {eigene.map((n) => (
        <li key={n.id} style={{ color: '#444', marginBottom: '0.2rem' }}>
          <span style={{ color: '#666' }}>
            {BEZEICHNUNG[n.typ] ?? n.typ} · {n.erstelltVon ?? 'unbekannt'}
            {n.typ !== 'schwaerzung' && n.sichtbarkeit !== 'intern' && ' · geht nach draußen'}
          </span>
          {n.text !== null && `: ${n.text}`}{' '}
          <form action={layerAusblendenAktion} style={{ display: 'inline' }}>
            <input type="hidden" name="dokumentId" value={dokumentId} />
            <input type="hidden" name="layerId" value={n.id} />
            <button
              type="submit"
              style={{
                background: 'none',
                border: 0,
                color: '#3B4A80',
                cursor: 'pointer',
                fontSize: '0.8rem',
                padding: 0,
              }}
            >
              ausblenden
            </button>
          </form>
        </li>
      ))}
    </ul>
  )
}

const BEZEICHNUNG: Record<string, string> = {
  notiz: 'Notiz',
  highlight: 'Hervorhebung',
  schwaerzung: 'Schwärzung',
}

/**
 * Einen Layer anlegen.
 *
 * Koordinaten von Hand, in PDF-Punkten. Das ist unbequem und ehrlich: Zum
 * Aufziehen mit der Maus bräuchte es eine Client-Komponente, und die gibt es
 * in dieser Anwendung sonst nirgends. Lieber eine umständliche Maske, die
 * funktioniert, als ein halbes Zeichenwerkzeug.
 */
export function Layerformular({
  dokumentId,
  seiten,
}: {
  dokumentId: string
  seiten: number[]
}) {
  const feld = { fontSize: '0.85rem', padding: '0.25rem', width: '5rem' } as const

  return (
    <details style={{ marginTop: '1rem' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
        Notiz, Hervorhebung oder Schwärzung anlegen
      </summary>
      <form
        action={layerAnlegenAktion}
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginTop: '0.6rem',
        }}
      >
        <input type="hidden" name="dokumentId" value={dokumentId} />

        <label style={{ display: 'grid', fontSize: '0.75rem' }}>
          Art
          <select name="typ" style={{ ...feld, width: '9rem' }} defaultValue="notiz">
            <option value="notiz">Notiz</option>
            <option value="highlight">Hervorhebung</option>
            <option value="schwaerzung">Schwärzung</option>
          </select>
        </label>

        <label style={{ display: 'grid', fontSize: '0.75rem' }}>
          Seite
          <select name="seite" style={feld}>
            {seiten.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        {(['x', 'y', 'breite', 'hoehe'] as const).map((n) => (
          <label key={n} style={{ display: 'grid', fontSize: '0.75rem' }}>
            {n}
            <input name={n} type="number" step="1" defaultValue={n === 'breite' ? 200 : 40} style={feld} />
          </label>
        ))}

        <label style={{ display: 'grid', fontSize: '0.75rem', flex: 1, minWidth: '12rem' }}>
          Text
          <input name="text" style={{ ...feld, width: '100%' }} />
        </label>

        <label style={{ fontSize: '0.78rem' }}>
          <input type="checkbox" name="nachDraussen" value="ja" /> geht nach draußen
        </label>

        <button type="submit" style={{ cursor: 'pointer', padding: '0.3rem 0.8rem' }}>
          Anlegen
        </button>
      </form>
      <p style={{ color: '#666', fontSize: '0.78rem', margin: '0.4rem 0 0' }}>
        Angaben in PDF-Punkten, Ursprung oben links. Eine A4-Seite ist 595 × 842.
        Eine Schwärzung ist immer auch nach außen sichtbar — und sperrt dort den
        PDF-Download, weil ein schwarzes Rechteck im PDF den Text nur verdeckt,
        nicht entfernt.
      </p>
    </details>
  )
}
