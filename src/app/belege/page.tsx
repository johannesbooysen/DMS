/**
 * Belegsuche: Filter und Treffer links, der gewaehlte Beleg rechts.
 *
 * Bis hierher war ein Beleg nur über eine offene Aufgabe erreichbar — sobald
 * der Ablauf durch war, verschwand er aus jeder Sicht. Das ist die Seite, die
 * ihn wiederfindet.
 *
 * Dieselbe geteilte Ansicht wie am Arbeitsplatz, mit einem Unterschied: Die
 * Liste haengt an der Abfrage (Filter, Volltext), und ein Next-Layout kennt
 * keine Abfrageparameter. Deshalb eine Seite, kein Layout -- der gewaehlte
 * Beleg steht als `beleg=` in derselben Adresse wie der Filter. Ein Klick in
 * der Liste rendert die Seite neu, serverseitig; die Liste bleibt, weil der
 * Filter in der Adresse bleibt. Ohne Wahl ist der erste Treffer offen: Eine
 * leere rechte Haelfte beantwortet keine Frage.
 *
 * Ohne Filter: das Neueste über alle eigenen Objekte. Mit Filter: gesucht.
 * Der Unterschied ist keine Bequemlichkeit, sondern eine Aussage über die
 * Abfrage dahinter (siehe `src/belege/liste.ts`).
 *
 * Die Marken für Ordnungsgruppe und Spezialgebiet holen ihre Farbe aus den
 * Stammdaten (§ 18) — eine neue Gruppe bringt ihre Marke mit, ohne dass hier
 * etwas ergänzt wird.
 */

import Link from 'next/link'
import { sucheLoeschenAktion, sucheSpeichernAktion } from '@/app/lib/suche-aktionen'
import { alsAbfrage, suchenLaden, suchfilterLesen } from '@/belege/suchen-speichern'
import type { Belegzeile } from '@/belege/liste'
import { belegkopfLaden } from '@/app/lib/belege'
import { Belegbetrachter } from '@/app/lib/belegbetrachter'
import { uebersichtLaden } from '@/app/lib/belegliste'
import { Listentasten } from '@/app/lib/listentasten'
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

const STAND: Record<string, string> = {
  in_aufbereitung: 'in Aufbereitung',
  laufend: 'in Bearbeitung',
  wartend: 'wartet',
  abgeschlossen: 'abgeschlossen',
  archiviert: 'archiviert',
  abgelehnt: 'abgelehnt',
  storniert: 'storniert',
}

function Marke({ name, farbe }: { name: string; farbe: string | null }) {
  return (
    <span className="marke" style={{ background: farbe ?? 'var(--farbe-text-leise)' }}>
      {name}
    </span>
  )
}

/** Die Adresse einer Zeile: derselbe Filter, dazu der Beleg. */
function zeilenziel(abfrage: string, id: string): string {
  return `${abfrage}${abfrage.includes('?') ? '&' : '?'}beleg=${id}`
}

export default async function Belegsuche({
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

  const benutzer = await angemeldeterBenutzer()
  const uebersicht = await uebersichtLaden(benutzer, filter)
  // Die eigenen gespeicherten Suchen -- Amagnos "eigener Magnet", nur dass
  // er Belege zeigt und keine schiebt.
  const gespeichert = await suchenLaden(benutzer)
  const aktuell = suchfilterLesen(s)
  const aktuelleAbfrage = alsAbfrage(aktuell)

  /*
   * Welcher Beleg rechts steht: der gewaehlte, sonst der erste Treffer.
   * Steht ein `beleg=` in der Adresse, der nicht in der Liste ist (Verweis
   * von gestern, Filter danach geaendert), wird er trotzdem gezeigt -- ueber
   * `belegkopfLaden`, also unter der RLS: Was jemand nicht sehen darf, bleibt
   * auch hier `null`.
   */
  const gewaehlt = s['beleg'] ?? null
  const inListe = gewaehlt === null ? -1 : uebersicht.zeilen.findIndex((z) => z.id === gewaehlt)
  let offen: Belegzeile | null = inListe >= 0 ? (uebersicht.zeilen[inListe] ?? null) : null
  let offenerIndex = inListe
  if (offen === null && gewaehlt !== null) {
    const kopf = await belegkopfLaden(benutzer, gewaehlt)
    if (kopf !== null) {
      offen = {
        ...kopf,
        status: '',
        ordnungsgruppe: kopf.ordnungsgruppe === null ? null : { name: kopf.ordnungsgruppe, farbe: null },
        spezialgebiet: null,
        fundstelle: null,
      }
    }
  }
  if (offen === null && gewaehlt === null) {
    offen = uebersicht.zeilen[0] ?? null
    offenerIndex = offen === null ? -1 : 0
  }

  const ziele = uebersicht.zeilen.map((z) => zeilenziel(aktuelleAbfrage, z.id))

  return (
    <Seitenrahmen titel="Belege" breit>
      <div className="belegsuche">
        <section className="belegsuche-liste" aria-label="Suche">
          {s['fehler'] !== undefined && (
            <p role="alert" className="meldung-fehler">
              {s['fehler']}
            </p>
          )}

          <form method="get" className="belegsuche-filter">
            <label className="feld belegsuche-volltext">
              Volltext
              <span className="suchfeld">
                <input name="q" defaultValue={filter.volltext ?? ''} placeholder="Wort oder &quot;Wortgruppe&quot;" />
                <button type="submit" className="knopf-primaer">
                  Suchen
                </button>
              </span>
            </label>

            <label className="feld">
              Objekt
              <select name="objekt" defaultValue={filter.objektId ?? ''}>
                <option value="">alle Objekte</option>
                {uebersicht.objekte.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.objektnummer} — {o.bezeichnung}
                  </option>
                ))}
              </select>
            </label>

            <label className="feld">
              Ordnungsgruppe
              <select name="gruppe" defaultValue={filter.ordnungsgruppeId ?? ''}>
                <option value="">alle Gruppen</option>
                {uebersicht.gruppen.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="feld">
              Belegart
              <select name="belegart" defaultValue={filter.belegart ?? ''}>
                {BELEGARTEN.map(([wert, text]) => (
                  <option key={wert} value={wert}>
                    {text}
                  </option>
                ))}
              </select>
            </label>

            <label className="feld">
              Ampel
              <select name="ampel" defaultValue={filter.ampel ?? ''}>
                {AMPELN.map(([wert, text]) => (
                  <option key={wert} value={wert}>
                    {text}
                  </option>
                ))}
              </select>
            </label>

            <label className="feld">
              Eingang von
              <input type="date" name="von" defaultValue={filter.von ?? ''} />
            </label>

            <label className="feld">
              bis
              <input type="date" name="bis" defaultValue={filter.bis ?? ''} />
            </label>

            {uebersicht.gefiltert && (
              <p className="belegsuche-zuruecksetzen klein">
                <a href="/belege">Filter zurücksetzen</a>
              </p>
            )}
          </form>

          {gespeichert.length > 0 && (
            <nav aria-label="Gespeicherte Suchen" className="belegsuche-gespeichert klein">
              <span className="leise">Meine Suchen: </span>
              {gespeichert.map((g, i) => {
                const abfrage = alsAbfrage(g.filter)
                const aktiv = abfrage === aktuelleAbfrage
                return (
                  <span key={g.id} style={{ whiteSpace: 'nowrap' }}>
                    {i > 0 && ' · '}
                    <a href={abfrage} aria-current={aktiv ? 'page' : undefined} style={{ fontWeight: aktiv ? 700 : 400 }}>
                      {g.name}
                    </a>
                    {aktiv && (
                      <form action={sucheLoeschenAktion} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={g.id} />
                        <button
                          type="submit"
                          aria-label={`Gespeicherte Suche „${g.name}“ löschen`}
                          className="knopf-link"
                          style={{ color: 'var(--farbe-rot)', padding: '0 0.3rem' }}
                        >
                          ×
                        </button>
                      </form>
                    )}
                  </span>
                )
              })}
            </nav>
          )}

          {/*
            Die laufende Suche speichern -- nur, wenn gefiltert ist: Die ganze
            Liste zu speichern waere kein Filter. Die Filterwerte reisen als
            versteckte Felder mit; die Fachschicht behaelt davon, was die Liste
            kennt.
          */}
          {uebersicht.gefiltert && (
            <form action={sucheSpeichernAktion} className="belegsuche-speichern">
              {Object.entries(aktuell).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <label className="feld">
                Diese Suche speichern als
                <span className="suchfeld">
                  <input name="name" required maxLength={80} placeholder="z. B. Rote Belege Objekt 42" />
                  <button type="submit">Speichern</button>
                </span>
              </label>
            </form>
          )}

          <p className="trefferliste-stand klein leise">
            {uebersicht.gefiltert
              ? `${uebersicht.treffer} Treffer${
                  (uebersicht.treffer ?? 0) > uebersicht.zeilen.length ? `, die ersten ${uebersicht.zeilen.length}` : ''
                }`
              : 'Das Neueste aus Ihren Objekten.'}
          </p>

          {uebersicht.zeilen.length === 0 ? (
            <p className="trefferliste-leer">Nichts gefunden.</p>
          ) : (
            <nav aria-label="Treffer">
              <ol className="trefferliste">
                {uebersicht.zeilen.map((z, i) => (
                  <li key={z.id}>
                    <Link href={ziele[i] ?? '/belege'} aria-current={i === offenerIndex ? 'page' : undefined}>
                      <span className="trefferliste-titel">
                        <Ampel wert={z.ampel} />
                        <span>{belegBezeichnung(z)}</span>
                      </span>
                      <span className="trefferliste-zeile">
                        <span>
                          {z.objektnummer !== null && `Objekt ${z.objektnummer} · `}
                          {datum.format(new Date(z.eingangAm))}
                        </span>
                        <span>{z.brutto === null ? '' : euro.format(z.brutto)}</span>
                      </span>
                      {(z.ordnungsgruppe !== null || z.spezialgebiet !== null) && (
                        <span className="trefferliste-marken">
                          {z.ordnungsgruppe !== null && <Marke name={z.ordnungsgruppe.name} farbe={z.ordnungsgruppe.farbe} />}
                          {z.spezialgebiet !== null && <Marke name={z.spezialgebiet.name} farbe={z.spezialgebiet.farbe} />}
                        </span>
                      )}
                      {z.fundstelle !== null && (
                        <span className="trefferliste-fundstelle">
                          Seite {z.fundstelle.seite}:{' '}
                          {/* ts_headline liefert <b>-Auszeichnung. Sie wird hier
                              bewusst als Text gezeigt statt als HTML eingesetzt --
                              der Auszug stammt aus einem Belegtext, und der ist
                              keine vertrauenswürdige Quelle. */}
                          {z.fundstelle.auszug.replace(/<\/?b>/g, '')}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {ziele.length > 0 && <Listentasten ziele={ziele} aktuell={offenerIndex} hinweis="nächster und voriger Treffer" />}
        </section>

        <section className="belegsuche-vorschau" aria-label="Vorschau">
          {offen === null ? (
            <p className="belegsuche-leer">
              {gewaehlt === null ? 'Kein Beleg zum Anzeigen.' : 'Diesen Beleg gibt es nicht, oder er ist nicht sichtbar.'}
            </p>
          ) : (
            <>
              <header className="vorschau-kopf">
                <div>
                  <h2>
                    <Ampel wert={offen.ampel} /> {belegBezeichnung(offen)}
                  </h2>
                  <p className="klein leise">
                    {offen.objektnummer !== null && `Objekt ${offen.objektnummer} · `}
                    {offen.ordnungsgruppe !== null && `${offen.ordnungsgruppe.name} · `}
                    {offen.brutto !== null && `${euro.format(offen.brutto)} · `}
                    Eingang {datum.format(new Date(offen.eingangAm))}
                    {offen.status !== '' && ` · ${STAND[offen.status] ?? offen.status}`}
                  </p>
                </div>
                <Link href={`/beleg/${offen.id}`} className="knopf-primaer">
                  Belegansicht öffnen
                </Link>
              </header>
              <Belegbetrachter
                benutzer={benutzer}
                dokumentId={offen.id}
                seitenzahl={offen.seitenzahl ?? 0}
                treffer={offen.fundstelle === null ? [] : [offen.fundstelle.seite]}
                verweis={false}
              />
            </>
          )}
        </section>
      </div>
    </Seitenrahmen>
  )
}
