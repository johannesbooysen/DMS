# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stand des Repositories

Reines Konzept-Repository, **noch kein Code**. Einziger Inhalt ist [docs/konzept.md](docs/konzept.md) (1.219 Zeilen, deutsch) — das vollständige Gesamtkonzept eines DMS für die Immobilienverwaltung als Amagno-Ersatz. Es gibt noch keine `package.json`, keine Tests und kein Git-Repo — die Befehle unten beschreiben den vorgesehenen Zustand.

Das Konzept verweist auf mitgeltende Dateien, die noch **nicht** existieren: `schema-kern.sql`, `schema-einheit-person.sql`, `ablauf-viewer.html`, `konfiguration-mockup.html`. Wer sie anlegt, legt damit die Konventionen fest — vorher hier kurz gegenprüfen, ob die Namen aus dem Konzept übernommen werden sollen.

## Befehle

```bash
npm install                  # Setup
npm run dev                  # Next.js und Worker parallel
npm run dev:web              # nur Next.js
npm run dev:worker           # nur Worker
npm test                     # gesamte Testsuite
npm test -- pfad/zur/datei   # einzelne Testdatei
npm test -- -t "Mandant"     # einzelner Test nach Name
npm run test:watch           # Tests im Beobachtungsmodus
npm run lint                 # ESLint
npm run typecheck            # tsc --noEmit
npm run build                # Produktionsbuild
npm run start                # Produktionsserver
npm run worker               # Worker einmalig, ohne Beobachtung
```

Datenbank über die Supabase CLI, Migrationen sind handgeschriebenes DDL unter `supabase/migrations/`:

```bash
npm run db:start             # lokale Supabase-Instanz
npm run db:stop              # Instanz anhalten
npm run db:new <name>        # neue Migrationsdatei anlegen
npm run db:migrate           # Migrationen anwenden
npm run db:reset             # Datenbank neu aufbauen und Seed einspielen
```

Dokumentation:

```bash
npm run docs:stand           # docs/stand.md aus dem Repository neu erzeugen
npm run docs:check           # prüfen, ob die Dokumentation zum Code passt
```

`npm run dev` startet zwei Prozesse: die Next.js-Anwendung und den Worker. Einzeln laufen sie über `npm run dev:web` und `npm run dev:worker` — nützlich, wenn nur an der Pipeline gearbeitet wird.

Die Tests in `tests/` sprechen eine echte Postgres-Instanz an. Vorher `npm run db:start` und `npm run db:reset`; die Verbindung kommt aus `DATABASE_URL` und fällt sonst auf die lokale Supabase-Instanz zurück. Sie laufen als Rolle `dms_app`, nicht als Tabelleneigentümer — sonst würde die RLS umgangen und die Tests wären wertlos.


## Konventionen

- **Deutsch** in Kommentaren und Commit-Messages — passend zu den durchgängig deutschen, klein geschriebenen Domänenbegriffen (`dokument_lauf`, `stempel_ereignis`, `zuordnungs_merkmal`). Neue Schemaobjekte in derselben Sprache und Schreibweise anlegen; nicht ins Englische übersetzen.
- **Keine echten Personendaten in Testfixtures.** Das Datenmodell ist voll von personenbezogenen Feldern (`person`, `kreditor`, `einsicht_gewaehrung`, `zugriff_protokoll`, IBANs in `kreditor_bankverbindung`) — Fixtures und Seed-Daten arbeiten ausschließlich mit erfundenen Namen, Adressen und Bankverbindungen.
- **Keine Datenabfrage ohne Mandantenfilter.** Jede lesende Funktion braucht einen Test, der belegt, dass ein fremder Mandant nichts sieht.
- **Berechtigungsprüfung serverseitig**, nicht nur in der Oberfläche — die RLS-Policies sind die Sicherheitsgrenze, kein Feature.
- **Keine personenbezogenen Daten in Logs und Fehlermeldungen** — kein Rohtext aus Dokumenten, keine Namen, Adressen oder Kontodaten.
- **Vor jeder Performance-Optimierung messen, danach erneut.** Das Konzept macht es vor (§21); ohne Zahl keine Optimierung.

## Dokumentation

Vier Dokumente mit getrennten Aufgaben. Wer eines ändert, prüft, ob es ins andere gehört — doppelte Beschreibungen laufen auseinander.

| Datei | Für wen | Pflege |
|---|---|---|
| [docs/konzept.md](docs/konzept.md) | beide | von Hand, selten. Verbindliche Referenz, beschreibt den **Soll**zustand. Abweichungen der Umsetzung gehören in ein ADR, nicht ins Konzept. |
| [docs/stand.md](docs/stand.md) | Agenten | **erzeugt** aus dem Repository. Nie von Hand bearbeiten. |
| [docs/handbuch.md](docs/handbuch.md) | Menschen | von Hand. Einrichtung, Begriffe, häufige Fragen. |
| [docs/adr/](docs/adr/) | beide | von Hand, je Entscheidung eine Datei; Verzeichnis in `docs/adr/README.md`. |

`docs/stand.md` ist der schnellste Einstieg in ein unbekanntes Repository: Befehle, Migrationen mit ihren Tabellen, Module, Tests, Entscheidungen und die im Quelltext markierten offenen Stellen — alles abgeleitet, nichts behauptet.

**`npm run docs:check`** prüft, was sich sicher entscheiden lässt: ob `stand.md` aktuell ist, ob jedes npm-Skript hier erwähnt wird, ob jede Migration gelistet und jedes ADR im Verzeichnis steht. Ob eine Beschreibung noch *stimmt*, kann es nicht wissen — dafür gibt es den Agenten `doku-pflege`, der nach inhaltlichen Änderungen die geschriebenen Dokumente nachzieht.

Der Hook unter `.githooks/pre-commit` führt die Prüfung vor jedem Commit aus. Einmalig zu aktivieren:

```bash
git config core.hooksPath .githooks
```


## Agenten

Sieben Subagenten unter `.claude/agents/`:

| Agent | Wofür |
|---|---|
| `dms-architekt` | Struktur und Datenmodell gegen das Konzept prüfen, ADRs unter `docs/adr/` schreiben; schreibt nur in `docs/` |
| `dokument-pipeline` | Import, PDF-Rendering, Extraktion, Zuordnung |
| `code-reviewer` | Review nach jeder Änderung, nur lesend |
| `test-writer` | Tests für neue Logik |
| `debugger` | Fehler und rote Tests |
| `dsgvo-pruefer` | Datenschutzprüfung vor Modulen mit Personenbezug, nur lesend |
| `doku-pflege` | Handbuch und CLAUDE.md nach inhaltlichen Änderungen nachziehen |

## Zielplattform und Größenordnung

TypeScript durchgängig. Next.js (App Router) für Viewer, Postfächer und API, dazu ein eigener Worker-Prozess unter `src/worker/` für OCR, Extraktion und Rendering — die langlaufenden Aufgaben gehören nicht in einen Request. Queue ist **pg-boss** in derselben Postgres-Datenbank, keine zweite Infrastruktur. Tests mit **Vitest**.

Datenhaltung: PostgreSQL 16 / Supabase, S3-kompatibler Object Storage mit Object Lock. Migrationen sind **handgeschriebenes DDL** unter `supabase/migrations/`, kein ORM-generiertes Schema — die RLS-Policies und die gemessenen Kommentare aus §21 stehen unverändert im Schema, weil sie die Sicherheitsgrenze bilden.

Zielgröße 500 Objekte, ~25.000 Belege/Jahr. Das Schema wurde gegen 1.000.000 synthetische Dokumente gemessen (Konzept §21) — die dort dokumentierten Messwerte sind die Begründung für mehrere Designentscheidungen und gehören laut §23 als Kommentare in die Migrationen.

## Architektur-Invarianten

Diese Punkte ziehen sich durch das ganze System; ein Verstoß fällt beim Lesen einer einzelnen Datei nicht auf.

**Ein generischer Dokumentenkern.** `dokument` trägt alles Gemeinsame, fachliche Daten liegen in Satellitentabellen (`rechnung_fakten` 1:1, später weitere Belegarten). Kein zweites Modul für Schriftverkehr — ein Posteingang, ein Rechtemodell, ein Audit-Log.

**Stempel sind Ereignisse, Status ist abgeleitet.** `stempel_ereignis` ist append-only mit Hash-Kette (`vorheriger_hash`/`eintrag_hash`). `dokument_lauf.aktuelle_stufe` ist nur Cache. Nie einen Status direkt setzen, ohne das zugehörige Ereignis zu schreiben.

**Der Stempel trägt die Entscheidung, nicht das Ziel.** Wohin ein Beleg nach dem Stempel geht, leitet die Engine aus `prozessdefinition`/`prozessstufe` ab. Kein Zielfeld am Stempeltyp — das war genau der Amagno-Fehler, den das Konzept behebt.

**Das Original wird nie verändert.** Stempel, Notizen, Highlights und Schwärzungen liegen als `dokument_layer` neben dem PDF, nie darin. PDF/A ist ein zusätzliches Derivat (`dokument_datei.variante`), ersetzt das Original nie.

**Zwei getrennte Vertrauenswerte.** `ampel_extraktion` (Minimum der Feld-Confidence) und `ampel_plausibilitaet` (gewichtete Prüfungen) sind fachlich verschieden; `ampel_gesamt` ist der schlechtere Wert. ZUGFeRD/XRechnung setzt die Extraktion per Definition auf 1,0.

**Zwei getrennte Hashes.** `freigabe_hash` = SHA256(kreditor_id, rechnungsnummer, rechnungsdatum, brutto, objekt_id); `kontierungs_hash` über die normalisierten Kontierungszeilen. Getrennt, weil die Kontierung *nach* den Freigaben liegt und sie sonst bei jeder Änderung entwerten würde. Bricht der Freigabe-Hash, schreibt die Engine je Stempel ein Ereignis `verfallen` und springt auf die erste betroffene Stufe zurück.

**Konfiguration statt Code.** Stufenfolgen, Stempeltypen, Ordnungsgruppen, Zahlungswege, Betragsgrenzen und Objekt-Overrides sind Stammdaten. Ein neuer Zahlungsweg oder eine neue Ordnungsgruppe darf **keine** Codeänderung erfordern. `prozessdefinition` wird nie überschrieben, sondern versioniert; `dokument_lauf.definition_version` friert die Fassung für laufende Belege ein.

**Alles ab Rohablage läuft asynchron in einer Queue.** Der KI-Provider steckt hinter einem Interface (Bedrock Frankfurt als Standard, lokales Modell als Fallback). Fällt er aus, startet der Workflow trotzdem und die Erfassung erfolgt manuell.

**Lernen ist strikt mandantenbezogen.** `zuordnungs_merkmal` und `kontierungs_muster` tragen immer `mandant_id`; kein Wissenstransfer über Mandantengrenzen. Deterministische Merkmale (Kundennummer, Zählernummer, IBAN) schlagen immer Embedding-Ähnlichkeit — letztere ergibt nie besser als orange.

**Adapterschicht für Stammdaten und Fremdsysteme.** `externe_id`/`sync_quelle`/`sync_stand` an den Stammdatentabellen sind der Grund, warum dieselbe Codebasis eigenständig und als Modul in einer Verwaltungssoftware laufen kann. Fachlogik nie direkt gegen ein Fremdsystem schreiben.

## Fallen, die nur unter Last sichtbar werden

Gemessen in §21 — beim Entwickeln mit Seed-Daten fällt beides nicht auf:

- **RLS-Policies:** Objektsichtbarkeit über eine `stable security definer`-Funktion auflösen (einmal je Statement, ~2 ms), **nicht** über `exists (select … from objekt_zustaendigkeit …)` je Zeile (Seq Scan, 264 ms bei 1 Mio. Zeilen). Die falsche Variante gehört als auskommentierte Warnung ins Schema.
- **`security definer` verhindert Inlining.** Sortierung und `limit` müssen *innerhalb* der Funktion stehen, sonst materialisiert der Planer erst alle Treffer.
- **Objektübergreifende Listen** brauchen LATERAL mit Top-N je Objekt (13 ms), nicht `objekt_id = any(array) order by … limit` (64 ms).
- **Ein zusätzlicher Index kann schaden:** ein Index auf `eingang_am` allein verschlechterte den Feed von 13 auf 30 ms. Der zusammengesetzte Index `(objekt_id, eingang_am desc)` genügt.
- **`dokument.hat_umlagefaehige_zeile`** ist bewusst denormalisiert (Trigger aus der Kontierung) — ersetzt bei jedem Belegaufruf eines Mieters einen Semi-Join über eine Million Kontierungszeilen (48,6 ms → 11,9 ms).

## Regeln, die nicht verletzt werden dürfen

- **Summenzwang:** Σ `kontierung.betrag_brutto` = `rechnung_fakten.brutto`. Verletzung blockiert die Kontierungsstufe. Die Prüfung läuft über die Kontierung, **nicht** über die Zahlungszeilen — sonst verletzt der Eigenanteil bei Selbstbeteiligung sie.
- **Harte Sperre vor der Zahlung:** jede Pflichtstufe braucht einen gültigen Stempel, Bankdaten müssen vollständig sein.
- **Harte Rot-Fälle:** IBAN passt nicht zum bekannten Kreditor (Betrugsschutz) und Dublette (Kreditor + Rechnungsnummer + Betrag). Beide stoppen die Bearbeitung, sie färben nicht nur.
- **Nie löschen:** Ordnungsgruppen nur deaktivieren; abgelehnte Belege bleiben im Status `abgelehnt` und werden archiviert, die Ersatzrechnung ist ein neues Dokument, verkettet über `ersetzt`. Nach Archivierung nur Storno + Neuerfassung.
- **Klärung:** `kommentar` und `wiedervorlage_am` sind Pflicht, sonst kein Eintritt. Stempel bleiben gültig, Stufe wird gemerkt.
- **Mietersicht wird gerechnet, nicht freigegeben:** umlagefähige Kontierungszeile **und** Überschneidung von Leistungszeitraum und `person_bezug`-Mietzeit. Keine manuelle Belegfreigabe einbauen — sie übersieht Mieterwechsel.
- **DSGVO gegen GoBD:** Löschansprüche an aufbewahrungspflichtigen Belegen führen zur Einschränkung der Verarbeitung (Kennzeichnung, Entzug aller Leserechte), nicht zur Löschung.
- **Vertretung überträgt keine Rechte** — die Aufgabe wandert über die Eskalation, die Rolle bleibt.

## Umsetzungsreihenfolge

Das Konzept (§23) schreibt einen dünnen Schnitt durch alles vor, nicht Schicht für Schicht: Migrationen + Seed + **RLS-Tests ab Tag eins** → Ingest (Hash, Dublette, Textlayer/OCR, Seitentext, WebP) → Viewer (erste Seite < 100 ms, PDF nur per Range-Request) → Workflow-Engine (eine Belegart, eine Kette, keine Bedingungen) → Postfächer (alle drei nur Sichten auf `aufgabe`) → dann in die Breite.

§24 listet die offenen Punkte. Zwei davon sind nachträglich teuer und sollten vor größerem Ingest-Code bedacht werden: **Stapelscan mit Belegtrennung** (eine Scandatei enthält zwanzig Belege) und **Vorlagen für Ausgangspost** (die Systemaktionen sind vorgesehen, die Vorlagenverwaltung fehlt).
