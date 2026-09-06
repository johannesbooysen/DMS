/**
 * Eingangsquellen.
 *
 * Die Seite beantwortet eine einzige Frage, und sie ist die wichtigste bei
 * einem Kanal, dem niemand zusieht: **Läuft das noch?**
 *
 * Deshalb stehen „zuletzt nachgesehen" und „zuletzt etwas bekommen"
 * nebeneinander. Der Unterschied ist die Auskunft: Eine Quelle, die läuft und
 * nichts findet, ist etwas anderes als eine, die gar nicht mehr läuft.
 *
 * Seit dem Einrichten in dieser Maske kommen zwei Antworten dazu, die vorher
 * niemand hatte:
 *
 *   * **Ist die Umgebungsvariable gesetzt?** Eine Quelle, deren Passwort auf
 *     diesem Server fehlt, scheitert beim nächsten Lauf — der Fehler landet
 *     in einer Spalte, die niemand liest, bis eine Rechnung vermisst wird.
 *   * **Lebt der Träger noch?** Eine Quelle arbeitet unter den Rechten ihres
 *     Einrichters. Ist der gesperrt, steht sie still. Richtig so — aber nur,
 *     wenn man es sieht.
 */

import Link from 'next/link'
import { quelleneinrichtungLaden } from '@/stammdaten/quellen'
import { objekteLaden, ordnungsgruppenLaden, rechtelage } from '@/stammdaten'
import { quelleAnlegenAktion, quelleUmschaltenAktion } from '@/app/lib/stammdaten-aktionen'
import { quellenLaden } from '@/eingang'
import { angemeldeterBenutzer } from '@/app/lib/sitzung'
import { seit, Seitenrahmen } from '@/app/lib/darstellung'
import { Anlegen, Auswahl, Eingabe, Fehler, Handlung, Marke } from '@/app/lib/stammdaten-teile'

export const dynamic = 'force-dynamic'

const HIER = '/eingang'

const zelle = {
  borderBottom: '1px solid #eee',
  padding: '0.45rem 0.5rem',
  verticalAlign: 'top',
} as const

const ART: Record<string, string> = {
  ordner: 'Überwachter Ordner',
  mail: 'Mailpostfach',
}

export default async function Eingangsquellen({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; art?: string }>
}) {
  const benutzer = await angemeldeterBenutzer()
  const { fehler, art } = await searchParams

  const [quellen, einrichtung, darf, objekte, gruppen] = await Promise.all([
    quellenLaden(benutzer),
    quelleneinrichtungLaden(benutzer),
    rechtelage(benutzer),
    objekteLaden(benutzer),
    ordnungsgruppenLaden(benutzer),
  ])

  const nach = new Map(einrichtung.map((e) => [e.id, e]))
  // Welches Formular gezeigt wird -- ein Ordner braucht einen Pfad, ein
  // Postfach einen Server. Beides nebeneinander waere eine Maske mit
  // Feldern, die je zur Haelfte leer bleiben.
  const mailformular = art === 'mail'

  return (
    <Seitenrahmen titel="Eingangsquellen">
      <Fehler text={fehler} />

      <p style={{ color: '#555' }}>
        Woher Belege von selbst hereinkommen. Was hier ankommt, geht durch
        denselben Eingang wie ein Upload — dieselbe Dublettenprüfung, dieselbe
        Aufbereitung.
      </p>

      {quellen.length === 0 ? (
        <p>Es ist keine Quelle eingerichtet. Belege kommen nur über Upload und Scan herein.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ color: '#555', fontSize: '0.78rem', textAlign: 'left' }}>
              <th style={zelle}>Quelle</th>
              <th style={zelle}>Nachgesehen</th>
              <th style={zelle}>Zuletzt etwas bekommen</th>
              <th style={zelle}>Gesamt</th>
              <th style={zelle}>Stand</th>
              <th style={zelle} />
            </tr>
          </thead>
          <tbody>
            {quellen.map((q) => {
              const e = nach.get(q.id)
              return (
                <tr key={q.id}>
                  <td style={zelle}>
                    <strong>{q.bezeichnung}</strong>
                    <div style={{ color: '#666', fontSize: '0.78rem' }}>
                      {ART[q.art] ?? q.art} · alle {Math.round(q.taktSekunden / 60) || 1} min
                      {e?.traeger != null && <> · getragen von {e.traeger}</>}
                    </div>
                    {e?.passwortVariable != null && (
                      <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        <code>{e.passwortVariable}</code>{' '}
                        {e.passwortVorhanden ? (
                          <Marke text="gesetzt" farbe="#2F6F4E" />
                        ) : (
                          <Marke text="fehlt auf diesem Server" farbe="#B3271E" />
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ ...zelle, fontSize: '0.85rem' }}>
                    {q.zuletztGeprueft === null ? 'noch nie' : seit(q.zuletztGeprueft)}
                  </td>
                  <td style={{ ...zelle, fontSize: '0.85rem' }}>
                    {q.zuletztErfolg === null ? '—' : seit(q.zuletztErfolg)}
                  </td>
                  <td style={{ ...zelle, fontSize: '0.85rem' }}>{q.aufgenommen}</td>
                  <td style={zelle}>
                    {!q.aktiv ? (
                      <span style={{ color: '#666' }}>abgeschaltet</span>
                    ) : e?.traegerAktiv === false ? (
                      <span style={{ color: '#B3271E' }}>
                        Träger gesperrt — die Quelle steht still
                      </span>
                    ) : q.letzterFehler !== null ? (
                      <span style={{ color: '#B3271E' }}>{q.letzterFehler}</span>
                    ) : (
                      <span style={{ color: '#2F6F4E' }}>läuft</span>
                    )}
                  </td>
                  <td style={zelle}>
                    <Handlung
                      aktion={quelleUmschaltenAktion}
                      zurueck={HIER}
                      felder={{ id: q.id }}
                    >
                      {q.aktiv ? 'abschalten' : 'einschalten'}
                    </Handlung>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: '1.05rem', margin: '2rem 0 0.25rem' }}>Quelle einrichten</h2>
      <p style={{ color: '#555', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
        <Link href="?art=ordner">Überwachter Ordner</Link>
        {' · '}
        <Link href="?art=mail">Mailpostfach</Link>
        {' — '}
        aktuell: <strong>{mailformular ? 'Mailpostfach' : 'Überwachter Ordner'}</strong>
      </p>

      {mailformular ? (
        <>
          <Anlegen aktion={quelleAnlegenAktion} zurueck={HIER} beschriftung="Postfach einrichten">
            <input type="hidden" name="art" value="mail" />
            <Eingabe name="bezeichnung" label="Bezeichnung" breite="14rem" pflicht />
            <Eingabe name="host" label="Server" breite="14rem" pflicht />
            <Eingabe name="postfach" label="Postfach" breite="16rem" pflicht />
            <Eingabe name="passwortVariable" label="Umgebungsvariable" breite="14rem" pflicht />
            <Eingabe name="ordner" label="Ordner" breite="8rem" />
            <Eingabe name="taktSekunden" label="Takt (s)" breite="6rem" wert="300" />
            <Auswahl
              name="objektId"
              label="Objekt vorbelegen"
              breite="12rem"
              leer="keins"
              optionen={objekte.map((o) => ({
                wert: o.id,
                text: `${o.objektnummer} · ${o.bezeichnung}`,
              }))}
            />
            <Auswahl
              name="ordnungsgruppeId"
              label="Gruppe vorbelegen"
              breite="12rem"
              leer="keine"
              optionen={gruppen.map((g) => ({ wert: g.id, text: g.name }))}
            />
          </Anlegen>
          <p style={{ color: '#555', fontSize: '0.8rem' }}>
            <strong>Hier gibt es kein Passwortfeld, und das ist Absicht.</strong> Eingetragen
            wird der <em>Name</em> einer Umgebungsvariablen; das Geheimnis selbst liegt auf dem
            Rechner, auf dem der Worker läuft. Ein Datenbankauszug gibt damit keinen
            Postfachzugang her — und was sich nicht eingeben lässt, kann auch nicht
            versehentlich in der Datenbank landen.
          </p>
        </>
      ) : (
        <Anlegen aktion={quelleAnlegenAktion} zurueck={HIER} beschriftung="Ordner einrichten">
          <input type="hidden" name="art" value="ordner" />
          <Eingabe name="bezeichnung" label="Bezeichnung" breite="14rem" pflicht />
          <Eingabe name="pfad" label="Pfad" breite="20rem" pflicht />
          <Eingabe name="erledigtPfad" label="Erledigt-Ordner" breite="16rem" />
          <Eingabe name="taktSekunden" label="Takt (s)" breite="6rem" wert="300" />
          <Auswahl
            name="objektId"
            label="Objekt vorbelegen"
            breite="12rem"
            leer="keins"
            optionen={objekte.map((o) => ({
              wert: o.id,
              text: `${o.objektnummer} · ${o.bezeichnung}`,
            }))}
          />
          <Auswahl
            name="ordnungsgruppeId"
            label="Gruppe vorbelegen"
            breite="12rem"
            leer="keine"
            optionen={gruppen.map((g) => ({ wert: g.id, text: g.name }))}
          />
        </Anlegen>
      )}

      <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '1.5rem' }}>
        Eine Quelle arbeitet unter den Rechten dessen, der sie einrichtet — kein technisches
        Konto. Am Beleg steht dadurch ein Name, den man fragen kann. Einrichten darf, wer
        Abläufe konfigurieren darf: Eine Eingangsquelle bestimmt, welche Belege überhaupt
        entstehen.
        {!darf.stammdaten && ' Das Aufräumen der Stammdaten ist ein anderes Recht.'}
      </p>
    </Seitenrahmen>
  )
}
