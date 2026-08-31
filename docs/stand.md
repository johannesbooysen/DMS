# Stand des Systems

<!-- ERZEUGT von scripts/stand-erzeugen.mjs -- nicht von Hand bearbeiten. -->
<!-- Neu schreiben mit: npm run docs:stand -->

Diese Datei ist der Einstieg fuer Agenten und beantwortet, was im Repository
vorhanden ist. Das *Warum* steht in [konzept.md](konzept.md) und den
[Architekturentscheidungen](adr/), das *Wie bediene ich es* im
[Handbuch](handbuch.md).

Auf einen Blick: 65 Tabellen, 127 Policies,
68 Module, 513 Testfaelle in 23 Dateien,
4 Architekturentscheidungen, 3 markierte offene Stellen.

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
| `npm run objektakte` | `tsx scripts/objektakte.ts` |

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

### `supabase/migrations/20260831130000_lernspeicher.sql`

Lernspeicher

Tabellen: `zuordnungs_merkmal`, `kontierungs_muster`, `korrektur_ereignis`

Policies: 4

### `supabase/migrations/20260831140000_zuordnungssicht.sql`

Belege ohne Objektzuordnung sichtbar machen

Policies: 1

### `supabase/migrations/20260831150000_zuordnungstreffer.sql`

Zuordnungstreffer unabhaengig von der Objektsichtbarkeit

Funktionen: `app.zuordnungstreffer`


### `supabase/migrations/20260831160000_dokument_policies_trennen.sql`

Lesen und Schreiben am Dokument trennen

Policies: 4

### `supabase/migrations/20260831170000_dokument_zuordnen.sql`

Zuordnen als eigene Handlung

Funktionen: `app.dokument_zuordnen`


### `supabase/migrations/20260831180000_anmeldung.sql`

Anmeldung: Identitaet, Sitzung, Protokoll

Tabellen: `sitzung`, `anmelde_ereignis`

Funktionen: `app.sitzung_aufloesen`, `app.identitaet_aufloesen`, `app.sitzung_anlegen`, `app.sitzung_beenden`, `app.sitzungen_widerrufen`, `app.anmeldung_protokollieren`

Policies: 2

### `supabase/migrations/20260831190000_zahlung.sql`

Zahlungsuebergabe und die harte Sperre davor

Tabellen: `zahlung`

Funktionen: `app.stempel_hash_setzen`, `app.gueltige_freigaben`, `app.freigaben_nachpruefen`, `app.zahlung_moeglich`

Policies: 1

### `supabase/migrations/20260831200000_archiv.sql`

Archivierung, Aufbewahrung, Einschraenkung

Tabellen: `aufbewahrungsfrist`, `archiv_eintrag`, `einschraenkung`

Funktionen: `app.aufbewahrung_bis`, `app.archiv_eintrag_schutz`, `app.einschraenkung_spiegeln`, `app.archiv_unveraenderlich`, `app.archiv_satellit_schutz`, `app.dokument_archivieren`, `app.dokument_stornieren`, `app.verarbeitung_einschraenken`, `app.loeschkandidaten`

Policies: 4

### `supabase/migrations/20260831210000_policies_initplan.sql`

Die Policies rufen ihre Funktionen je Zeile auf -- und das kostet Minuten

Policies: 49

### `supabase/migrations/20260831220000_einsicht.sql`

Externe Belegeinsicht: Eigentuemer, Beirat, Mieter

Tabellen: `einsicht_gewaehrung`, `zugriff_protokoll`

Funktionen: `app.einsicht_aufloesen`, `app.einsicht_belege`, `app.einsicht_darf_beleg`, `app.einsicht_datei`, `app.einsicht_protokollieren`, `app.einsicht_gewaehren`, `app.einsicht_widerrufen`

Policies: 2

### `supabase/migrations/20260831230000_nebenlauf.sql`

Nebenlaeufe: Wartecontainer und Bauteile

Tabellen: `wartecontainer`, `bauteil`

Funktionen: `app.gewaehrleistung_offen`, `app.warten_beginnen`, `app.warten_beenden`, `app.wartecontainer_faellig`

Policies: 2

### `supabase/migrations/20260831240000_stapel.sql`

Posteingang: Stapelscan mit Belegtrennung

Tabellen: `stapel`, `stapel_seite`

Funktionen: `app.stapel_gruppieren`, `app.stapel_trennen`

Policies: 2

### `supabase/migrations/20260831250000_postausgang.sql`

Postausgang: Vorlagen und Ausgangsbuch

Tabellen: `vorlage`, `ausgang`

Funktionen: `app.ausgang_anlegen`, `app.ausgang_vermerken`, `app.ausgang_offen`, `app.vorlagen_grundbestand`, `app.vorlagen_beim_mandanten`

Policies: 4

### `supabase/migrations/20260831260000_ausgang_fluechtig.sql`

Fluechtige Ausgaenge: der Text verschwindet nach dem Senden

Funktionen: `app.ausgang_anlegen`, `app.ausgang_vermerken`, `app.ausgang_offen`


## Module

| Datei | Aufgabe |
|---|---|
| [`src/ablage.ts`](../src/ablage.ts) | Ablage der Originaldateien |
| [`src/anmeldung/anbieter.ts`](../src/anmeldung/anbieter.ts) | Der Identitätsanbieter hinter einem Interface |
| [`src/anmeldung/entra.ts`](../src/anmeldung/entra.ts) | Anmeldung über Microsoft Entra ID (OpenID Connect) |
| [`src/anmeldung/entwicklung.ts`](../src/anmeldung/entwicklung.ts) | Anmeldung ohne Anbieter — ausschließlich für die Entwicklung |
| [`src/anmeldung/index.ts`](../src/anmeldung/index.ts) | Welcher Identitätsanbieter gilt? |
| [`src/anmeldung/sitzung.ts`](../src/anmeldung/sitzung.ts) | Sitzungen: anlegen, auflösen, beenden |
| [`src/anmeldung/ziel.ts`](../src/anmeldung/ziel.ts) | Wohin nach der Anmeldung? |
| [`src/app/api/anmeldung/rueckkehr/route.ts`](../src/app/api/anmeldung/rueckkehr/route.ts) | Der Rückweg vom Identitätsanbieter |
| [`src/app/api/beleg/[id]/pdf/route.ts`](../src/app/api/beleg/[id]/pdf/route.ts) | Das Original-PDF -- nur per Range-Request |
| [`src/app/api/beleg/[id]/seite/[nr]/route.ts`](../src/app/api/beleg/[id]/seite/[nr]/route.ts) | Vorgerenderte Seite als WebP |
| [`src/app/api/einsicht/[token]/[dokument]/[seite]/route.ts`](../src/app/api/einsicht/[token]/[dokument]/[seite]/route.ts) | Eine Belegseite für die externe Ansicht |
| [`src/app/api/einsicht/[token]/[dokument]/pdf/route.ts`](../src/app/api/einsicht/[token]/[dokument]/pdf/route.ts) | Das Original als PDF — nur bei ausdrücklichem Download-Recht |
| [`src/app/api/stapel/[id]/seite/[nr]/route.ts`](../src/app/api/stapel/[id]/seite/[nr]/route.ts) | Eine Stapelseite als Miniatur |
| [`src/app/lib/adresse.ts`](../src/app/lib/adresse.ts) | Wie die Anwendung von außen heißt |
| [`src/app/lib/aktionen.ts`](../src/app/lib/aktionen.ts) | 'use server' |
| [`src/app/lib/anmelde-aktionen.ts`](../src/app/lib/anmelde-aktionen.ts) | 'use server' |
| [`src/app/lib/belege.ts`](../src/app/lib/belege.ts) | Datenzugriff des Viewers |
| [`src/app/lib/belegliste.ts`](../src/app/lib/belegliste.ts) | Die Belegübersicht mit Daten versorgen |
| [`src/app/lib/einsicht-aktionen.ts`](../src/app/lib/einsicht-aktionen.ts) | 'use server' |
| [`src/app/lib/konfig-aktionen.ts`](../src/app/lib/konfig-aktionen.ts) | 'use server' |
| [`src/app/lib/kontierung-aktionen.ts`](../src/app/lib/kontierung-aktionen.ts) | 'use server' |
| [`src/app/lib/kontierung-daten.ts`](../src/app/lib/kontierung-daten.ts) | Die Kontierungsmaske mit Daten versorgen |
| [`src/app/lib/nebenlauf-aktionen.ts`](../src/app/lib/nebenlauf-aktionen.ts) | 'use server' |
| [`src/app/lib/postausgang-aktionen.ts`](../src/app/lib/postausgang-aktionen.ts) | 'use server' |
| [`src/app/lib/posteingang-aktionen.ts`](../src/app/lib/posteingang-aktionen.ts) | 'use server' |
| [`src/app/lib/postfach.ts`](../src/app/lib/postfach.ts) | Postfächer und Stempeln |
| [`src/app/lib/sitzung.ts`](../src/app/lib/sitzung.ts) | Wer ist angemeldet? |
| [`src/app/lib/vertretung-aktionen.ts`](../src/app/lib/vertretung-aktionen.ts) | 'use server' |
| [`src/app/lib/zahlung-daten.ts`](../src/app/lib/zahlung-daten.ts) | Die Zahlungsansicht mit Daten versorgen |
| [`src/app/lib/zahlungsmittel.ts`](../src/app/lib/zahlungsmittel.ts) | Womit die Anwendung Zahlungen übergibt |
| [`src/archiv/index.ts`](../src/archiv/index.ts) | Archivierung, Aufbewahrung, Einschränkung |
| [`src/archiv/objektakte.ts`](../src/archiv/objektakte.ts) | Objektakte für den Verwalterwechsel |
| [`src/belege/liste.ts`](../src/belege/liste.ts) | Interne Belegeinsicht: Akte, Feed, gefilterte Liste, Volltext |
| [`src/datum.ts`](../src/datum.ts) | Ein `date` aus PostgreSQL als `YYYY-MM-DD` |
| [`src/db.ts`](../src/db.ts) | Datenbankzugriff |
| [`src/einsicht/index.ts`](../src/einsicht/index.ts) | Externe Belegeinsicht |
| [`src/einsicht/wasserzeichen.ts`](../src/einsicht/wasserzeichen.ts) | Wasserzeichen für die externe Ansicht |
| [`src/extraktion/index.ts`](../src/extraktion/index.ts) | Auswahl des Anbieters und Übernahme der Ergebnisse |
| [`src/extraktion/ollama.ts`](../src/extraktion/ollama.ts) | Lokales Modell über Ollama |
| [`src/extraktion/typen.ts`](../src/extraktion/typen.ts) | Die Erkennung hinter einem Interface |
| [`src/extraktion/zahlen.ts`](../src/extraktion/zahlen.ts) | Beträge aus Text lesen |
| [`src/extraktion/zugferd.ts`](../src/extraktion/zugferd.ts) | Strukturierte Rechnungen: ZUGFeRD und XRechnung |
| [`src/ingest/aufnehmen.ts`](../src/ingest/aufnehmen.ts) | Eingang: eine Datei wird zum Dokument |
| [`src/ingest/dublette.ts`](../src/ingest/dublette.ts) | Dublettenpruefung |
| [`src/ingest/pdf.ts`](../src/ingest/pdf.ts) | PDF: Seitentext mit Koordinaten und Vorrendern |
| [`src/ingest/schriften.ts`](../src/ingest/schriften.ts) | Schriften für das Rendern |
| [`src/kontierung/kontierung.ts`](../src/kontierung/kontierung.ts) | Kontierung mit Split |
| [`src/lernen/zuordnung.ts`](../src/lernen/zuordnung.ts) | Objektzuordnung aus gelernten Merkmalen |
| [`src/nebenlauf/index.ts`](../src/nebenlauf/index.ts) | Nebenläufe: Wartecontainer und Bauteile |
| [`src/postausgang/index.ts`](../src/postausgang/index.ts) | Postausgang: Vorlage füllen, in das Ausgangsbuch legen, senden |
| [`src/postausgang/versand.ts`](../src/postausgang/versand.ts) | Der Versand |
| [`src/postausgang/vorlagen.ts`](../src/postausgang/vorlagen.ts) | Vorlagen mit Platzhaltern |
| [`src/pruefung/mahnung.ts`](../src/pruefung/mahnung.ts) | Mahnungen |
| [`src/pruefung/plausibilitaet.ts`](../src/pruefung/plausibilitaet.ts) | Plausibilitätsprüfungen und die Gesamtampel |
| [`src/queue.ts`](../src/queue.ts) | Warteschlange |
| [`src/stapel/index.ts`](../src/stapel/index.ts) | Posteingang: Stapel aufnehmen, trennen, übernehmen |
| [`src/stapel/trennung.ts`](../src/stapel/trennung.ts) | Trennblätter erkennen |
| [`src/worker/aufbereitung.ts`](../src/worker/aufbereitung.ts) | Aufbereitung eines eingegangenen Dokuments |
| [`src/worker/index.ts`](../src/worker/index.ts) | Worker-Prozess |
| [`src/worker/stapelaufbereitung.ts`](../src/worker/stapelaufbereitung.ts) | Einen Stapel aufbereiten: Seiten lesen, rendern, Trennung vorschlagen |
| [`src/workflow/baum.ts`](../src/workflow/baum.ts) | Der Blockbaum: laden, ablaufen, simulieren |
| [`src/workflow/bedingung.ts`](../src/workflow/bedingung.ts) | Bedingungen an Verzweigungen des Ablaufs |
| [`src/workflow/engine.ts`](../src/workflow/engine.ts) | Workflow-Engine |
| [`src/workflow/konfiguration.ts`](../src/workflow/konfiguration.ts) | Konfiguration der Abläufe — der Baukasten |
| [`src/workflow/vertretung.ts`](../src/workflow/vertretung.ts) | Vertretung anlegen, ansehen, widerrufen |
| [`src/zahlung/index.ts`](../src/zahlung/index.ts) | Zahlungsübergabe |
| [`src/zahlung/sperre.ts`](../src/zahlung/sperre.ts) | Die harte Sperre vor der Zahlung |
| [`src/zahlung/wege.ts`](../src/zahlung/wege.ts) | Die Zahlungswege |

## Tests

| Datei | Faelle | Gruppen |
|---|---|---|
| [`tests/anmeldung.test.ts`](../tests/anmeldung.test.ts) | 37 | Sitzung, Eine Sitzung verfaellt, Wer keine Sitzung bekommt, Identitaet und Benutzer, Der Zustand zwischen Hinweg und Rueckweg, Weiterleitungsziel, Anbieterwahl, Entwicklungsanbieter, Protokoll, Sichtbarkeit der Sitzungen |
| [`tests/archiv.test.ts`](../tests/archiv.test.ts) | 33 | Aufbewahrungsfrist, Archivieren, Nach der Archivierung ist Schluss, Storno statt Korrektur, DSGVO gegen GoBD, Objektakte für den Verwalterwechsel |
| [`tests/aufbereitung.test.ts`](../tests/aufbereitung.test.ts) | 15 | Seitentext, Textlayer-Erkennung, Vorrendern, Formaterkennung, Aufbereitung |
| [`tests/belegliste.test.ts`](../tests/belegliste.test.ts) | 29 | Feed, Akte eines Objekts, Filter, Volltext, Die Sichtbarkeitsgrenze -- in jeder Sicht, Feed oder Suche, Der archivierte Beleg bleibt auffindbar |
| [`tests/einsicht.test.ts`](../tests/einsicht.test.ts) | 43 | Token, Der Ablauf ist hart, Mietersicht -- gerechnet, nicht freigegeben, Eigentuemer und Beirat, Was nie nach draussen geht, Der Umfang wird je Aufruf geprueft, Die Datei selbst, Zugriffsprotokoll, Die Grenze im Haus, Rechte, Link per Mail |
| [`tests/engine.test.ts`](../tests/engine.test.ts) | 15 | Kontext, Lauf, Betragsgrenze, Paralleler Block, Verzweigung, Sperre vor der Zahlung, Simulation |
| [`tests/extraktion.test.ts`](../tests/extraktion.test.ts) | 27 | ZUGFeRD: XML lesen, Vertrauen und Ampel, Antwort eines Modells lesen, Uebernahme in die Datenbank, Aufbereitung mit Erkennung, Betraege lesen |
| [`tests/ingest.test.ts`](../tests/ingest.test.ts) | 8 | Aufnahme, Dublettenpruefung |
| [`tests/kette.test.ts`](../tests/kette.test.ts) | 4 | Vom Eingang bis zur ersten Aufgabe |
| [`tests/konfiguration.test.ts`](../tests/konfiguration.test.ts) | 20 | Recht am Baukasten, Entwurf, Bausteine bearbeiten, Aktivieren, Simulation |
| [`tests/kontierung.test.ts`](../tests/kontierung.test.ts) | 30 | Kontierungsstand, Vorschlaege aus dem Konto, Kontenrahmen, Rest uebernehmen, Summenzwang blockiert die Stufe, Pruefmeldung, Paragraf 35a, Mandanten- und Objektgrenze |
| [`tests/lernen.test.ts`](../tests/lernen.test.ts) | 15 | Normalisieren, Kandidaten aus dem Text, Zuordnung aus gelernten Merkmalen, Mandantengrenze, Korrektur, Nachlauf |
| [`tests/mahnung.test.ts`](../tests/mahnung.test.ts) | 8 | Mahnung ohne Rechnung, Mahnung zu einer laufenden Rechnung, Mahnung zu einer erledigten Rechnung, Mahnung zu einer Rechnung in Klaerung, Verkettung |
| [`tests/mietersicht.test.ts`](../tests/mietersicht.test.ts) | 13 | Mietersicht, Umlageflag, Summenzwang |
| [`tests/nebenlauf.test.ts`](../tests/nebenlauf.test.ts) | 25 | Wartecontainer, Warten beenden, Faelligkeit, Gewaehrleistung, Erneuerung haelt die Kette, Die Sichtbarkeitsgrenze |
| [`tests/plausibilitaet.test.ts`](../tests/plausibilitaet.test.ts) | 20 | Die Gesamtampel, IBAN gegen den bekannten Kreditor, Dublette, Betragsprobe, Pflichtangaben nach Paragraf 14 UStG, Kreditor, Harte Befunde halten an, Erneutes Pruefen |
| [`tests/postausgang.test.ts`](../tests/postausgang.test.ts) | 33 | Platzhalter, Vorlagen im Bestand, Ausgang anlegen, Senden, Einrichtung, Die Mandantengrenze, Flüchtige Einträge |
| [`tests/postfach.test.ts`](../tests/postfach.test.ts) | 18 | Persoenliches Postfach, Uebergabe zwischen den Rollen, Moegliche Stempel, Stempeln |
| [`tests/rls.test.ts`](../tests/rls.test.ts) | 24 | Mandantentrennung, Objektzustaendigkeit, Rechte, Spezialgebiet, Stempelereignisse, Klaerung |
| [`tests/stapel.test.ts`](../tests/stapel.test.ts) | 28 | Trennblatt erkennen, Gruppieren, Stapel aufnehmen, Trennung korrigieren, Uebernehmen, Verwerfen, Die Mandantengrenze, Ein Stapel ohne Trennblatt |
| [`tests/vertretung.test.ts`](../tests/vertretung.test.ts) | 15 | Vertretung anlegen, Wirkung auf neue Aufgaben, Vertretung uebertraegt keine Rechte |
| [`tests/workflow.test.ts`](../tests/workflow.test.ts) | 20 | Blockbaum, Bedingungen: Pruefung, Bedingungen: Auswertung |
| [`tests/zahlung.test.ts`](../tests/zahlung.test.ts) | 33 | Die harte Sperre, Ein Stempel ist nicht dasselbe wie ein gueltiger Stempel, Uebergabe, Lastschrift, Eigenanteil bei Selbstbeteiligung, Stempeln an der Zahlungsstufe, Exportzeile, Sichtbarkeit |

## Architekturentscheidungen

| Entscheidung | Stand |
|---|---|
| [0001 · PDF-Bibliothek: pdfjs-dist statt pdfium](adr/0001-pdf-bibliothek.md) | angenommen |
| [0002 · Workflow-Modell: Blockstruktur, Bedingungen, Delegation](adr/0002-workflow-modell.md) | angenommen |
| [0003 · Erkennung: strukturierte Rechnung zuerst, Modell nur auf Ansage](adr/0003-erkennung.md) | angenommen |
| [ADR 0004 — Anmeldung über Entra ID, Sitzung in Postgres](adr/0004-anmeldung.md) | unbekannt |

## Im Quelltext markierte offene Stellen

| Fundstelle |
|---|
| [`src/worker/aufbereitung.ts:178`](../src/worker/aufbereitung.ts) |
| [`src/workflow/engine.ts:92`](../src/workflow/engine.ts) |
| [`src/workflow/engine.ts:188`](../src/workflow/engine.ts) |
