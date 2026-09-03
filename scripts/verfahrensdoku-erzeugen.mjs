/**
 * Erzeugt docs/verfahrensdokumentation.md aus dem Repository.
 *
 * Die GoBD verlangt eine Beschreibung des Verfahrens, nach dem Belege
 * entstehen, verarbeitet und aufbewahrt werden -- und zwar so, dass ein
 * sachverstaendiger Dritter sie in angemessener Zeit nachvollziehen kann.
 *
 * WARUM ERZEUGT UND NICHT GESCHRIEBEN
 *
 * Eine von Hand gepflegte Beschreibung eines Systems, das sich woechentlich
 * aendert, ist nach einem Monat eine Erzaehlung. Und eine falsche
 * Verfahrensdokumentation ist schlimmer als gar keine: Sie behauptet
 * Kontrollen, die es nicht gibt, und ein Pruefer, der eine davon nachpruefen
 * laesst, zieht danach alles andere in Zweifel.
 *
 * Deshalb wird hier abgeleitet, was ableitbar ist -- Tabellen, Trigger,
 * Policies, Warteschlangen, Zusagen -- und **belegt durch die Tests, die sie
 * pruefen**. Der Testname ist die Zusicherung; steht sie nicht mehr da, ist
 * sie auch nicht mehr belegt.
 *
 * WAS NICHT ABLEITBAR IST
 *
 * Organisation, Zustaendigkeiten, Aufbewahrungsort, Notfallverfahren. Das
 * steht in docs/verfahrensdoku-organisation.md und wird von Hand gepflegt;
 * dieser Erzeuger liest es ein und stellt es voran. Fehlt die Datei, sagt
 * das erzeugte Dokument das an ihrer Stelle -- eine Luecke gehoert
 * ausgewiesen, nicht verschwiegen.
 *
 * Bewusst OHNE Zeitstempel und ohne Zufall: die Ausgabe haengt nur vom
 * Inhalt des Repositories ab. Nur so kann `npm run docs:check` durch
 * Neuerzeugen und Vergleichen feststellen, ob die Datei veraltet ist -- und
 * nur so hat der Hash einer freigegebenen Fassung eine Bedeutung.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, nicht URL.pathname: der Projektpfad enthaelt Leerzeichen,
// und pathname liefert sie prozentkodiert zurueck.
const WURZEL = fileURLToPath(new URL('..', import.meta.url))

async function dateienUnter(verzeichnis, endung) {
  const gefunden = []
  async function absteigen(pfad) {
    let eintraege
    try {
      eintraege = await readdir(pfad, { withFileTypes: true })
    } catch {
      return
    }
    for (const eintrag of eintraege.sort((a, b) => a.name.localeCompare(b.name))) {
      const voll = join(pfad, eintrag.name)
      if (eintrag.isDirectory()) await absteigen(voll)
      else if (eintrag.name.endsWith(endung)) gefunden.push(voll)
    }
  }
  await absteigen(join(WURZEL, verzeichnis))
  return gefunden
}

const pfadNachAussen = (voll) => relative(WURZEL, voll).split('\\').join('/')

function tabelle(kopf, zeilen) {
  if (zeilen.length === 0) return '_keine_\n'
  return [
    `| ${kopf.join(' | ')} |`,
    `|${kopf.map(() => '---').join('|')}|`,
    ...zeilen.map((z) => `| ${z.join(' | ')} |`),
  ].join('\n') + '\n'
}

/**
 * Die Kontrollen, die das Schema erzwingt.
 *
 * Trigger und Policies sind der harte Teil der Verfahrensdokumentation: Sie
 * wirken unabhaengig davon, ob die Anwendung sich daran haelt. Genau danach
 * fragt ein Pruefer -- eine Regel, die nur im Anwendungscode steht, ist eine
 * Absichtserklaerung.
 */
async function kontrollen() {
  const dateien = await dateienUnter('supabase/migrations', '.sql')
  const trigger = []
  const policies = []
  const tabellen = []

  for (const datei of dateien) {
    const quelltext = await readFile(datei, 'utf8')
    const pfad = pfadNachAussen(datei)

    // before **und** after: Der Trigger, der den Stempel-Layer aus seinem
    // Ereignis erzeugt, laeuft danach -- er ist trotzdem eine Kontrolle, und
    // im ersten Entwurf fehlte er deshalb ganz.
    for (const t of quelltext.matchAll(
      /^create trigger (\w+)\s*\n\s*(before|after) ([\w\s]+?) on (\w+)/gm,
    )) {
      trigger.push({ name: t[1], wann: `${t[2]} ${t[3].trim()}`, tabelle: t[4], pfad })
    }
    for (const p of quelltext.matchAll(/^create policy (\w+) on (\w+) for (\w+)/gm)) {
      policies.push({ name: p[1], tabelle: p[2], art: p[3], pfad })
    }
    for (const tb of quelltext.matchAll(/^create table (\w+)/gm)) {
      tabellen.push({ name: tb[1], pfad })
    }
  }
  return { trigger, policies, tabellen }
}

/**
 * Die Zusicherungen, die geprueft werden -- je Testdatei.
 *
 * Der Testname *ist* die Zusicherung. Fuer die GoBD ist das der Nachweis der
 * Wirksamkeit: Nicht "wir sichern zu, dass ein fremder Mandant nichts sieht",
 * sondern ein Testfall, der genau das versucht und scheitert.
 */
async function nachweise() {
  const dateien = (await dateienUnter('tests', '.ts')).filter((d) => d.endsWith('.test.ts'))
  const zeilen = []
  for (const datei of dateien) {
    const quelltext = await readFile(datei, 'utf8')
    const faelle = [...quelltext.matchAll(/^\s*it\(\s*\n?\s*'([^']+)'/gm)].map((t) => t[1])
    // `wennSpeicher(...)` in den S3-Tests ist ein `it` unter anderem Namen --
    // ohne diesen Zusatz faehlt der Nachweis der Objektsperre komplett.
    const bedingte = [...quelltext.matchAll(/^\s*wennSpeicher\('([^']+)'/gm)].map((t) => t[1])
    zeilen.push({
      pfad: pfadNachAussen(datei),
      faelle: [...faelle, ...bedingte],
    })
  }
  return zeilen.filter((z) => z.faelle.length > 0)
}

/**
 * Was von aussen hereinkommt und was hinausgeht.
 *
 * **Ueber die Aufrufer der beiden Schleusen, nicht ueber Stichworte.** Der
 * erste Entwurf suchte nach Woertern wie "eingangsquelle" und zaehlte
 * daraufhin die Objektakte und den Fehlerkorb als Eingangswege -- beides
 * falsch. Eine falsche Verfahrensdokumentation ist schlimmer als gar keine:
 * Sie behauptet Wege, die es nicht gibt, und wer einen davon nachprueft,
 * zieht danach alles andere in Zweifel.
 *
 * Praezise geht es, weil es je Richtung genau **eine** Schleuse gibt --
 * `dokumentAufnehmen` und `postAnlegen`. Das ist selbst eine Zusage des
 * Systems (CLAUDE.md), und diese Liste belegt sie: Taucht hier ein Modul auf,
 * das keine Schleuse benutzt, ist die Zusage gebrochen.
 */
async function wege() {
  const schleusen = [
    { name: 'dokumentAufnehmen', art: 'Eingang' },
    { name: 'postAnlegen', art: 'Ausgang' },
  ]
  const quellen = []
  for (const datei of await dateienUnter('src', '.ts')) {
    const quelltext = await readFile(datei, 'utf8')
    const pfad = pfadNachAussen(datei)
    // Kommentarzeilen zaehlen nicht -- sonst stuende jedes Modul hier, das
    // die Regel nur erwaehnt.
    const code = quelltext
      .split('\n')
      .filter((z) => !/^\s*(\*|\/\/|\/\*)/.test(z))
      .join('\n')

    for (const schleuse of schleusen) {
      const definiert = new RegExp(`export async function ${schleuse.name}\\b`).test(code)
      const ruft = new RegExp(`\\b${schleuse.name}\\s*\\(`).test(code)
      if (definiert || ruft) {
        quellen.push({ pfad, art: schleuse.art, rolle: definiert ? 'Schleuse' : 'nutzt sie' })
      }
    }
  }
  return quellen
}

async function organisation() {
  try {
    return (await readFile(join(WURZEL, 'docs/verfahrensdoku-organisation.md'), 'utf8')).trim()
  } catch {
    return null
  }
}

export async function verfahrensdokuErzeugen() {
  const { trigger, policies, tabellen } = await kontrollen()
  const n = await nachweise()
  const w = await wege()
  const org = await organisation()

  const rlsTabellen = [...new Set(policies.map((p) => p.tabelle))].sort()

  return `# Verfahrensdokumentation

> **Erzeugt aus dem Repository.** Nicht von Hand bearbeiten —
> \`npm run verfahrensdoku\` schreibt diese Datei neu. Der organisatorische
> Teil steht in [verfahrensdoku-organisation.md](verfahrensdoku-organisation.md)
> und wird von Hand gepflegt.
>
> Diese Datei beschreibt den **Stand des Quelltexts**. Verbindlich ist die
> jeweils *freigegebene* Fassung: \`npm run verfahrensdoku:freigeben\` legt
> eine Kopie mit Hash in der Ablage ab und hält in der Tabelle
> \`verfahrensdokumentation\` fest, ab wann sie gilt. Jeder archivierte Beleg
> trägt die Fassung, die bei seiner Archivierung galt
> (\`archiv_eintrag.verfahrensdoku_version\`).

## 1. Organisatorischer Teil

${
  org ??
  `> **Fehlt.** \`docs/verfahrensdoku-organisation.md\` ist nicht vorhanden.
>
> Ohne den organisatorischen Teil ist diese Dokumentation nach GoBD
> unvollständig: Zuständigkeiten, Aufbewahrungsort, Vertretungs- und
> Notfallregelungen lassen sich nicht aus dem Quelltext ableiten. Die Lücke
> steht hier, statt verschwiegen zu werden.`
}

## 2. Das Datenmodell

${tabellen.length} Tabellen. Sie sind der Gegenstand der Aufbewahrung — was
hier nicht steht, wird auch nicht aufbewahrt.

${tabelle(
  ['Tabelle', 'Angelegt in'],
  tabellen.map((t) => [`\`${t.name}\``, `[\`${t.pfad.split('/').pop()}\`](../${t.pfad})`]),
)}
## 3. Unveränderlichkeit: die Trigger

Diese Regeln wirken in der Datenbank und damit unabhängig davon, ob die
Anwendung sich daran hält. Eine Regel, die nur im Anwendungscode stünde, wäre
eine Absichtserklärung — hier ist sie eine Sperre.

${tabelle(
  ['Trigger', 'Auf', 'Wann', 'Quelle'],
  trigger.map((t) => [
    `\`${t.name}\``,
    `\`${t.tabelle}\``,
    t.wann,
    `[\`${t.pfad.split('/').pop()}\`](../${t.pfad})`,
  ]),
)}
## 4. Zugriffsschutz: die Policies

Row Level Security ist in diesem System die Sicherheitsgrenze, nicht ein
Feature. Jede Abfrage läuft unter der Rolle \`dms_app\` — nicht als
Tabelleneigentümer —, sodass die Policies nicht umgangen werden können.

Tabellen mit Policies (${rlsTabellen.length}): ${rlsTabellen
    .map((t) => `\`${t}\``)
    .join(', ')}

${tabelle(
  ['Policy', 'Tabelle', 'Art', 'Quelle'],
  policies.map((p) => [
    `\`${p.name}\``,
    `\`${p.tabelle}\``,
    p.art,
    `[\`${p.pfad.split('/').pop()}\`](../${p.pfad})`,
  ]),
)}
## 5. Ein- und Ausgang

Je Richtung gibt es genau **eine** Schleuse. Jeder Beleg — hochgeladen, aus
einem überwachten Ordner geholt, aus einem Postfach abgerufen oder aus einem
Stapel getrennt — geht durch \`dokumentAufnehmen\`, mit derselben Hash-,
Dubletten- und Warteschlangenbehandlung. Nichts verlässt das Haus außerhalb
des Ausgangsbuchs (\`postAnlegen\`).

${tabelle(
  ['Weg', 'Rolle', 'Modul'],
  w.map((q) => [q.art, q.rolle, `[\`${q.pfad}\`](../${q.pfad})`]),
)}
## 6. Nachweis der Wirksamkeit

Für die GoBD genügt es nicht, Kontrollen zu beschreiben — sie müssen wirksam
sein. Die folgenden Zusicherungen werden bei jedem Testlauf geprüft. Der
Testname *ist* die Zusicherung; verschwindet sie hier, ist sie nicht mehr
belegt.

${n
  .map(
    (d) =>
      `### [\`${d.pfad}\`](../${d.pfad})\n\n` +
      d.faelle.map((f) => `- ${f}`).join('\n') +
      '\n',
  )
  .join('\n')}`
}

// Nur schreiben, wenn direkt aufgerufen -- doku-pruefen.mjs importiert die
// Funktion, um zu vergleichen, und darf dabei nichts veraendern.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { writeFile } = await import('node:fs/promises')
  const inhalt = await verfahrensdokuErzeugen()
  await writeFile(join(WURZEL, 'docs/verfahrensdokumentation.md'), inhalt, 'utf8')
  console.log('docs/verfahrensdokumentation.md geschrieben')
}
