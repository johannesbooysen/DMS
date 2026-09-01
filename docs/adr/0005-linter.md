# ADR 0005 — Linter mit Typwissen, dafür TypeScript 6

**Status:** angenommen (2026-09-01)
**Betrifft:** `eslint.config.mjs`, `package.json`, `tsconfig.json`

## Ausgangslage

`npm run lint` stand von Anfang an in `package.json` und brach seit dem
ersten Commit ab: ESLint war nie installiert. Der Befehl war eine Behauptung.

Das ist nicht bloß Unordnung. Der Code ist durchgängig `async` und spricht die
Datenbank an; ein vergessenes `await` schreibt trotzdem — nur nicht in der
Transaktion, in der es sollte. Das fällt beim Lesen nicht auf, beim
Typprüfer nicht auf, und in Tests mit wenigen Zeilen auch nicht. Es fällt
unter Last auf.

Genau dagegen gibt es eine Regel: `@typescript-eslint/no-floating-promises`.
Sie braucht **Typinformationen**, nicht nur den Syntaxbaum.

## Das Hindernis

Beim Einrichten stellte sich heraus: Das Projekt hatte TypeScript **7.0.2**,
und `typescript-eslint` (in der Fassung, die `eslint-config-next 16.3.4`
mitbringt) verweigert die Arbeit mit TS 7 rundheraus — nicht als Warnung,
sondern mit einem Abbruch beim Laden des Moduls.

TypeScript 7 hatte niemand ausgesucht. Weder Next.js noch sonst etwas im
Projekt verlangt es; es kam als „latest" herein.

## Erwogen und verworfen

**Abhängigkeitsbaum erzwingen** (`overrides` plus `--force`). npm lehnt die
saubere Variante ab, weil TypeScript als Peer-Abhängigkeit hochgezogen ist.
Mit `--force` entstünde ein Baum, den der nächste `npm install` still wieder
zerlegt — und dann bricht der Linter irgendwann ohne erkennbaren Anlass.

**TypeScript 6 daneben installieren**, unter einem anderen Namen. Das ist der
Weg, den Microsoft für den Übergang beschreibt. Er scheitert hier daran, dass
`typescript-eslint` keine Einstellung hat, mit der sich ein anderer
Modulpfad für den Compiler angeben ließe.

**Auf die typbezogenen Regeln verzichten** und nur syntaktisch prüfen. Damit
wäre der Anlass weg: `no-floating-promises`, `no-misused-promises` und
`await-thenable` sind der Grund, den Linter überhaupt einzurichten. Der Rest
— Einrückung, Anführungszeichen, Reihenfolge von Importen — ist Geschmack und
lohnt keinen Werkzeugkasten. Erschwerend: `eslint-config-next` bricht schon
beim Laden ab, es gäbe also gar keine Prüfung.

## Entscheidung

**TypeScript auf 6.x festlegen**, bis `typescript-eslint` TS 7 unterstützt.

Die ganze Werkzeugkette läuft damit auf einer Version: Typprüfer, Linter,
Editor und Build sind sich einig, was der Code bedeutet. Ein Linter, der
einen anderen Compiler benutzt als `npm run typecheck`, ist ohnehin eine
Quelle für Streitfälle, die niemand auflösen kann.

Der Code lief unverändert durch `tsc` 6 — keine Anpassung nötig. Was verloren
geht, ist die höhere Übersetzungsgeschwindigkeit der neuen Fassung. Bei
diesem Umfang ist das messbar, aber nicht spürbar.

**Zurückzunehmen, sobald** `typescript-eslint` TS 7 unterstützt
([Vorgang 10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)):
in `package.json` die Fassung wieder auf `^7` setzen, `npm run lint` und
`npm run typecheck` laufen lassen, dieses ADR auf `abgelöst` setzen.

## Zwei Regeln sind ausgeschaltet, beide mit Grund

**`require-await`.** Beim ersten Lauf waren 30 von 51 Befunden
Implementierungen von Schnittstellen — `Ablage`, `Versand`, `Texterkennung`,
`Postablage`. Deren Methoden sind `async`, weil die *Schnittstelle* ein
Promise verlangt; eine Umsetzung, die aus dem Speicher antwortet, hat darin
nichts zu erwarten. Die Regel kämpft hier gegen den Entwurf, und die Gefahr,
die sie adressieren soll, fängt `no-floating-promises` ohne Falschmeldungen.

**`no-img-element`.** Die Seitenbilder liegen als fertige WebP in der Ablage,
in genau der Breite, in der sie angezeigt werden — vorgerendert beim Eingang,
weil das den Viewer schnell macht (Konzept 1). `next/image` legte eine zweite
Optimierungsschicht über etwas bereits Optimiertes.

## Konsequenzen

**Der Linter läuft nicht im Commit-Hook.** Er braucht 31 Sekunden, die
Dokumentationsprüfung zwei. Ein Hook, der eine halbe Minute kostet, erzieht
zu `--no-verify` — und damit fiele die Dokumentationsprüfung gleich mit weg.
`npm run lint` läuft von Hand und gehört in eine Bauprüfung, sobald es eine
gibt.

**`scripts/` steht jetzt in der `tsconfig.json`.** Das war keine Absicht des
Linters, sondern ein Nebenfund: Der Ordner enthält Auswertungs- und
Exportskripte und wurde vom Typprüfer nie angesehen. Er war fehlerfrei — das
war Glück, nicht Prüfung.

**Was der erste Lauf gefunden hat:** neun ungenutzte Namen in Tests, vier
Navigationslinks als `<a>` statt `Link`. **Kein einziges vergessenes
`await`.** Das ist die beruhigendste Auskunft dieses Vorgangs — und sie war
vorher nicht zu haben.
