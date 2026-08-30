# Stand des Systems

<!-- ERZEUGT von scripts/stand-erzeugen.mjs -- nicht von Hand bearbeiten. -->
<!-- Neu schreiben mit: npm run docs:stand -->

Diese Datei ist der Einstieg fuer Agenten und beantwortet, was im Repository
vorhanden ist. Das *Warum* steht in [konzept.md](konzept.md) und den
[Architekturentscheidungen](adr/), das *Wie bediene ich es* im
[Handbuch](handbuch.md).

Auf einen Blick: 40 Tabellen, 41 Policies,
8 Module, 53 Testfaelle in 4 Dateien,
2 Architekturentscheidungen, 1 markierte offene Stellen.

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

## Module

| Datei | Aufgabe |
|---|---|
| [`src/ablage.ts`](../src/ablage.ts) | Ablage der Originaldateien |
| [`src/db.ts`](../src/db.ts) | Datenbankzugriff |
| [`src/ingest/aufnehmen.ts`](../src/ingest/aufnehmen.ts) | Eingang: eine Datei wird zum Dokument |
| [`src/ingest/dublette.ts`](../src/ingest/dublette.ts) | Dublettenpruefung |
| [`src/ingest/pdf.ts`](../src/ingest/pdf.ts) | PDF: Seitentext mit Koordinaten und Vorrendern |
| [`src/queue.ts`](../src/queue.ts) | Warteschlange |
| [`src/worker/aufbereitung.ts`](../src/worker/aufbereitung.ts) | Aufbereitung eines eingegangenen Dokuments |
| [`src/worker/index.ts`](../src/worker/index.ts) | Worker-Prozess |

## Tests

| Datei | Faelle | Gruppen |
|---|---|---|
| [`tests/aufbereitung.test.ts`](../tests/aufbereitung.test.ts) | 16 | Seitentext, Textlayer-Erkennung, Vorrendern, Formaterkennung, Aufbereitung |
| [`tests/ingest.test.ts`](../tests/ingest.test.ts) | 8 | Aufnahme, Dublettenpruefung |
| [`tests/mietersicht.test.ts`](../tests/mietersicht.test.ts) | 13 | Mietersicht, Umlageflag, Summenzwang |
| [`tests/rls.test.ts`](../tests/rls.test.ts) | 16 | Mandantentrennung, Objektzustaendigkeit, Spezialgebiet, Stempelereignisse, Klaerung |

## Architekturentscheidungen

| Entscheidung | Stand |
|---|---|
| [0001 · PDF-Bibliothek: pdfjs-dist statt pdfium](adr/0001-pdf-bibliothek.md) | angenommen |
| [0002 · Workflow-Modell: Kette oder Graph, Bedingungen, Delegation](adr/0002-workflow-modell.md) | vorgeschlagen |

## Im Quelltext markierte offene Stellen

| Fundstelle |
|---|
| [`src/worker/aufbereitung.ts:131`](../src/worker/aufbereitung.ts) |
