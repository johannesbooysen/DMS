/**
 * Die Huelle: Seitenleiste, Kopfzeile, Inhalt.
 *
 * Bis hierher war die Navigation eine Zeile mit fuenfzehn Textlinks, die
 * bei schmaler Breite umbrach -- jede Seite fuer sich richtig, aber keine
 * Anwendung drumherum. Jetzt: links die Bereiche, oben der Titel mit dem
 * Aufgabenzaehler, in der Mitte die Seite. Die Formen dazu stehen in
 * `globals.css`, nicht hier.
 *
 * Die reinen Anzeigehelfer (Formate, Ampel, Belegname) liegen in
 * `anzeige.tsx` und werden hier nur weitergereicht, damit die 24 Seiten,
 * die sie von hier beziehen, unveraendert bleiben.
 */

import type { ReactNode } from 'react'

import { abmeldenAktion } from '@/app/lib/anmelde-aktionen'
import { Navigationslink } from '@/app/lib/navigationslink'
import { angemeldeterBenutzerOderNichts } from '@/app/lib/sitzung'
import { alsBenutzer } from '@/db'
import { zaehlerLaden } from '@/benachrichtigung'
import { fehlerkorbZaehler } from '@/fehlerkorb'
import { laufende, type Zugriff } from '@/notfall'

export { AMPELFARBEN, Ampel, Befunde, belegAnriss, belegBezeichnung, datum, euro, seit } from '@/app/lib/anzeige'

/**
 * Die Bereiche der Seitenleiste.
 *
 * Fuenf Gruppen statt fuenfzehn gleichrangiger Links: Was man taeglich tut,
 * steht oben; was man einmal einrichtet, unten. Die Namen sind dieselben
 * wie vorher -- die Browsertests finden ihre Links ueber den Sichttext.
 */
const BEREICHE: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  [
    'Arbeiten',
    [
      ['/arbeitsplatz', 'Arbeitsplatz'],
      ['/postfach', 'Postfächer'],
      ['/posteingang', 'Posteingang'],
      ['/warten', 'Warten'],
      ['/stufen', 'Wo steht was'],
    ],
  ],
  [
    'Belege',
    [
      ['/belege', 'Belege'],
      ['/archiv', 'Archiv'],
      ['/einsicht', 'Einsicht'],
      ['/postausgang', 'Postausgang'],
      ['/auswertung', 'Auswertungen'],
    ],
  ],
  [
    'Einrichtung',
    [
      ['/konfiguration', 'Abläufe'],
      ['/stammdaten', 'Stammdaten'],
      ['/eingang', 'Eingangsquellen'],
      ['/vertretung', 'Vertretung'],
    ],
  ],
  [
    'System',
    [
      ['/fehlerkorb', 'Fehlerkorb'],
      ['/notfall', 'Notfall'],
    ],
  ],
]

/**
 * Die Zahl neben dem Postfach.
 *
 * Die staendig wirkende Haelfte des Benachrichtigungskonzepts (Konzept
 * 24.9): Die Sammelmail kommt einmal am Tag, diese Zahl sieht man den
 * ganzen Tag. Sie kostet eine indizierte Zaehlabfrage je Seite.
 *
 * **Faellt sie aus, faellt sie weg** -- nicht die Seite. Ein Zaehler ist
 * eine Beigabe; wer wegen ihm eine Belegansicht nicht mehr oeffnen kann,
 * hat einen schlechten Tausch gemacht.
 */
async function aufgabenzahl(): Promise<{ offen: number; ueberfaellig: number } | null> {
  try {
    const benutzer = await angemeldeterBenutzerOderNichts()
    if (benutzer === null) return null
    return await alsBenutzer(benutzer, zaehlerLaden)
  } catch {
    return null
  }
}

/**
 * Die Zahl neben "Fehlerkorb": offene Eintraege und Haenger. Dieselbe Regel
 * wie beim Aufgabenzaehler -- faellt sie aus, faellt sie weg.
 */
async function fehlerzahl(): Promise<number> {
  try {
    const benutzer = await angemeldeterBenutzerOderNichts()
    if (benutzer === null) return 0
    return await alsBenutzer(benutzer, fehlerkorbZaehler)
  } catch {
    return 0
  }
}

/**
 * Laufende Notfallzugriffe (Konzept 24.10).
 *
 * **Der Ersatz fuer die Vorabfreigabe, die im Notfall niemand geben
 * kann.** Ein Zugriff auf fremde Belege, den man nur in einer eigenen
 * Maske findet, ist eine leise Hintertuer -- also steht er ueber jeder
 * Seite, fuer jeden im Mandanten. Sichtbarkeit *ist* hier die Kontrolle.
 *
 * Faellt die Abfrage aus, faellt das Band weg und nicht die Seite --
 * dieselbe Regel wie beim Zaehler.
 */
async function notfaelle(): Promise<Zugriff[]> {
  try {
    const benutzer = await angemeldeterBenutzerOderNichts()
    if (benutzer === null) return []
    return await alsBenutzer(benutzer, laufende)
  } catch {
    return []
  }
}

export async function Seitenrahmen({
  titel,
  children,
  breit = false,
}: {
  titel: string
  children: ReactNode
  /** Ohne Rand und Hoechstbreite -- fuer den Arbeitsplatz, der die Flaeche selbst aufteilt. */
  breit?: boolean
}) {
  const [zaehler, fehler, offeneNotfaelle] = await Promise.all([aufgabenzahl(), fehlerzahl(), notfaelle()])

  const zaehlerMarke =
    zaehler !== null && zaehler.offen > 0 ? (
      <span
        className={`zaehler${zaehler.ueberfaellig > 0 ? ' zaehler--ueberfaellig' : ''}`}
        title={
          zaehler.ueberfaellig > 0
            ? `${zaehler.offen} offen, ${zaehler.ueberfaellig} über der Frist`
            : `${zaehler.offen} offen`
        }
      >
        {zaehler.offen}
      </span>
    ) : null

  return (
    <div className="huelle">
      {/* Ein Name, weil es auf einer Seite mehr als eine Navigation gibt:
          Der Arbeitsplatz bringt seine Aufgabenliste mit, die Belegansicht
          ihre Seitenliste. Zwei namenlose `nav` sind fuer ein
          Vorleseprogramm nicht zu unterscheiden. */}
      <nav aria-label="Hauptnavigation" className="seitenleiste">
        <div className="seitenleiste-marke">
          DMS
          <small>Immobilienverwaltung</small>
        </div>

        {BEREICHE.map(([bereich, eintraege]) => (
          <div key={bereich} className="seitenleiste-gruppe">
            {/* Kein `h2`: Die Gruppennamen sind Beschriftungen der Leiste,
                keine Ueberschriften der Seite -- als Ueberschrift hiesse
                "Belege" zweimal, einmal hier und einmal ueber der Liste. */}
            <div className="seitenleiste-titel">{bereich}</div>
            {eintraege.map(([ziel, name]) => (
              <Navigationslink key={ziel} href={ziel}>
                <span>{name}</span>
                {/* Die Zahl steht nur am Postfach und nur, wenn es etwas zu
                    zaehlen gibt. Eine Null neben jedem Eintrag waere Rauschen,
                    und Rauschen macht die eine Zahl unsichtbar, auf die es
                    ankommt. */}
                {name === 'Postfächer' && zaehlerMarke}
                {/* Der Fehlerkorb zaehlt immer rot: Was dort liegt, ist
                    liegengeblieben, und dafuer gibt es keine Frist, die noch
                    laufen koennte. */}
                {name === 'Fehlerkorb' && fehler > 0 && (
                  <span className="zaehler zaehler--ueberfaellig" title={`${fehler} liegengeblieben`}>
                    {fehler}
                  </span>
                )}
              </Navigationslink>
            ))}
          </div>
        ))}

        {/* Abmelden ist ein Formular, kein Link: Es ändert etwas auf dem
            Server. Ein Link dorthin könnte von fremder Seite ausgelöst
            werden -- lästig, nicht gefährlich, aber unnötig. */}
        <form action={abmeldenAktion} className="seitenleiste-fuss">
          <button type="submit">Abmelden</button>
        </form>
      </nav>

      <div className="hauptbereich">
        <header className="kopfzeile">
          <h1>{titel}</h1>
          {zaehler !== null && zaehler.offen > 0 && (
            <span className="kopfzeile-rechts">
              {zaehler.offen} offen
              {zaehler.ueberfaellig > 0 && `, ${zaehler.ueberfaellig} über der Frist`}
            </span>
          )}
        </header>

        {/* Das Notfallband (Konzept 24.10). Steht ueber jeder Seite, solange
            irgendwo im Mandanten ein befristeter Zugriff laeuft -- und zwar
            fuer alle, nicht nur fuer die Beteiligten. Wer selbst unter einem
            solchen Zugriff arbeitet, wird ausdruecklich daran erinnert: Er
            sieht gerade Belege, die ihm sonst nicht gehoeren. */}
        {offeneNotfaelle.length > 0 && (
          <aside className="notfallband">
            {offeneNotfaelle.map((n) => (
              <div key={n.id}>
                <strong>{n.eigener ? 'Ihr Notfallzugriff' : 'Notfallzugriff'}</strong>
                {' auf Objekt '}
                {n.objektnummer} — {n.objektname}
                {n.eigener ? '' : ` für ${n.benutzer}`}
                {', bis '}
                {n.ende.toLocaleDateString('de-DE')}. {n.grund}
              </div>
            ))}
            <div style={{ marginTop: '0.25rem' }}>
              <a href="/notfall">Notfallzugriffe ansehen</a>
            </div>
          </aside>
        )}

        <main className={breit ? 'inhalt inhalt--breit' : 'inhalt'}>{children}</main>
      </div>
    </div>
  )
}
