/**
 * Belegübersicht.
 *
 * Bis hierher war ein Beleg nur über eine offene Aufgabe erreichbar — sobald
 * der Ablauf durch war, verschwand er aus jeder Sicht. Das ist die Seite, die
 * ihn wiederfindet.
 *
 * Ohne Filter: das Neueste über alle eigenen Objekte. Mit Filter: gesucht.
 * Der Unterschied ist keine Bequemlichkeit, sondern eine Aussage über die
 * Abfrage dahinter (siehe `src/belege/liste.ts`).
 *
 * Die Marken für Ordnungsgruppe und Spezialgebiet holen ihre Farbe aus den
 * Stammdaten (§ 18) — eine neue Gruppe bringt ihre Marke mit, ohne dass hier
 * etwas ergänzt wird.
 */

import { uebersichtLaden } from '@/app/lib/belegliste'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { Ampel, belegBezeichnung, datum, euro, Seitenrahmen } from '@/app/lib/darstellung'

export const dynamic = 'force-dynamic'

const AMPELN = [
  ['', 'alle Ampeln'],
  ['rot', 'rot'],
  ['orange', 'orange'],
  ['gruen', 'grün'],
] as const

const BELEGARTEN = [
  ['', 'alle Belegarten'],
  ['rechnung', 'Rechnung'],
  ['gutschrift', 'Gutschrift'],
  ['mahnung', 'Mahnung'],
  ['schriftverkehr', 'Schriftverkehr'],
  ['sonstiges', 'Sonstiges'],
] as const

const zelle = { borderBottom: '1px solid #eee', padding: '0.45rem 0.5rem' } as const

function Marke({ name, farbe }: { name: string; farbe: string | null }) {
  return (
    <span
      style={{
        background: farbe ?? '#888',
        borderRadius: '0.2rem',
        color: '#fff',
        fontSize: '0.7rem',
        marginRight: '0.3rem',
        padding: '0.1rem 0.35rem',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
  )
}

export default async function Belegübersicht({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const s = await searchParams
  const filter = {
    objektId: s['objekt'] ?? null,
    ordnungsgruppeId: s['gruppe'] ?? null,
    belegart: s['belegart'] ?? null,
    ampel: s['ampel'] ?? null,
    von: s['von'] ?? null,
    bis: s['bis'] ?? null,
    volltext: s['q'] ?? null,
    limit: 50,
  }

  const uebersicht = await uebersichtLaden(await angemeldeterBenutzer(), filter)

  const feld = { display: 'block', fontSize: '0.75rem' } as const
  const eingabe = { display: 'block', padding: '0.3rem' } as const

  return (
    <Seitenrahmen titel="Belege">
      <form
        method="get"
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.6rem',
          marginBottom: '1rem',
        }}
      >
        <label style={feld}>
          Volltext
          <input
            name="q"
            defaultValue={filter.volltext ?? ''}
            placeholder="Wort oder &quot;Wortgruppe&quot;"
            style={{ ...eingabe, minWidth: '14rem' }}
          />
        </label>

        <label style={feld}>
          Objekt
          <select name="objekt" defaultValue={filter.objektId ?? ''} style={eingabe}>
            <option value="">alle Objekte</option>
            {uebersicht.objekte.map((o) => (
              <option key={o.id} value={o.id}>
                {o.objektnummer} — {o.bezeichnung}
              </option>
            ))}
          </select>
        </label>

        <label style={feld}>
          Ordnungsgruppe
          <select name="gruppe" defaultValue={filter.ordnungsgruppeId ?? ''} style={eingabe}>
            <option value="">alle Gruppen</option>
            {uebersicht.gruppen.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <label style={feld}>
          Belegart
          <select name="belegart" defaultValue={filter.belegart ?? ''} style={eingabe}>
            {BELEGARTEN.map(([wert, text]) => (
              <option key={wert} value={wert}>
                {text}
              </option>
            ))}
          </select>
        </label>

        <label style={feld}>
          Ampel
          <select name="ampel" defaultValue={filter.ampel ?? ''} style={eingabe}>
            {AMPELN.map(([wert, text]) => (
              <option key={wert} value={wert}>
                {text}
              </option>
            ))}
          </select>
        </label>

        <label style={feld}>
          Eingang von
          <input type="date" name="von" defaultValue={filter.von ?? ''} style={eingabe} />
        </label>

        <label style={feld}>
          bis
          <input type="date" name="bis" defaultValue={filter.bis ?? ''} style={eingabe} />
        </label>

        <button type="submit" style={{ cursor: 'pointer', padding: '0.4rem 0.9rem' }}>
          Suchen
        </button>
        {uebersicht.gefiltert && (
          <a href="/belege" style={{ fontSize: '0.85rem' }}>
            zurücksetzen
          </a>
        )}
      </form>

      <p style={{ color: '#555', fontSize: '0.85rem' }}>
        {uebersicht.gefiltert
          ? `${uebersicht.treffer} Treffer${
              (uebersicht.treffer ?? 0) > uebersicht.zeilen.length
                ? `, die ersten ${uebersicht.zeilen.length}`
                : ''
            }`
          : 'Das Neueste aus Ihren Objekten. Zum Suchen die Felder oben benutzen.'}
      </p>

      {uebersicht.zeilen.length === 0 ? (
        <p>Nichts gefunden.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Beleg</th>
              <th style={zelle}>Objekt</th>
              <th style={zelle}>Marken</th>
              <th style={{ ...zelle, textAlign: 'right' }}>Betrag</th>
              <th style={zelle}>Eingang</th>
              <th style={zelle}>Stand</th>
            </tr>
          </thead>
          <tbody>
            {uebersicht.zeilen.map((z) => (
              <tr key={z.id}>
                <td style={zelle}>
                  <Ampel wert={z.ampel} />{' '}
                  <a href={`/beleg/${z.id}`}>
                    {belegBezeichnung(z)}
                  </a>
                  {z.fundstelle !== null && (
                    <div style={{ color: '#666', fontSize: '0.78rem' }}>
                      Seite {z.fundstelle.seite}:{' '}
                      {/* ts_headline liefert <b>-Auszeichnung. Sie wird hier
                          bewusst als Text gezeigt statt als HTML eingesetzt --
                          der Auszug stammt aus einem Belegtext, und der ist
                          keine vertrauenswürdige Quelle. */}
                      <span>{z.fundstelle.auszug.replace(/<\/?b>/g, '')}</span>
                    </div>
                  )}
                </td>
                <td style={zelle}>{z.objektnummer ?? '—'}</td>
                <td style={zelle}>
                  {z.ordnungsgruppe !== null && (
                    <Marke name={z.ordnungsgruppe.name} farbe={z.ordnungsgruppe.farbe} />
                  )}
                  {z.spezialgebiet !== null && (
                    <Marke name={z.spezialgebiet.name} farbe={z.spezialgebiet.farbe} />
                  )}
                </td>
                <td style={{ ...zelle, textAlign: 'right' }}>
                  {z.brutto === null ? '—' : euro.format(z.brutto)}
                </td>
                <td style={zelle}>{datum.format(new Date(z.eingangAm))}</td>
                <td style={{ ...zelle, color: '#666' }}>{z.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seitenrahmen>
  )
}
