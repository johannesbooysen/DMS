# Stand des Systems

<!-- ERZEUGT von scripts/stand-erzeugen.mjs -- nicht von Hand bearbeiten. -->
<!-- Neu schreiben mit: npm run docs:stand -->

Diese Datei ist der Einstieg fuer Agenten und beantwortet, was im Repository
vorhanden ist. Das *Warum* steht in [konzept.md](konzept.md) und den
[Architekturentscheidungen](adr/), das *Wie bediene ich es* im
[Handbuch](handbuch.md).

Auf einen Blick: 48 Tabellen, 52 Policies,
28 Module, 199 Testfaelle in 12 Dateien,
3 Architekturentscheidungen, 3 markierte offene Stellen.

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm run dev` | `concurrently -n web,worker -c blue,magenta "next dev" "tsx watch src/worker/index.ts"` |
| `npm run dev:web` | `next dev` |
| `npm run dev:worker` | `tsx watch src/worker/index.ts` |
| `npm run build` | `next build` |
| `npm run start` | `next start` |
| `npm run worker` | `tsx src/worker/index.ts` |
| `npm run test` | `vitest run` |
| `npm run test:watch` | `vitest` |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run docs:stand` | `node scripts/stand-erzeugen.mjs` |
| `npm run docs:check` | `node scripts/doku-pruefen.mjs` |
| `npm run db:start` | `supabase start` |
| `npm run db:stop` | `supabase stop` |
| `npm run db:new` | `supabase migration new` |
| `npm run db:migrate` | `supabase migration up` |
| `npm run db:reset` | `supabase db reset` |

## Migrationen

### `supabase/migrations/20260828100000_kern.sql`

Kernschema: Stammdaten, Dokumentenkern, Workflow-Engine

Tabellen: `mandant`, `benutzer`, `gruppe`, `gruppe_mitglied`, `spezialgebiet`, `kontenrahmen`, `umlageschluessel`, `ordnungsgruppe`, `konto`, `belegmerkmal`, `zahlungsweg`, `objekt`, `objekt_zustaendigkeit`, `spezialgebiet_zustaendigkeit`, `kreditor`, `kreditor_bankverbindung`, `vertrag`, `prozessdefinition`, `prozessstufe`, `prozess_override`, `stempeltyp`, `stempel_recht`, `vorgang`, `dokument`, `dokument_datei`, `dokument_seite`, `dokument_merkmal`, `extraktion_feld`, `rechnung_fakten`, `dokument_beziehung`, `dokument_lauf`, `aufgabe`, `stempel_ereignis`, `klaerung`, `zuweisung_ereignis`

Funktionen: `app.stempel_kette`, `app.nur_anfuegen`, `app.freigabe_hash`


### `supabase/migrations/20260828100100_rls.sql`

Berechtigungen: Row Level Security

Funktionen: `app.mein_benutzer`, `app.mein_mandant`, `app.meine_objekte`, `app.meine_gruppen`, `app.meine_spezialgebiete`

Policies: 36

### `supabase/migrations/20260828120000_einheit_person_kontierung.sql`

Einheit, Person, zeitbezogene Belegeinsicht und Kontierung mit Split

Tabellen: `einheit`, `person`, `person_bezug`, `kontierung`, `kontierung_35a`

Funktionen: `app.kontierung_summe_stimmt`, `app.umlageflag_pflegen`, `app.belege_fuer_mieter`

Policies: 5

### `supabase/migrations/20260830100000_rollen.sql`

Rollenmodell

Tabellen: `rolle`, `rolle_recht`, `benutzer_rolle_objekt`

Funktionen: `app.meine_objekte`, `app.darf`

Policies: 3

### `supabase/migrations/20260830110000_zeitraum_pruefregeln.sql`

Nachgezogene Pruefregel auf datierten Zustaendigkeiten


### `supabase/migrations/20260830120000_prozessknoten.sql`

Workflow als Blockbaum

Tabellen: `prozessknoten`

Funktionen: `app.prozessbaum_pruefen`

Policies: 1

### `supabase/migrations/20260830130000_stufe_stempeltyp.sql`

Welche Stempel sind an welcher Stufe moeglich?

Tabellen: `prozessstufe_stempeltyp`

Funktionen: `app.moegliche_stempel`

Policies: 1

### `supabase/migrations/20260830140000_aufgabe_rolle.sql`

Aufgaben an eine Rolle


### `supabase/migrations/20260831100000_prozess_entwurf.sql`

Entwurf und Aktivierung einer Prozessfassung

Tabellen: `prozessdefinition_ereignis`

Policies: 2

### `supabase/migrations/20260831110000_delegation.sql`

Vertretung: Aufgaben weitergeben, Rechte nicht

Tabellen: `delegation`

Funktionen: `app.vertretung_fuer`

Policies: 3

### `supabase/migrations/20260831120000_plausibilitaet.sql`

Plausibilitaet: Befunde festhalten

Tabellen: `plausibilitaet_befund`

Policies: 1

## Module

| Datei | Aufgabe |
|---|---|
| [`src/ablage.ts`](../src/ablage.ts) | Ablage der Originaldateien |
| [`src/app/api/beleg/[id]/pdf/route.ts`](../src/app/api/beleg/[id]/pdf/route.ts) | Das Original-PDF -- nur per Range-Request |
| [`src/app/api/beleg/[id]/seite/[nr]/route.ts`](../src/app/api/beleg/[id]/seite/[nr]/route.ts) | Vorgerenderte Seite als WebP |
| [`src/app/lib/aktionen.ts`](../src/app/lib/aktionen.ts) | 'use server' |
| [`src/app/lib/belege.ts`](../src/app/lib/belege.ts) | Datenzugriff des Viewers |
| [`src/app/lib/konfig-aktionen.ts`](../src/app/lib/konfig-aktionen.ts) | 'use server' |
| [`src/app/lib/postfach.ts`](../src/app/lib/postfach.ts) | Postfächer und Stempeln |
| [`src/app/lib/sitzung.ts`](../src/app/lib/sitzung.ts) | Wer ist angemeldet? |
| [`src/app/lib/vertretung-aktionen.ts`](../src/app/lib/vertretung-aktionen.ts) | 'use server' |
| [`src/db.ts`](../src/db.ts) | Datenbankzugriff |
| [`src/extraktion/index.ts`](../src/extraktion/index.ts) | Auswahl des Anbieters und Übernahme der Ergebnisse |
| [`src/extraktion/ollama.ts`](../src/extraktion/ollama.ts) | Lokales Modell über Ollama |
| [`src/extraktion/typen.ts`](../src/extraktion/typen.ts) | Die Erkennung hinter einem Interface |
| [`src/extraktion/zahlen.ts`](../src/extraktion/zahlen.ts) | Beträge aus Text lesen |
| [`src/extraktion/zugferd.ts`](../src/extraktion/zugferd.ts) | Strukturierte Rechnungen: ZUGFeRD und XRechnung |
| [`src/ingest/aufnehmen.ts`](../src/ingest/aufnehmen.ts) | Eingang: eine Datei wird zum Dokument |
| [`src/ingest/dublette.ts`](../src/ingest/dublette.ts) | Dublettenpruefung |
| [`src/ingest/pdf.ts`](../src/ingest/pdf.ts) | PDF: Seitentext mit Koordinaten und Vorrendern |
| [`src/ingest/schriften.ts`](../src/ingest/schriften.ts) | Schriften für das Rendern |
| [`src/pruefung/plausibilitaet.ts`](../src/pruefung/plausibilitaet.ts) | Plausibilitätsprüfungen und die Gesamtampel |
| [`src/queue.ts`](../src/queue.ts) | Warteschlange |
| [`src/worker/aufbereitung.ts`](../src/worker/aufbereitung.ts) | Aufbereitung eines eingegangenen Dokuments |
| [`src/worker/index.ts`](../src/worker/index.ts) | Worker-Prozess |
| [`src/workflow/baum.ts`](../src/workflow/baum.ts) | Der Blockbaum: laden, ablaufen, simulieren |
| [`src/workflow/bedingung.ts`](../src/workflow/bedingung.ts) | Bedingungen an Verzweigungen des Ablaufs |
| [`src/workflow/engine.ts`](../src/workflow/engine.ts) | Workflow-Engine |
| [`src/workflow/konfiguration.ts`](../src/workflow/konfiguration.ts) | Konfiguration der Abläufe — der Baukasten |
| [`src/workflow/vertretung.ts`](../src/workflow/vertretung.ts) | Vertretung anlegen, ansehen, widerrufen |

## Tests

| Datei | Faelle | Gruppen |
|---|---|---|
| [`tests/aufbereitung.test.ts`](../tests/aufbereitung.test.ts) | 15 | Seitentext, Textlayer-Erkennung, Vorrendern, Formaterkennung, Aufbereitung |
| [`tests/engine.test.ts`](../tests/engine.test.ts) | 15 | Kontext, Lauf, Betragsgrenze, Paralleler Block, Verzweigung, Sperre vor der Zahlung, Simulation |
| [`tests/extraktion.test.ts`](../tests/extraktion.test.ts) | 27 | ZUGFeRD: XML lesen, Vertrauen und Ampel, Antwort eines Modells lesen, Uebernahme in die Datenbank, Aufbereitung mit Erkennung, Betraege lesen |
| [`tests/ingest.test.ts`](../tests/ingest.test.ts) | 8 | Aufnahme, Dublettenpruefung |
| [`tests/kette.test.ts`](../tests/kette.test.ts) | 4 | Vom Eingang bis zur ersten Aufgabe |
| [`tests/konfiguration.test.ts`](../tests/konfiguration.test.ts) | 20 | Recht am Baukasten, Entwurf, Bausteine bearbeiten, Aktivieren, Simulation |
| [`tests/mietersicht.test.ts`](../tests/mietersicht.test.ts) | 13 | Mietersicht, Umlageflag, Summenzwang |
| [`tests/plausibilitaet.test.ts`](../tests/plausibilitaet.test.ts) | 20 | Die Gesamtampel, IBAN gegen den bekannten Kreditor, Dublette, Betragsprobe, Pflichtangaben nach Paragraf 14 UStG, Kreditor, Harte Befunde halten an, Erneutes Pruefen |
| [`tests/postfach.test.ts`](../tests/postfach.test.ts) | 18 | Persoenliches Postfach, Uebergabe zwischen den Rollen, Moegliche Stempel, Stempeln |
| [`tests/rls.test.ts`](../tests/rls.test.ts) | 24 | Mandantentrennung, Objektzustaendigkeit, Rechte, Spezialgebiet, Stempelereignisse, Klaerung |
| [`tests/vertretung.test.ts`](../tests/vertretung.test.ts) | 15 | Vertretung anlegen, Wirkung auf neue Aufgaben, Vertretung uebertraegt keine Rechte |
| [`tests/workflow.test.ts`](../tests/workflow.test.ts) | 20 | Blockbaum, Bedingungen: Pruefung, Bedingungen: Auswertung |

## Architekturentscheidungen

| Entscheidung | Stand |
|---|---|
| [0001 · PDF-Bibliothek: pdfjs-dist statt pdfium](adr/0001-pdf-bibliothek.md) | angenommen |
| [0002 · Workflow-Modell: Blockstruktur, Bedingungen, Delegation](adr/0002-workflow-modell.md) | angenommen |
| [0003 · Erkennung: strukturierte Rechnung zuerst, Modell nur auf Ansage](adr/0003-erkennung.md) | angenommen |

## Im Quelltext markierte offene Stellen

| Fundstelle |
|---|
| [`src/worker/aufbereitung.ts:158`](../src/worker/aufbereitung.ts) |
| [`src/workflow/engine.ts:88`](../src/workflow/engine.ts) |
| [`src/workflow/engine.ts:184`](../src/workflow/engine.ts) |
