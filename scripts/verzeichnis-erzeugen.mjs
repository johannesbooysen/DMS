/**
 * Erzeugt docs/verzeichnis.md -- das Verzeichnis von Verarbeitungstaetigkeiten
 * nach Art. 30 DSGVO (Konzept §24.5).
 *
 * WARUM ERZEUGT
 *
 * Aus demselben Grund wie die Verfahrensdokumentation: Ein von Hand
 * gepflegtes Verzeichnis eines Systems, das sich woechentlich aendert, ist
 * nach einem Monat unvollstaendig -- und unvollstaendig heisst bei Art. 30
 * bussgeldbewehrt. Die Luecke entsteht dabei nie durch boesen Willen,
 * sondern durch eine neue Tabelle, an die beim Schreiben niemand gedacht
 * hat.
 *
 * WAS HIER GEPRUEFT WIRD, NICHT NUR GESCHRIEBEN
 *
 * Der Erzeuger liest die `create table`-Anweisungen aus den Migrationen und
 * vergleicht sie mit der Einordnung in `verzeichnis-daten.mjs`. Steht eine
 * Tabelle in keiner Taetigkeit und auch nicht in der Liste ohne
 * Personenbezug, **bricht er ab** -- Rueckgabewert 1, und die Luecke steht
 * benannt in der Ausgabe.
 *
 * Das ist der eigentliche Ertrag: Nicht der Text, sondern dass eine neue
 * Tabelle nicht stillschweigend hereinrutschen kann.
 *
 * WAS NICHT ABLEITBAR IST
 *
 * Verantwortlicher, Datenschutzbeauftragter, Rechtsgrundlagen nach Art. 6,
 * Empfaenger, Drittlandsuebermittlungen. Das steht von Hand in
 * `docs/verzeichnis-organisation.md` und wird vorangestellt. Fehlt die
 * Datei, weist das erzeugte Dokument die Luecke aus -- eine benannte Luecke
 * ist brauchbar, eine verschwiegene nicht.
 *
 * Bewusst OHNE Zeitstempel: Die Ausgabe haengt nur vom Repository ab, damit
 * `npm run docs:check` durch Neuerzeugen und Vergleichen feststellen kann,
 * ob die Datei veraltet ist.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OHNE_PERSONENBEZUG, TAETIGKEITEN } from './verzeichnis-daten.mjs'

// fileURLToPath, nicht URL.pathname: der Projektpfad enthaelt Leerzeichen.
const WURZEL = fileURLToPath(new URL('..', import.meta.url))

/**
 * Alle Tabellen des Schemas, aus den Migrationen gelesen.
 *
 * Aus dem Repository und nicht aus der Datenbank: Der Erzeuger laeuft in der
 * Pruefung, bevor eine Datenbank hochgefahren ist -- und die Ausgabe soll
 * nur vom Quelltext abhaengen.
 *
 * Die Ziffer im Muster ist nicht schmueckend: `kontierung_35a` heisst so,
 * und ein Muster ohne Ziffern haette sie zu `kontierung_` verkuerzt.
 */
async function tabellenAusMigrationen() {
  const verzeichnis = join(WURZEL, 'supabase/migrations')
  const dateien = (await readdir(verzeichnis)).filter((n) => n.endsWith('.sql')).sort()
  const gefunden = new Set()
  for (const datei of dateien) {
    const inhalt = await readFile(join(verzeichnis, datei), 'utf8')
    for (const treffer of inhalt.matchAll(
      /^create table (?:if not exists )?([a-z0-9_]+)/gim,
    )) {
      gefunden.add(treffer[1])
    }
  }
  return [...gefunden].sort()
}

async function organisation() {
  try {
    return (await readFile(join(WURZEL, 'docs/verzeichnis-organisation.md'), 'utf8')).trim()
  } catch {
    return null
  }
}

function liste(eintraege) {
  return eintraege.map((e) => `- ${e}`).join('\n')
}

function abschnitt(t) {
  return `### ${t.name}

**Zweck der Verarbeitung**

${t.zweck}

**Kategorien betroffener Personen**

${liste(t.betroffene)}

**Kategorien personenbezogener Daten**

${liste(t.daten)}

**Vorgesehene Fristen für die Löschung**

${t.frist}

**Wo die Daten liegen** (${t.tabellen.length} Tabellen)

\`${t.tabellen.join('`, `')}\`
`
}

/**
 * Erzeugt den Text und meldet, was nicht eingeordnet ist.
 *
 * Gibt zurueck statt zu schreiben, damit `doku-pruefen.mjs` vergleichen
 * kann, ohne dabei etwas zu veraendern -- wie beim Verfahrensdoku-Erzeuger.
 */
export async function verzeichnisErzeugen() {
  const tabellen = await tabellenAusMigrationen()

  const eingeordnet = new Map()
  for (const t of TAETIGKEITEN) {
    for (const tab of t.tabellen) {
      if (eingeordnet.has(tab)) {
        console.error(
          `Tabelle "${tab}" steht in zwei Tätigkeiten: ` +
            `${eingeordnet.get(tab)} und ${t.id}.`,
        )
        process.exitCode = 1
      }
      eingeordnet.set(tab, t.id)
    }
  }
  for (const tab of Object.keys(OHNE_PERSONENBEZUG)) {
    if (eingeordnet.has(tab)) {
      console.error(
        `Tabelle "${tab}" steht in einer Tätigkeit und zugleich ohne Personenbezug.`,
      )
      process.exitCode = 1
    }
    eingeordnet.set(tab, 'ohne')
  }

  const fehlend = tabellen.filter((t) => !eingeordnet.has(t))
  const zuviel = [...eingeordnet.keys()].filter((t) => !tabellen.includes(t))

  const org = await organisation()

  const text = `# Verzeichnis von Verarbeitungstätigkeiten

<!-- ERZEUGT von scripts/verzeichnis-erzeugen.mjs. Nicht von Hand ändern.
     Der organisatorische Teil steht in docs/verzeichnis-organisation.md,
     die Einordnung der Tabellen in scripts/verzeichnis-daten.mjs. -->

Nach Art. 30 DSGVO. Der technische Teil ist aus dem Repository abgeleitet;
der organisatorische Teil steht in
[verzeichnis-organisation.md](verzeichnis-organisation.md) und wird von Hand
gepflegt.

${
  org ??
  `> **Fehlt.** \`docs/verzeichnis-organisation.md\` ist nicht vorhanden.
> Ohne Verantwortlichen, Rechtsgrundlagen und Empfänger ist dieses
> Verzeichnis unvollständig.`
}

---

## Die Verarbeitungstätigkeiten

${TAETIGKEITEN.map(abschnitt).join('\n')}
---

## Tabellen ohne Personenbezug

Diese Tabellen tragen keine personenbezogenen Daten. Sie stehen einzeln und
mit Grund, nicht als Rest — eine Restkategorie wäre die Stelle, an der eine
neue Tabelle mit Personenbezug unbemerkt landet.

| Tabelle | Warum ohne |
|---|---|
${Object.entries(OHNE_PERSONENBEZUG)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([tab, grund]) => `| \`${tab}\` | ${grund} |`)
  .join('\n')}

---

## Vollständigkeit

Das Schema hat **${tabellen.length} Tabellen**. Jede ist genau einmal
eingeordnet — entweder in einer Tätigkeit oder in der Liste ohne
Personenbezug. Geprüft beim Erzeugen gegen die \`create table\`-Anweisungen
der Migrationen; fehlt eine, bricht \`npm run verzeichnis\` ab.

${
  fehlend.length === 0 && zuviel.length === 0
    ? 'Zurzeit ist keine Tabelle offen.'
    : [
        fehlend.length > 0
          ? `> **⬜ Nicht eingeordnet:** \`${fehlend.join('`, `')}\`\n> Diese Tabellen sind einzuordnen, bevor das Verzeichnis vollständig ist.`
          : '',
        zuviel.length > 0
          ? `> **Eingeordnet, aber nicht im Schema:** \`${zuviel.join('`, `')}\`\n> Vermutlich umbenannt oder entfernt.`
          : '',
      ]
        .filter((s) => s !== '')
        .join('\n\n')
}

---

## Technische und organisatorische Maßnahmen

Die Maßnahmen nach Art. 32 DSGVO sind im Einzelnen in der
[Verfahrensdokumentation](verfahrensdokumentation.md) beschrieben und dort
durch die Tests belegt, die sie prüfen. Die tragenden:

- **Row Level Security als Sicherheitsgrenze**, nicht als Zusatz: Jede
  Abfrage läuft unter der Rolle \`dms_app\` mit gesetzter Benutzerkennung,
  nie als Tabelleneigentümer.
- **Getrennte Lese- und Schreibrechte** je Stammdatentabelle; Rollen sind
  additiv, nie subtraktiv.
- **Einschränkung statt Löschung** bei Löschansprüchen an
  aufbewahrungspflichtigen Belegen — für alle sichtbar entzogen, der Vorgang
  bleibt nachweisbar.
- **Append-only mit Hash-Kette** für Stempelereignisse; Archivierte Belege
  sind durch Trigger festgeschrieben.
- **Unveränderlicher Objektspeicher** (S3 Object Lock, Compliance-Modus) für
  archivierte Originale.
- **Befristeter, begründeter und sichtbarer Notfallzugriff** statt stiller
  Rechteausweitung.
- **Keine personenbezogenen Daten in Logs und Fehlermeldungen** — Projektregel,
  in den Modulen an den Fangstellen vermerkt.
`

  return { text, fehlend, zuviel, anzahl: tabellen.length }
}

// Nur schreiben, wenn direkt aufgerufen -- doku-pruefen.mjs importiert die
// Funktion, um zu vergleichen, und darf dabei nichts veraendern.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { text, fehlend, zuviel, anzahl } = await verzeichnisErzeugen()
  await writeFile(join(WURZEL, 'docs/verzeichnis.md'), text, 'utf8')

  if (fehlend.length > 0) {
    console.error('Nicht eingeordnet: ' + fehlend.join(', '))
    console.error(
      'Einordnen in scripts/verzeichnis-daten.mjs -- entweder in eine ' +
        'Verarbeitungstaetigkeit oder in OHNE_PERSONENBEZUG, mit Grund.',
    )
    process.exitCode = 1
  }
  if (zuviel.length > 0) {
    console.error('Eingeordnet, aber nicht im Schema: ' + zuviel.join(', '))
    process.exitCode = 1
  }
  if (fehlend.length === 0 && zuviel.length === 0) {
    console.log('docs/verzeichnis.md geschrieben (' + anzahl + ' Tabellen eingeordnet)')
  }
}
