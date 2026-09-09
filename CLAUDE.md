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
npm run e2e                  # Ende-zu-Ende im Browser (setzt die DB zurück!)
npm run e2e:ui               # dasselbe mit Playwrights Oberfläche
npm run lint                 # ESLint (~30 s, typbezogene Regeln)
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

Objektspeicher fuer die Entwicklung (MinIO im Container). Nur damit greift die Objektsperre; ohne ihn laeuft alles weiter, aber ungeschuetzt:

```bash
npm run speicher:start       # MinIO auf 9000, Oberflaeche auf 9001
npm run speicher:stop        # Container entfernen
```

Der Eimer muss **mit** Object Lock angelegt werden — nachtraeglich einschalten geht nicht. Die Tests legen sich je Lauf einen eigenen an; fehlt MinIO, ueberspringen sie die S3-Haelfte und sagen das.

Dokumentation:

```bash
npm run docs:stand           # docs/stand.md aus dem Repository neu erzeugen
npm run docs:check           # prüfen, ob die Dokumentation zum Code passt
```

Verfahrensdokumentation (GoBD, Konzept §24.4) — der Text wird aus dem Repository abgeleitet, die Freigabe ist eine eigene Handlung:

```bash
npm run verfahrensdoku                                    # docs/verfahrensdokumentation.md neu erzeugen
DMS_BENUTZER_FREIGABE=<kennung> npm run verfahrensdoku:freigeben [gueltig-ab]
```

Freigeben legt den heutigen Stand mit seinem Hash in der Ablage ab; ab dem Gültigkeitstag trägt jeder archivierte Beleg diese Versionsnummer. Ein **veralteter** Stand wird abgewiesen — eine Fassung, die ein anderes Verfahren beschreibt als das laufende, ist schlimmer als gar keine. Der organisatorische Teil steht von Hand in `docs/verfahrensdoku-organisation.md`; fehlt er, weist das erzeugte Dokument die Lücke aus.

Oberfläche ansehen und prüfen:

```bash
npm run vorschau             # Anwendung mit Entwicklungsanmeldung auf 3000
npm run bilder               # Bestandsaufnahme: jede Seite als Bild, 1280 und 1920
```

**`vorschau` schließt eine Lücke, die lange offen war.** `DMS_ANMELDUNG=entwicklung` stand nur in `playwright.config.ts` — die Oberfläche war also ausschließlich *während eines E2E-Laufs* erreichbar; wer `npm run dev` startete, kam an der Anmeldung nicht vorbei. Ein npm-Skript kann die Variable nicht portabel setzen (npm führt Skripte unter Windows über `cmd` aus), deshalb [scripts/vorschau.mjs](scripts/vorschau.mjs). Ein Weg an Entra vorbei entsteht dadurch nicht: Die Entwicklungsanmeldung verlangt zusätzlich `NODE_ENV != production`, und das Skript startet ausschließlich `next dev`.

**Barrierefreiheit ist gemessen, nicht beurteilt** ([e2e/barrierefreiheit.spec.ts](e2e/barrierefreiheit.spec.ts)). `axe-core` prüft zwölf Seiten gegen WCAG 2.1 AA; die Schwelle sind `serious` und `critical` — eine Schwelle, die alles einschließt, wird nach zwei Wochen hochgesetzt und ist dann keine mehr. Der erste Lauf fand zwei Klassen: `#777` auf Weiß mit 4,47:1 (knapp unter 4,5) und — der wichtigere — ein `aria-label` auf einem `span` ohne Rolle. Letzteres ist kein Schönheitsfehler: Ein Vorleseprogramm **ignoriert** das Label dann, und die Ampel ist reine Farbe. Sie trägt jetzt `role="img"`.

**Die Bestandsaufnahme ist ein Werkzeug, kein Test.** Sie behauptet nichts und schlägt nicht fehl, sie nimmt auf — deshalb trägt sie die Marke `@bilder` und läuft bei `npm run e2e` **nicht** mit (`--grep-invert @bilder`). Die Bilder landen unter `bilder/` und sind nicht versioniert.


Berechtigungs-Presets für die Ersteinrichtung (Konzept §24.13):

```bash
npm run einrichten                        # zeigt die drei Zuschnitte
npm run einrichten -- <mandant-id> weg    # anwenden (weg | miet | se)
```

**Warum als Skript.** Presets sollen die Ersteinrichtung tragen — aber sie anzuwenden verlangt `benutzer_verwalten`, und dieses Recht entsteht erst durch das Preset. Diese Henne fängt das Skript ein: Es läuft als Eigentümer der Tabellen, außerhalb der RLS, wie Migration und Seed. Ein Haus, das schon Benutzer hat, richtet man über die Oberfläche ein (*Benutzer und Rollen*) — dort greift die Policy.


Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO, Konzept §24.5) — der technische Teil wird abgeleitet, der rechtliche steht von Hand in `docs/verzeichnis-organisation.md`:

```bash
npm run verzeichnis          # docs/verzeichnis.md neu erzeugen
```

**Der Ertrag ist nicht der Text, sondern die Vollständigkeitsprüfung.** Der Erzeuger liest die `create table`-Anweisungen der Migrationen und vergleicht sie mit der Einordnung in [scripts/verzeichnis-daten.mjs](scripts/verzeichnis-daten.mjs): Jede Tabelle gehört genau **einer** Verarbeitungstätigkeit — oder mit Begründung in die Liste `OHNE_PERSONENBEZUG`. Fehlt eine, bricht der Lauf mit Rückgabewert 1 ab, und `npm run docs:check` meldet sie. **Wer eine neue Tabelle anlegt, ordnet sie ein** — sonst ist das Verzeichnis unvollständig, und das fällt sonst erst auf, wenn eine Aufsichtsbehörde fragt.

Eine Heuristik über Spaltennamen wäre bequemer und wäre falsch: Ob eine Spalte Personenbezug trägt, ist eine fachliche Beurteilung. Abgeleitet wird die *Vollständigkeit*, nicht die *Einordnung*.


Sicherung und Restore-Probe (GoBD, Konzept §24.7) — die Probe ist Teil des Verfahrens, nicht ein Zusatz:

```bash
DMS_PG_CONTAINER=supabase_db_DMS npm run sicherung [ziel]         # Abbild + Manifest
DMS_PG_CONTAINER=supabase_db_DMS npm run sicherung:pruefen -- <ziel>
```

Gesichert werden nur die Schemata `public` und `app` — ohne diese Einschränkung kamen 119 folgenlose Fehler aus den internen Schemata der lokalen Supabase-Instanz, und in solchem Rauschen liest niemand mehr die eine Zeile, die etwas bedeutet. `DMS_PG_CONTAINER` braucht nur, wer kein `pg_dump` auf dem Rechner hat.

Die Probe holt in eine eigene, danach verworfene Datenbank zurück und prüft, was ein erfolgreicher `pg_restore` **nicht** beantwortet: Zeilenzahlen gegen das Manifest, Hash-Kette, RLS und Trigger, Dateien gegen ihre Archivhashes. Findet sie nichts vor, sagt sie das — statt Entwarnung zu geben.

Objektakte für den Verwalterwechsel (Konzept §19) — läuft unter der Kennung eines Benutzers und damit unter dessen Rechten:

```bash
DMS_BENUTZER_EXPORT=<kennung> npm run objektakte -- <objektnummer> [ziel]
```

Betrieb (ADR 0007) — Produktion läuft als `docker compose` mit vier Containern: Datenbank, Web, Worker, Reverse Proxy. Web und Worker teilen sich **ein** Image und unterscheiden sich nur im Startbefehl:

```bash
cp .env.beispiel .env          # ausfüllen, danach chmod 600 .env
DMS_FASSUNG=$(git rev-parse --short HEAD) docker compose up -d --build
docker compose logs -f worker
npm run betrieb:pruefen        # laufen die Hintergrunddienste noch?
```

**Migrationen laufen nie beim Start**, sondern von Hand über einen SSH-Tunnel (`supabase db push --db-url …`). Zwei startende Container würden dieselbe Migration nebenläufig anwenden, und eine fehlerhafte liefe nachts um drei ohne jemanden, der zusieht.

Der Worker ist mehr als die Warteschlangen: An ihm hängen die Objektsperre, das Abräumen gelöschter Dateien und die Sammelmail. **Stirbt er, hört das System still auf zu sperren, zu löschen und zu benachrichtigen** — die Oberfläche sieht dabei normal aus. Deshalb trägt er im Minutentakt ein Lebenszeichen ein, und es gibt drei Blickwinkel darauf: `/api/lebenszeichen` (System, für Überwachung und Menschen), `/api/lebenszeichen?dienste=` (nur Anwendung und Datenbank, für den Web-Container) und `npm run betrieb:pruefen` (der Worker prüft sich selbst). Ohne diese Trennung startete Docker bei totem Worker die Anwendung neu — den einen Prozess, der nichts dafür kann. Ein Dienst, der **nie** eingetragen hat, gilt als verstummt und nicht als unauffällig.

`npm run dev` startet zwei Prozesse: die Next.js-Anwendung und den Worker. Einzeln laufen sie über `npm run dev:web` und `npm run dev:worker` — nützlich, wenn nur an der Pipeline gearbeitet wird.

**Zwei Testarten mit verschiedenen Aufgaben.** `tests/` prüft **Regeln** — RLS, Summenzwang, Hash-Kette — gegen die Datenbank, im Rollback, schnell. `e2e/` prüft **die Kette**: dass Anmeldung, Sitzung, RLS, Engine, Server-Aktion und Umleitung zusammen tragen. Deshalb dort wenige Tests, und jeder geht einen ganzen Weg. Eine Zusicherung über eine Policy gehört **nie** in einen Browsertest — sie lässt sich an einer Oberfläche nicht beweisen.

`npm run e2e` **setzt die Datenbank zurück** (`globalSetup`), hängt zwei Seed-Belegen echte PDFs an und startet den **Worker** — ohne ihn bliebe ein hochgeladener Beleg für immer in `in_aufbereitung`. Der Worker gehört *nicht* in `webServer`: Er hat keine Adresse, und mit dem Datenbankport als Kennzeichen hielt Playwright ihn für längst laufend und startete ihn nie.

**Danach ist die Datenbank verändert.** Vor `npm test` gehört ein `npm run db:reset` — sonst scheitern die Tests, die Belege im Mandanten zählen (Mietersicht). Umgekehrt ist es egal: E2E setzt selbst zurück.

**Jede E2E-Datei, die einen Beleg verändert, braucht ihren eigenen.** Alle teilen sich eine Datenbank, die nur einmal vor dem Lauf zurückgesetzt wird — wer denselben Beleg anfasst, hängt an der Dateireihenfolge. `stempeln.spec.ts` fährt `RE-2026-0001`, `zahlung.spec.ts` fährt `RE-2026-0004` (dessen Lauf das Fixture startet).

`npm run e2e` **setzt die Datenbank zurück** (`globalSetup`), weil Stempeln unumkehrbar ist und es über HTTP keinen Rollback gibt. Eigener Port 3100, damit ein nebenher laufender Entwicklungsserver nicht mitgetestet wird; eigene Ablage `.ablage-e2e`. Bewusst **ohne** `DMS_OCR`, `SMTP_URL` und `DMS_EXTRAKTION` — der Test soll die Anwendung sehen, wie sie frisch installiert ist. Selektoren gehen über Rolle und deutschen Sichttext, nicht über `data-testid`: Das prüft die Beschriftung gleich mit.

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

**`npm run lint`** ist eingerichtet und läuft sauber durch ([ADR 0005](docs/adr/0005-linter.md)). Der Ertrag sind drei Regeln mit Typwissen — `no-floating-promises`, `no-misused-promises`, `await-thenable`: In einer durchgängig `async`-Codebasis schreibt ein vergessenes `await` trotzdem, nur nicht in der Transaktion, in der es sollte. Dafür ist **TypeScript auf 6.x festgelegt**; `typescript-eslint` lehnt TS 7 rundheraus ab. Wer die Fassung anhebt, bricht den Linter — Bedingungen zum Zurücknehmen stehen im ADR. `require-await` und `no-img-element` sind mit Begründung aus. Der Linter steht **nicht** im Commit-Hook: 31 Sekunden gegen 2 der Dokumentationsprüfung, das erzieht zu `--no-verify`.

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

**Der generische Kern ist geprüft, nicht mehr behauptet.** Schriftverkehr ist seit §24.3 die zweite Belegart: eigene Faktentabelle (`schriftverkehr_fakten`), eigene Stufenfolge — und die steht als **Konfiguration** im Seed, kein Codepfad kennt sie. Getragen hat der Kern mehr als erwartet (`belegart` kannte den Wert schon, die Engine wählt über `p.belegart = d.belegart`, alle Joins auf `rechnung_fakten` sind `left join`). **Nicht getragen hat `app.freigabe_hash`:** ein *innerer* Verbund auf `rechnung_fakten`, also `null` für jede andere Belegart — ein Freigabestempel mit leerem Hash hängt an nichts, und der Beleg hätte das Objekt wechseln können, ohne dass eine Freigabe verfällt. Jetzt `left join`, und die neuen Felder sind **hinten angehängt**: Für eine Rechnung bleibt die Zeichenkette identisch, sonst hätte die Migration jede bestehende Freigabe im System entwertet. Ein Test nagelt das fest.

**Wie ein Beleg heißt, steht an einer Stelle** ([`belegBezeichnung`](src/app/lib/darstellung.tsx)). Vorher bauten fünf Anzeigestellen den Titel aus Kreditor und Rechnungsnummer — mit der zweiten Belegart hätte jedes Schriftstück „Ohne Kreditor" geheißen. Wer eine sechste baut, nimmt den Helfer.

**Stempel sind Ereignisse, Status ist abgeleitet.** `stempel_ereignis` ist append-only mit Hash-Kette (`vorheriger_hash`/`eintrag_hash`). `dokument_lauf.aktuelle_stufe` ist nur Cache. Nie einen Status direkt setzen, ohne das zugehörige Ereignis zu schreiben.

**Der Stempel trägt die Entscheidung, nicht das Ziel.** Wohin ein Beleg nach dem Stempel geht, leitet die Engine aus `prozessdefinition`/`prozessstufe` ab. Kein Zielfeld am Stempeltyp — das war genau der Amagno-Fehler, den das Konzept behebt.

**Object Lock schützt Fassungen, nicht Schlüssel.** [ADR 0006](docs/adr/0006-objektsperre.md), gegen MinIO gemessen und nicht angenommen: Eine gesperrte Datei lässt sich **überschreiben** — es entsteht eine zweite Fassung, und ein gewöhnliches Lesen liefert ab dann diese. Die gesperrte bleibt unzerstörbar daneben liegen. Die Zusage lautet also *Erhalt*, nicht *Abweisung*, und sie ist erst dann etwas wert, wenn `archiv_eintrag.storage_fassung` festgehalten und bei **jedem** Lesen des Originals mitgegeben wird (`Ablage.lesen(schluessel, fassung)`). Wer eine neue Lesestelle für das Original baut und die Fassung wegläßt, hebt den Schutz für diesen Weg auf — im Normalfall unbemerkt, und genau im einen Fall, auf den es ankommt, falsch. Deshalb liefern die Abfragen, die den Ablageschlüssel holen, die Fassung gleich mit.

**Gesperrt wird nach dem Archivieren, nie in derselben Transaktion.** Compliance-Sperren nimmt niemand zurück, auch der Wurzelbenutzer nicht — eine Sperre für eine zurückgerollte Archivierung wäre ein Fehler, den nie jemand behebt. Eine fehlende Sperre bleibt dagegen als leere Spalte sichtbar. Der Archiveintrag **ist** die Warteschlange (`storage_object_lock_bis is null` = offen), kein pg-boss-Auftrag: dasselbe Muster wie das Ausgangsbuch, aus demselben Grund. Reihenfolge im Durchgang: erst sperren, dann `app.objektsperre_vermerken` — andersherum entstünde ein Vermerk über einen Schutz, den es nicht gibt. Beide Spalten sind **einmal setzbar**, nie änderbar (Trigger).

**Die dritte Säule ist die Verfahrensdokumentation.** Hash-Kette und Objektsperre belegen, dass ein Beleg seit dem Archivieren derselbe ist — nicht, **nach welchem Verfahren** er dorthin kam. Ohne diesen Nachweis wird die Archivierung im Prüfungsfall nicht anerkannt, egal wie gut die ersten beiden sind. Der Text wird erzeugt ([`scripts/verfahrensdoku-erzeugen.mjs`](scripts/verfahrensdoku-erzeugen.mjs)), weil eine handgepflegte Beschreibung eines sich wöchentlich ändernden Systems nach einem Monat eine Erzählung ist; belegt wird die Wirksamkeit durch die **Testnamen** — der Testname *ist* die Zusicherung. `archiv_eintrag.verfahrensdoku_version` wird beim Archivieren **abgeleitet**, nie vom Aufrufer entgegengenommen: Eine mitgegebene Fassung wäre eine Behauptung. Fehlt eine Fassung, bleibt die Spalte leer und der Beleg steht in `app.archiv_ohne_verfahrensdoku()` — das Archivieren daran scheitern zu lassen hielte den Betrieb wegen einer Dokumentationslücke an, die dadurch nicht kleiner wird.

**Ein Hash über `::text` hängt an der Serverkonfiguration.** `app.stempel_kette` rechnet über `zeitpunkt::text`, und dessen Darstellung folgt `TimeZone` und `DateStyle` der Sitzung. Gemessen: Alle bestehenden Einträge stimmten unter `UTC` und **keiner** unter `Europe/Berlin` — ein Restore auf einen deutsch eingestellten Server hätte die gesamte Kette gebrochen aussehen lassen. Beide Einstellungen sind deshalb an `app.stempel_kette`, `app.freigabe_hash` und `app.kette_pruefen` **festgenagelt** (`set timezone`, `set datestyle`); für die bestehenden Hashes ändert sich dadurch nichts, weil sie unter genau diesen Werten entstanden sind. Wer eine neue Funktion schreibt, die etwas hasht, nagelt sie ebenso fest — sonst hängt ein Nachweis an einer Einstellung, die niemand mitsichert.

**Eine Prüfung, die nichts vorfindet, gibt keine Entwarnung.** `sicherung:pruefen` sagt ausdrücklich, wenn es keine Stempelereignisse und keine Archiveinträge zu prüfen gab. Der erste Entwurf meldete „Die Sicherung trägt", nachdem er null Zeilen angesehen und 119 Restore-Fehler als „Hinweis" abgetan hatte. Dieselbe Regel gilt für die S3-Tests (`ablage-s3`, `objektsperre`): Fehlt MinIO, wird das gemeldet, nicht übersprungen.

**Das Original wird nie verändert.** Stempel, Notizen, Highlights und Schwärzungen liegen als `dokument_layer` neben dem PDF, nie darin. PDF/A ist ein zusätzliches Derivat (`dokument_datei.variante`), ersetzt das Original nie.

**Ein Stempel-Layer entsteht aus seinem Ereignis, nie aus der Anwendung.** Trigger `stempel_ereignis_layer`; `verfallen` blendet den zugehörigen Layer aus, statt einen neuen zu schreiben. Die Plätze rechnet der Worker **einmal** bei der Aufbereitung (`freieBloecke` → `dokument_seite.freie_bloecke`) — gespeichert wird das Ergebnis, nicht die Fundstellen, sonst wären es bei einer Million Dokumenten zweistellige Gigabytes. Kein Stempel überdeckt Text; ist die Seite voll, bekommt der Layer `seite = 0` (gehört auf eine Leerseite) statt zu verschwinden. Layer werden **ausgeblendet, nie geändert oder gelöscht** (Trigger `dokument_layer_unveraenderlich`).

**Vier Exportvarianten, eine Regel** ([`src/export/varianten.ts`](src/export/varianten.ts)): `archiv` gibt das Original **Byte für Byte** heraus — kein Neuschreiben, kein Wasserzeichen, sonst stimmt der Archivhash nicht mehr. `stempel`, `extern` und `intern` zeichnen Layer ein. **Hat der Beleg Schwärzungen, wird jede Variante außer `archiv` aus den Seitenbildern gebaut** — auch `stempel`, das Schwärzungen gar nicht zeigt; sonst gäbe es einen Klick-Weg zu einem PDF mit dem Geschwärzten im Klartext. Fehlen die Seitenbilder, gibt es **keinen** Export statt eines unsicheren. Die Objektakte legt `<id>.pdf` (Original, mit dem Archivhash) und `<id>-gestempelt.pdf` (Lesefassung) nebeneinander; fehlt Letztere, steht der Beleg in `ohneLesefassung` und im Manifestkopf.

**Eine Schwärzung geht ins Bild, nicht ins PDF.** Ein schwarzes Rechteck in einem PDF verdeckt den Text nur optisch — er bleibt markierbar. Deshalb: extern wird in das gerenderte WebP eingebrannt (`layerEinbrennen`, vor dem Wasserzeichen), und `app.hat_schwaerzung` sperrt den externen PDF-Download. Sind die Seitenmaße unbekannt, geht ein geschwärzter Beleg **gar nicht** hinaus. Intern ist es eine CSS-Überlagerung in Prozent — Pixel würden beim Skalieren verrutschen, und eine verrutschte Schwärzung verdeckt das Falsche.

**In der externen Einsicht gibt es keinen Benutzer.** Jede Abfrage dort läuft durch eine `security definer`-Funktion mit eigener Prüfung, und zusammengehörige Angaben gehören in **eine** Funktion. Zwei Aufrufe sind zwei Gelegenheiten, den zweiten zu vergessen — genau so lieferte erst `einsicht_datei` ein leeres Bild und später `einsicht_layer` die Seitenbreite 0, was jede Schwärzung an die falsche Stelle gesetzt hätte.

**Zwei getrennte Vertrauenswerte.** `ampel_extraktion` (Minimum der Feld-Confidence) und `ampel_plausibilitaet` (gewichtete Prüfungen) sind fachlich verschieden; `ampel_gesamt` ist der schlechtere Wert. ZUGFeRD/XRechnung setzt die Extraktion per Definition auf 1,0.

**Zwei getrennte Hashes.** `freigabe_hash` = SHA256(kreditor_id, rechnungsnummer, rechnungsdatum, brutto, objekt_id); `kontierungs_hash` über die normalisierten Kontierungszeilen. Getrennt, weil die Kontierung *nach* den Freigaben liegt und sie sonst bei jeder Änderung entwerten würde. Bricht der Freigabe-Hash, schreibt die Engine je Stempel ein Ereignis `verfallen` und springt auf die erste betroffene Stufe zurück.

**Eine Kennzahl wird geglaubt.** Deshalb laufen die Auswertungen (§24.11) **ohne** `security definer`, anders als `app.loeschkandidaten` oder `app.objektsperre_offen` — eine Auswertung ist eine Sicht auf Belege, und wer einen Beleg nicht sehen darf, darf ihn auch nicht in einer Summe wiederfinden; aus einer Kennzahl lässt sich zurückrechnen. Die RLS ist damit der Mandantenfilter, an einer Stelle statt in vier Abfragen. Gemessen ([docs/messungen.md](docs/messungen.md)): Der Vorgabezeitraum der Durchlaufzeiten ist **90 Tage**, weil der unbegrenzte Lauf dreimal so teuer ist und auf die Platte geht — `src/auswertung` kann ihn gar nicht stellen, `null` fällt dort ebenfalls auf 90 Tage zurück. Ein Index auf `stempel_ereignis (zeitpunkt)` wurde geprüft und **verworfen** (665 → 742 ms im unbegrenzten Fall).

**Konfiguration statt Code.** Stufenfolgen, Stempeltypen, Ordnungsgruppen, Zahlungswege, Betragsgrenzen und Objekt-Overrides sind Stammdaten. Ein neuer Zahlungsweg oder eine neue Ordnungsgruppe darf **keine** Codeänderung erfordern. `prozessdefinition` wird nie überschrieben, sondern versioniert; `dokument_lauf.definition_version` friert die Fassung für laufende Belege ein.

**Lesen und Schreiben sind verschiedene Rechte.** Bis §24 waren die Policies der Stammdatentabellen `for all` mit reinem Mandantenfilter — nachgestellt: Eine Objektbearbeiterin konnte sich selbst die Geschäftsleitungsrolle zuweisen (`app.darf` sprang von `false` auf `true`), eine IBAN verifizieren und andere Benutzer sperren. Seit [20260903100000](supabase/migrations/20260903100000_stammdaten_rechte.sql) gibt es je Tabelle eine **Lesepolicy** (Bedingung unverändert) und eine **Schreibpolicy** über `app.darf_stammdaten()` bzw. `app.darf_benutzer()`. Beide getrennt, weil `benutzer_verwalten` das Recht ist, aus dem alle anderen folgen: Wer Rollen vergibt, gibt sich jedes weitere selbst. Wer eine neue Stammdatentabelle anlegt, legt **beide** Policies an — eine einzelne `for all` ist die Lücke.

**Ein Preset ist ein Startwert, keine Bindung** ([src/stammdaten/presets.ts](src/stammdaten/presets.ts)). Nach dem Anwenden stehen gewöhnliche Zeilen in `rolle`, `rolle_recht` und `stempel_recht` — und nichts verweist zurück. Bewusst **keine** `preset_id` an der Rolle: Sie behauptete eine Herkunft ohne Wirkung, und „warum darf diese Rolle das" wäre plötzlich an zwei Stellen zu beantworten. Presets stehen im Quelltext und nicht in einer Tabelle, weil eine Preset-Tabelle mandantenübergreifend wäre — die erste ohne Mandantenfilter. **Es wird nur ergänzt, nie überschrieben:** Eine Rolle mit demselben Kurzcode bleibt unverändert, Rechte kommen hinzu; zweimal anwenden ist wie einmal. Die Idempotenz steht dabei als `where not exists` und **nicht** als `on conflict` — der eindeutige Index auf `rolle_recht` schließt `belegart` und `ordnungsgruppe_id` ein, beide sind `null`, und `null` ist von `null` verschieden; `stempel_recht` hat überhaupt keine Eindeutigkeit. Fehlende Stempeltypen werden **gemeldet, nicht angelegt** — Stempeltypen zu erfinden ist Ablaufkonfiguration und verlangt ein anderes Recht.


**Wer den Ablauf ändert, ändert wer entscheiden darf** ([20260909100000](supabase/migrations/20260909100000_konfigurationsrechte.sql)). Beim Bau der Berechtigungs-Presets nachgestellt: Anna (Objektbearbeitung, keine Verwaltungsrechte) konnte `insert into stempel_recht` ausführen und ihrer eigenen Rolle den Freigabestempel der Geschäftsleitung zuweisen — danach erzeugt sie die Freigaben selbst, die `app.zahlung_moeglich()` verlangt. Ebenso gelangen `insert into stempeltyp` und `insert into gruppe` (über `stempel_recht.gruppe_id` derselbe Weg ein zweites Mal). Dieselbe Klasse wie bei den Stammdaten, nur eine Migration später gefunden: eine einzelne `for all`-Policy mit reinem Mandantenfilter. Jetzt getrennt nach zwei Fragen — **`benutzer_verwalten`** für *wer darf was* (`stempel_recht`, `gruppe`, `gruppe_mitglied`) und **`prozess_konfigurieren`** für *welcher Ablauf gilt* (`stempeltyp`, alle `prozess*`). Das zweite Recht gab es seit dem Rollenmodell; es stand nur in keiner Policy. **Lesen bleibt offen** — wer einen Beleg bearbeitet, hat Grund nachzusehen, wer die nächste Stufe stempeln darf. Wer eine neue Konfigurationstabelle anlegt, legt **beide** Policies an.


**Eine Policy weist nicht ab, sie lässt die Zeile verschwinden.** Ein `update` ohne Recht meldet Erfolg mit **null Zeilen**. Deshalb prüft [`mussGewirktHaben`](src/stammdaten/index.ts) die betroffenen Zeilen und nicht das Ausbleiben eines Fehlers — und deshalb zählt jeder Test hier die Wirkung. Beim Messen bin ich selbst darauf hereingefallen und hielt „kein Fehler" für „gelungen".

**Der Notfallzugriff erweitert die Reichweite, nie die Art** (§24.10, [Migration 20260908100000](supabase/migrations/20260908100000_notfallzugriff.sql)). Fällt der einzige Zuständige aus, sieht niemand sonst dessen Belege — Skonti verfallen still. Der naheliegende Griff wäre, der Vertretung schnell eine `benutzer_rolle_objekt`-Zeile anzulegen; danach stünde dort eine Zuständigkeit, die es fachlich nie gab, und sie bliebe liegen. Stattdessen ein eigener, **befristeter** Eintrag (Pflichtgrund, höchstens 14 Tage, genau **ein** Objekt — ein Generalschlüssel wird angelegt und vergessen). Er hängt sich an **einer** Stelle ein, `app.meine_objekte()`, und wirkt dadurch in jeder objektbezogenen Policy; in `app.darf()` gilt er nur für Rechte, die die Person **anderswo schon hat**. Wer nie kontieren durfte, kontiert auch im Notfall nicht. `stammdaten_pflegen`, `benutzer_verwalten`, `prozess_konfigurieren` und `notfallzugriff` selbst sind ausgenommen — wer die im Notfall bekäme, gäbe sich dauerhaft alles. **Vier Augen nachträglich statt vorher:** Eine Freigabe durch einen Zweiten wäre genau dann nicht zu bekommen, wenn es darauf ankommt; an ihrer Stelle steht Sichtbarkeit — das Band über jeder Seite und `/notfall` für den ganzen Mandanten. Bewusst **kein** Protokoll jedes Belegaufrufs: Das wäre ein zweites, ständig wachsendes Verzeichnis darüber, wer was gelesen hat. Der Zugriff selbst ist der Nachweis.

**Rechte sind additiv, nie subtraktiv.** `app.darf()` bildet die Vereinigung über alle Rollen eines Benutzers; eine zweite Rolle kann ein Recht nur hinzufügen, nie entziehen. Verbotsregeln würden das Rechtemodell unprüfbar machen — „warum durfte er das nicht" wäre nicht mehr an einer Stelle zu beantworten. Sichtbarkeit auf ein Objekt entsteht aus zwei unabhängigen, datierten Quellen: `objekt_zustaendigkeit` und `benutzer_rolle_objekt` (mit `objekt_id is null` = mandantenweit).

**Nebenläufe sind keine Sonderprogramme.** Versicherung und Technik (§10, §11) sind `prozessdefinition` mit eigenem Einstieg — Selbstzahlung gegen Abtretung, Wartung gegen Reparatur gegen Erneuerung gehören in die Einstellungen. Im Code stehen nur die beiden Mechanismen, die das Konzept als Tabellen nennt: `wartecontainer` (Lauf im Zustand `wartend`, Wiedervorlage **Pflicht** und in der Zukunft, Schließen nur mit Ergebnis; der Lauf läuft erst weiter, wenn der *letzte* Container zu ist) und `bauteil` (Gewährleistung mit **Stichtag**, nicht `current_date` — die Frage gilt dem Schadenszeitpunkt; Erneuerung legt still und verkettet über `ersetzt_bauteil_id`, sie löscht nicht). Wer hier `versicherungsfallBearbeiten` schreibt, hat den ersten Satz von §10 überlesen.

**Ein Stapel ist kein Dokument.** §24.1: „Nachträglich unangenehm, weil Seiten und Hashes dann schon geschrieben sind." Eine Scandatei wird `stapel` + `stapel_seite` und durchläuft `aufbereitung → pruefung → uebernommen`; **erst beim Übernehmen** entstehen Dokumente, je Beleg mit eigener PDF und eigenem Hash. Die Belegnummern ergeben sich aus den Trennblättern (`app.stapel_gruppieren`, `dense_rank` über die Nicht-Trenner — sonst entsteht ein Phantom-Beleg 1). Die Korrekturoberfläche ist Teil des Entwurfs, nicht ein Zugeständnis: Ein falsch getrennter Stapel erzeugt zwanzig falsche Belege auf einmal.

**PDF-Verarbeitung gehört nie in einen Request.** `src/ingest/pdf.ts` lädt seine Schriftmetriken über eine `file://`-URL aus `node_modules`; sobald das Modul in eine Server Component gerät, bricht der Bundler ab. Der Fehler ist ein Hinweis auf die Regel, nicht ihr Gegenteil — lesen und rendern läuft im Worker (`stapel-aufbereiten`, eigene Warteschlange, damit ein Stapel keinen frischen Beleg aufhält).

**Alles ab Rohablage läuft asynchron in einer Queue.** Der KI-Provider steckt hinter einem Interface (Bedrock Frankfurt als Standard, lokales Modell als Fallback). Fällt er aus, startet der Workflow trotzdem und die Erfassung erfolgt manuell.

**Eine Eingangsquelle liefert Bytes, sonst nichts.** Überwachter Ordner und Mailpostfach (`eingangsquelle`, Stammdatum) gehen durch **denselben** `dokumentAufnehmen` wie ein Upload — Hash, Dublettenprüfung, Warteschlange sind für alle dieselben; ein zweiter Eingangsweg liefe früher oder später auseinander. Aufnehmen und Vormerken (`eingang_geholt`) liegen in **einer** Transaktion: sonst kommt ein Beleg zweimal herein oder geht ganz verloren. Der Filter *in* der Quelle ist eine Beschleunigung, die Richtigkeit hängt an der Prüfung in der Schleife — der IMAP-Teil filtert nach `Message-Id`, vermerkt wird `Message-Id#Anhangsname`. **Kein Passwort in der Datenbank:** `einstellungen` trägt den *Namen* einer Umgebungsvariablen. Eine Quelle arbeitet unter den Rechten ihres Einrichters (`angelegt_von`), nicht unter einem technischen Konto — ist der gesperrt, steht sie sichtbar still. Aufgeräumt wird **nach** dem Aufnehmen; wer zuerst verschiebt, verliert die Datei beim Fehlschlag.

**Kein Text, keine Erkennung — aber nie stillschweigend.** `hatTextlayer` entscheidet je Dokument, nicht je Seite. Ohne Textlayer läuft die Texterkennung hinter `Texterkennung` (`DMS_OCR`, Vorgabe `keine`, ocrmypdf im Worker). Die Entscheidung fällt **vor** `dokument_seite`, Rendern und Extraktion — der Seitentext trägt alles dahinter. Ist keine Erkennung eingerichtet oder das Werkzeug nicht aufrufbar, wird **gemeldet** (`app.verarbeitungsfehler_melden`, in derselben Transaktion) statt geworfen: Tesseract installiert sich nicht durch einen zweiten Versuch. Scheitert eine eingerichtete Erkennung, wird geworfen — dann ist die Queue zuständig. Das Ergebnis ist ein `pdfa_derivat`, das Original bleibt unberührt; kein `--deskew`/`--rotate-pages`, sonst passen Vorschau und PDF nicht mehr übereinander.

**Ein aufgegebener Auftrag wird ein fachlicher Vorgang.** pg-boss behält die Wiederholungslogik (`retryLimit: 3`, `deadLetter`), aber der Korb selbst ist `verarbeitungsfehler` — mit `mandant_id`, RLS und einem Ausgang, den ein Mensch wählt (`wiederholt` / `manuell` / `verworfen`). Nie eine Oberfläche direkt auf die pg-boss-Tabellen setzen: Sie haben keine RLS, und das wäre die erste Abfrage ohne Mandantenfilter. Jeder Ausgang wirkt auf den Beleg — `verworfen` ist ein **Storno**, kein Löschen; `manuell` setzt ihn auf `laufend`, weil der Lauf schon beim Eingang startete. Zweite, unabhängige Quelle ist `app.aufbereitung_haengt`: Was der Worker beim Sterben liegen ließ, hat gar keinen Auftrag mehr, der scheitern könnte.

**Lernen ist strikt mandantenbezogen.** `zuordnungs_merkmal` und `kontierungs_muster` tragen immer `mandant_id`; kein Wissenstransfer über Mandantengrenzen. Deterministische Merkmale (Kundennummer, Zählernummer, IBAN) schlagen immer Embedding-Ähnlichkeit — letztere ergibt nie besser als orange.

**Die Anmeldung bestätigt nur, wer jemand ist — nicht, dass er hereindarf.** [ADR 0004](docs/adr/0004-anmeldung.md): Identität über Entra ID (OIDC), Sitzung serverseitig in Postgres, im Cookie nur ein Zufallswert. `app.identitaet_aufloesen` legt **keinen** Benutzer an; eine gültige Anmeldung ohne angelegten Benutzer endet mit einem Hinweis. Kein JWT im Cookie — eine Sitzung muss sofort widerrufbar sein, und `app.sitzung_aufloesen` prüft Ablauf, Untätigkeit und Sperrung bei jedem Auflösen. `angemeldeterBenutzer()` ist `async` und leitet ohne Sitzung zur Anmeldung um. Die Entwicklungsanmeldung verlangt `DMS_ANMELDUNG=entwicklung` **und** `NODE_ENV != production`; es gibt keinen stillen Rückfall auf sie.

**Eine Maske ohne Passwortfeld ist die Zusicherung.** `eingangsquelle.einstellungen` trägt unter `passwort_variable` den **Namen** einer Umgebungsvariablen, nie ihren Wert — deshalb hat die Einrichtungsmaske ([`src/app/eingang/page.tsx`](src/app/eingang/page.tsx)) kein Passwortfeld: Was sich nicht eingeben lässt, landet auch nicht versehentlich in der Datenbank. Angezeigt wird nur, **ob** die Variable auf diesem Server gesetzt ist (`passwortVorhanden`), nie ihr Inhalt. Eine Quelle mit fehlender Variablen scheitert sonst erst beim nächsten Lauf, und der Fehler steht in einer Spalte, die niemand liest, bis eine Rechnung vermisst wird. Ebenso sichtbar: ob der **Träger** noch aktiv ist — eine Quelle unter einem gesperrten Einrichter steht still, und das ist richtig, aber nur, wenn man es sieht.

**Eine Vorlage wird vorgeführt, bevor sie gilt.** Ein unbekannter Platzhalter wird beim **Speichern abgewiesen** (`vorlagePruefen`) und beim **Füllen stehengelassen** (`vorlageFuellen`) — zwei Gelegenheiten, denselben Tippfehler zu bemerken, und die spätere ist eine Mail, die schon draußen ist. Die Vorschau nutzt **erfundene** Beispielwerte: Sie mit dem zuletzt versandten Beleg zu füllen wäre ein zweiter Weg, ihn zu lesen — vorbei an der Berechtigung dafür.

**Nichts verlässt das Haus außerhalb des Ausgangsbuchs.** Kein Modul versendet selbst. Wer nach draußen will, schreibt mit `postAnlegen(c, …)` einen `ausgang` — **in derselben Transaktion wie sein Anlass**, sonst gibt es Zahlungen ohne Auftrag oder Aufträge ohne Zahlung. Gesendet wird später im Worker; ein hängender Mailserver darf keinen Stempel blockieren. Betreff und Text kommen aus `vorlage` über eine Platzhalter-Weißliste — ein unbekannter Name bleibt sichtbar stehen, ein bekannter ohne Wert wird `—`. Fehlgeschlagenes wird **nicht** selbsttätig wiederholt: Es steht mit Grund im Ausgangsbuch, und ein Mensch entscheidet. Enthält der Text ein Geheimnis (heute nur der Einsichts-Token), gehört `fluechtig: true` dazu — die Datenbank ersetzt den Text nach erfolgreichem Versand.

**Benachrichtigung ist Zähler *und* Sammelmail — verschieden dosiert** (§24.9). Der Zähler neben „Postfächer" wirkt ständig und kostet eine indizierte Zählabfrage je Seite; die Mail kommt **einmal am Tag** und nur, wenn etwas offen ist. Keine Mail je Aufgabe: Die hält zwei Wochen, danach filtert sie jeder in einen Ordner, den niemand öffnet — und dann ist auch die eine verloren, die wichtig war. `app.aufgaben_zaehler` läuft **ohne** `security definer`: Ein Zähler, der mehr zählt als die Liste darunter zeigt, schickt jemanden suchen.

**In der Sammelmail steht kein Beleg** — nur Zahlen und ein Link ins Postfach. Ein Postfach hat keine RLS, keine Sitzung und kein Protokoll; eine Aufzählung der fälligen Belege wäre eine zweite, schwächere Kopie des Bestands, die täglich neu entstünde. Die Weißliste kennt dafür nur `anzahl` und `ueberfaellig`. Ohne `DMS_BASIS_URL` entsteht **keine** Mail: Eine Benachrichtigung mit einem Link ins Leere kostet den Empfänger zweimal Zeit.

**Wer fällig ist, fragt der Worker ohne Benutzer — eingetragen wird unter dem Empfänger.** `app.benachrichtigung_faellig` ist `security definer` (der Worker hat keinen Benutzer) und gibt nur Zahlen heraus; `postAnlegen` läuft dann über `alsBenutzer`, sonst findet es die Vorlage nicht (die Policy braucht einen Mandanten) und der Ausgang landete ohne Haus.

**Adapterschicht für Stammdaten und Fremdsysteme.** `externe_id`/`sync_quelle`/`sync_stand` an den Stammdatentabellen sind der Grund, warum dieselbe Codebasis eigenständig und als Modul in einer Verwaltungssoftware laufen kann. Fachlogik nie direkt gegen ein Fremdsystem schreiben.

## Fallen, die nur unter Last sichtbar werden

Gemessen in §21 — beim Entwickeln mit Seed-Daten fällt beides nicht auf:

- **RLS-Policies:** Objektsichtbarkeit über eine `stable security definer`-Funktion auflösen (einmal je Statement, ~2 ms), **nicht** über `exists (select … from objekt_zustaendigkeit …)` je Zeile (Seq Scan, 264 ms bei 1 Mio. Zeilen). Die falsche Variante gehört als auskommentierte Warnung ins Schema.
- **`stable` heißt nicht „einmal ausgewertet".** Im Zeilenfilter einer Policy ruft PostgreSQL die Funktion je Zeile auf. Sie muss als unkorrelierte Unterabfrage stehen: `mandant_id = (select app.mein_mandant())`, `objekt_id = any ((select app.meine_objekte())::uuid[])` — der Cast ist Pflicht, sonst liest der Parser die Mengenform und der Index fällt weg. Selbst gemessen: **92 s → 140 ms** für den Feed über 1 Mio. Belege ([Migration 20260831210000](supabase/migrations/20260831210000_policies_initplan.sql), [docs/messungen.md](docs/messungen.md)). Gilt auch in Anwendungsabfragen: `app.meine_objekte()` gehört ins FROM, nicht ins WHERE.
- **`security definer` verhindert Inlining.** Sortierung und `limit` müssen *innerhalb* der Funktion stehen, sonst materialisiert der Planer erst alle Treffer.
- **Objektübergreifende Listen** brauchen LATERAL mit Top-N je Objekt (13 ms), nicht `objekt_id = any(array) order by … limit` (64 ms).
- **Ein zusätzlicher Index kann schaden:** ein Index auf `eingang_am` allein verschlechterte den Feed von 13 auf 30 ms. Der zusammengesetzte Index `(objekt_id, eingang_am desc)` genügt.
- **`dokument.hat_umlagefaehige_zeile`** ist bewusst denormalisiert (Trigger aus der Kontierung) — ersetzt bei jedem Belegaufruf eines Mieters einen Semi-Join über eine Million Kontierungszeilen (48,6 ms → 11,9 ms).

## Regeln, die nicht verletzt werden dürfen

- **Summenzwang:** Σ `kontierung.betrag_brutto` = `rechnung_fakten.brutto`. Verletzung blockiert die Kontierungsstufe. Die Prüfung läuft über die Kontierung, **nicht** über die Zahlungszeilen — sonst verletzt der Eigenanteil bei Selbstbeteiligung sie.
- **Harte Sperre vor der Zahlung:** `app.zahlung_moeglich()` prüft in dieser Reihenfolge — gültige Freigaben, Pflichtstufen durch, Summenzwang, harte Befunde, aktiver Zahlungsweg, verifizierte Bankverbindung. **Gültig** ist das tragende Wort: Jeder Freigabestempel trägt den `freigabe_hash` seines Datenstands (Trigger, nicht Anwendung). Bricht er, schreibt `app.freigaben_nachpruefen()` je Stufe ein Ereignis `verfallen`, öffnet die Aufgabe und springt zurück. Eine gescheiterte Übergabe darf **keine** Zahlung als übergeben hinterlassen.
- **Harte Rot-Fälle:** IBAN passt nicht zum bekannten Kreditor (Betrugsschutz) und Dublette (Kreditor + Rechnungsnummer + Betrag). Beide stoppen die Bearbeitung, sie färben nicht nur.
- **Nie löschen:** Ordnungsgruppen nur deaktivieren; abgelehnte Belege bleiben im Status `abgelehnt` und werden archiviert, die Ersatzrechnung ist ein neues Dokument, verkettet über `ersetzt`. Nach Archivierung nur Storno + Neuerfassung.
- **Klärung:** `kommentar` und `wiedervorlage_am` sind Pflicht, sonst kein Eintritt. Stempel bleiben gültig, Stufe wird gemerkt.
- **Externe Einsicht:** kein Benutzer, keine Sitzung — der Token *ist* der Zugang, und `app.einsicht_aufloesen` prüft bei **jedem** Aufruf Gültigkeit und Widerruf. Benutzung verlängert nicht. Der Umfang wird je Beleg neu geprüft (`app.einsicht_darf_beleg`), nie über die Liste. Datei und Prüfung stehen in **einer** Funktion (`app.einsicht_datei`) — getrennt lief die zweite Abfrage ohne Benutzer und lieferte nichts. Eingeschränkte und stornierte Belege gehen nie hinaus.
- **Mietersicht wird gerechnet, nicht freigegeben:** umlagefähige Kontierungszeile **und** Überschneidung von Leistungszeitraum und `person_bezug`-Mietzeit. Keine manuelle Belegfreigabe einbauen — sie übersieht Mieterwechsel.
- **DSGVO gegen GoBD:** Löschansprüche an aufbewahrungspflichtigen Belegen führen zur Einschränkung der Verarbeitung (Kennzeichnung, Entzug aller Leserechte), nicht zur Löschung. `dokument.eingeschraenkt` steht in der SELECT-Policy — für **alle**, auch den Objektverantwortlichen; wer eine Ausnahme einbaut, hebt die Einschränkung auf. Der Eintrag in `einschraenkung` bleibt trotzdem sichtbar, sonst wäre der Vorgang spurlos. `app.loeschkandidaten` ist deshalb `security definer` mit handgeschriebenem Mandantenfilter — sonst wäre die Löschpflicht nach Fristablauf still unerfüllbar.
- **Löschen ist die Kehrseite der Aufbewahrung, nicht ihr Gegenteil** (§24.5). Nach Fristablauf *darf* ein Beleg nicht länger liegen — GoBD und DSGVO zeigen hier in dieselbe Richtung. Die drei Schutztrigger (`app.archiv_unveraenderlich`, `app.archiv_satellit_schutz`, `app.archiv_eintrag_schutz`) haben deshalb **eine** Ausnahme, und die ist eine **nachprüfbare Tatsache** (`app.loeschung_faellig`: archiviert, Frist abgelaufen, keine Löschsperre) — keine Fahne, die jemand setzen kann. Ein Sitzungsschalter wäre bequemer und wäre genau die Hintertür, gegen die es die Trigger gibt.

- **Zwei Löschgründe, und sie sind verschieden.** `app.loeschkandidaten` verband auf `einschraenkung` und kannte deshalb nur Belege mit **Löschanspruch**; Belege, nach denen niemand gefragt hat, deren Frist aber vorbei ist, fielen durch — die Löschpflicht nach Fristablauf war damit unerfüllbar. `app.loeschfaellig` liefert beide und unterscheidet sie: Beim Anspruch wartet jemand auf eine Antwort.

- **Das Löschprotokoll ist die Warteschlange für die Dateien.** Gelöscht wird je Beleg auf ausdrückliche Handlung (nie im Rundumschlag — ein solcher Knopf wird irgendwann versehentlich gedrückt); die Datei im Objektspeicher räumt ein Durchgang ab, gesteuert über `loeschung.datei_geloescht_am is null`. Reihenfolge: erst das Protokoll, dann der Beleg — andersherum bliebe bei einem Abbruch ein gelöschter Beleg ohne Spur, und niemand könnte sagen, ob er gelöscht wurde oder verlorenging. Das Protokoll enthält **keine personenbezogenen Daten**: Eines, das den Namen behält, hat nicht gelöscht.

- **Object Lock und Aufbewahrungsfrist greifen ineinander.** Gemessen gegen MinIO: Während der Compliance-Sperre wird das Löschen abgewiesen, danach gelingt es. Das passt zusammen, weil die Sperre bis `aufbewahrung_bis` läuft und gelöscht erst danach wird — `Ablage.entfernen` gibt die **Fassung** mit, sonst setzt S3 bei versionierten Eimern nur eine Löschmarke und die Datei bliebe unsichtbar liegen.
- **Nach der Archivierung ist der Beleg fest.** Trigger auf `dokument`, `kontierung` und `rechnung_fakten`; Änderung nur über Storno + Neuerfassung, verkettet über `dokument_beziehung` (`ersetzt`). Abgelehnte Belege werden archiviert und behalten den Status `abgelehnt`. Die Aufbewahrungsfrist rechnet ab **Jahresende** (§147 AO) und steht als Stammdatum in `aufbewahrungsfrist`; ohne Eintrag zehn Jahre — nie kürzer.
- **`date` aus pg wird zum `Date`-Objekt in Serverzeitzone.** Aus dem 31.12. wird der 30.12. Jedes Datum, das als Datum gemeint ist, per `to_char(..., 'YYYY-MM-DD')` abfragen. Hat schon dreimal zugeschlagen: Zahlungsziel, Aufbewahrungsfrist, Rechnungsdatum in der Objektakte.
- **Vertretung überträgt keine Rechte** — die Aufgabe wandert über die Eskalation, die Rolle bleibt.

## Umsetzungsreihenfolge

Das Konzept (§23) schreibt einen dünnen Schnitt durch alles vor, nicht Schicht für Schicht: Migrationen + Seed + **RLS-Tests ab Tag eins** → Ingest (Hash, Dublette, Textlayer/OCR, Seitentext, WebP) → Viewer (erste Seite < 100 ms, PDF nur per Range-Request) → Workflow-Engine (eine Belegart, eine Kette, keine Bedingungen) → Postfächer (alle drei nur Sichten auf `aufgabe`) → dann in die Breite.

**Der Workflow wird ein Blockbaum, keine Kette.** [ADR 0002](docs/adr/0002-workflow-modell.md) ist angenommen und ändert diese Reihenfolge: Vor der Engine kommen das Rollenmodell aus §17, die Tabelle `prozessknoten` (`nacheinander` / `gleichzeitig` / `verzweigung` / `stufe`) und Bedingungen als `jsonb` über einer Weißliste. Die Engine läuft dann einen Baum ab, statt `reihenfolge` hochzuzählen. Wer jetzt eine lineare Engine baut, baut sie zweimal. §8.8 („Kein Prozessdesigner") ist damit bewusst aufgehoben — die Auflage daraus bleibt: Simulation vor dem Aktivieren.

§24 listet die offenen Punkte. Zwei davon sind nachträglich teuer und sollten vor größerem Ingest-Code bedacht werden: **Stapelscan mit Belegtrennung** (eine Scandatei enthält zwanzig Belege) und **Vorlagen für Ausgangspost** (die Systemaktionen sind vorgesehen, die Vorlagenverwaltung fehlt).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
