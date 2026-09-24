/**
 * Reine Anzeigehelfer -- ohne Datenbank, ohne Sitzung, ohne Serveraktionen.
 *
 * Getrennt von `darstellung.tsx`, weil Client-Komponenten sie brauchen
 * (die Aufgabenleiste am Arbeitsplatz): Ein Client-Modul, das
 * `darstellung.tsx` importiert, zoege `pg` und die Sitzung in den Browser.
 * Hier steht nur, was auf beiden Seiten gleich ist -- Formate, die Ampel,
 * der Name eines Belegs.
 */

export const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
export const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

/**
 * „vor 3 Stunden" statt „01.09.2026".
 *
 * Im Betrieb ist die Frage nie, an welchem Tag etwas liegen blieb, sondern
 * wie lange schon. Ein Datum beantwortet das erst nach Kopfrechnen, und zwei
 * Einträge vom selben Tag sehen gleich aus, obwohl der eine seit fünf Minuten
 * und der andere seit acht Stunden steht.
 */
const RELATIV = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })

export function seit(zeitpunkt: string | Date): string {
  const dann = zeitpunkt instanceof Date ? zeitpunkt : new Date(zeitpunkt)
  const sekunden = Math.round((dann.getTime() - Date.now()) / 1000)

  for (const [einheit, laenge] of [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
  ] as const) {
    if (Math.abs(sekunden) < teiler(einheit) * laenge) {
      return RELATIV.format(Math.round(sekunden / teiler(einheit)), einheit)
    }
  }
  // Ab einer Woche ist das Datum wieder die bessere Auskunft: „vor 43 Tagen"
  // muss man zurueckrechnen, ein Datum nicht.
  return datum.format(dann)
}

function teiler(einheit: 'second' | 'minute' | 'hour' | 'day'): number {
  return { second: 1, minute: 60, hour: 3600, day: 86400 }[einheit]
}

export const AMPELFARBEN: Record<string, string> = {
  gruen: '#2F6F4E',
  orange: '#B5741A',
  rot: '#B3271E',
}

export function Ampel({ wert }: { wert: string | null }) {
  if (wert === null) return null
  return (
    <span
      /*
       * `role="img"` ist hier keine Formalie, sondern der ganze Punkt: Ein
       * `span` ohne Rolle darf kein `aria-label` tragen, und ein
       * Vorleseprogramm **ignoriert es dann**. Die Ampel ist aber reine
       * Farbe -- ohne die Beschriftung trägt sie für jemanden, der sie
       * nicht sieht, gar nichts. Gefunden von `axe` (aria-prohibited-attr),
       * nicht beim Lesen.
       */
      role="img"
      title={`Ampel ${wert}`}
      aria-label={`Ampel ${wert}`}
      style={{
        background: AMPELFARBEN[wert] ?? '#888',
        borderRadius: '50%',
        display: 'inline-block',
        flex: 'none',
        height: '0.6rem',
        width: '0.6rem',
      }}
    />
  )
}

/**
 * Die Plausibilitaetsbefunde als Liste.
 *
 * Harte Befunde stehen oben und sind als Anhalten gekennzeichnet -- sie
 * faerben nicht nur, sie stoppen die Bearbeitung (Konzept 14).
 */
export function Befunde({
  befunde,
}: {
  befunde: Array<{ pruefung: string; schwere: string; hinweis: string }>
}) {
  if (befunde.length === 0) return null

  return (
    <section
      style={{
        background: 'var(--farbe-flaeche-leise, #FAFAF8)',
        border: '1px solid var(--farbe-linie, var(--farbe-linie))',
        borderRadius: 'var(--radius, 0.25rem)',
        margin: '1rem 0',
        padding: '0.75rem 1rem',
      }}
    >
      <h2 style={{ fontSize: '0.95rem', marginTop: 0 }}>Prüfhinweise</h2>
      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {befunde.map((b) => (
          <li key={b.pruefung} style={{ marginBottom: '0.4rem' }}>
            <strong style={{ color: b.schwere === 'hart' ? 'var(--farbe-rot)' : 'var(--farbe-orange)' }}>
              {b.schwere === 'hart' ? 'Bearbeitung angehalten' : 'Zu prüfen'}
            </strong>{' '}
            — {b.hinweis}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Wie ein Beleg in einer Liste heißt.
 *
 * An einer Stelle, weil es vier Anzeigestellen gibt — Belegliste, Postfach
 * (zweimal) und Belegansicht. Vorher stand in allen vieren
 * `kreditor ?? 'Ohne Kreditor'`, und mit der zweiten Belegart hätte jedes
 * Schriftstück dort „Ohne Kreditor" geheißen: formal richtig, im Betrieb
 * unbrauchbar.
 *
 * Die Reihenfolge ist die Auskunft, nach der jemand sucht: erst wer, dann
 * worum es geht. Bei einer Rechnung ist das Kreditor und Rechnungsnummer,
 * bei einem Schriftstück Korrespondent und Betreff — dasselbe Muster,
 * andere Felder.
 */
/**
 * Der Anriss unter einem Beleg ohne Bezeichnung: Seitenzahl und die ersten
 * Woerter der ersten Seite. Vier Scans, die alle "Ohne Bezeichnung"
 * heissen, sind sonst nicht auseinanderzuhalten -- und der Dateiname wird
 * nicht gespeichert.
 */
export function belegAnriss(z: { seitenzahl: number | null; textanfang: string | null }): string {
  const teile: string[] = []
  if (z.seitenzahl !== null && z.seitenzahl > 0) {
    teile.push(`${z.seitenzahl} ${z.seitenzahl === 1 ? 'Seite' : 'Seiten'}`)
  }
  const anfang = (z.textanfang ?? '').trim()
  if (anfang !== '') teile.push(`„${anfang}…"`)
  return teile.length === 0 ? 'noch kein Text' : teile.join(' · ')
}

export function belegBezeichnung(z: {
  kreditor?: string | null
  rechnungsnummer?: string | null
  korrespondent?: string | null
  betreff?: string | null
}): string {
  const wer = z.kreditor ?? z.korrespondent
  const was = z.rechnungsnummer ?? z.betreff

  if (wer === null || wer === undefined) {
    // Kein Absender: Der Betreff allein trägt die Zeile eher als ein
    // Platzhalter. „Ohne Kreditor · Anhörung" liest sich schlechter als
    // „Anhörung".
    //
    // Und wenn gar nichts da ist — ein frisch hochgeladener Beleg, bei dem
    // die Extraktion noch läuft — heißt es „Ohne Bezeichnung" und nicht
    // mehr „Ohne Kreditor". Der alte Text war eine Aussage über eine
    // Rechnung; an einem Schriftstück hätte er etwas behauptet, das es dort
    // gar nicht gibt.
    return was ?? 'Ohne Bezeichnung'
  }
  return was === null || was === undefined ? wer : `${wer} · ${was}`
}
