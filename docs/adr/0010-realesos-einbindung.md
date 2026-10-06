# ADR 0010: Einbindung in RealesOS — Gegenüberstellung und Wegentscheidung

**Status:** angenommen, 06.10.2026 — Weg B, deutsche Bezeichner bleiben, Lieferanten aus `business_partners`

## Kontext

Am 06.10.2026 kam das Übergabepaket der Hauptanwendung **RealesOS**
(Repository `planner-pro-abm`, Commit `9b37d25e`), abgelegt unter
[docs/realesos/](../realesos/). Das DMS soll dort als Untermodul oder
Add-on laufen. Das Paket enthält eine verbindliche Bauvorschrift
([vorgaben.md](../realesos/vorgaben.md)), ein Übergabe-Manifest
([INTEGRATION.md](../realesos/INTEGRATION.md)), das `public`-Schema von
RealesOS (28 Tabellen, Struktur ohne Daten), eine Startmigration für ein
Schema `dms` und einen Schnappschuss der UI-Bausteine.

Die Vorschrift beschreibt nicht eine Schnittstelle, sondern **wie das DMS
gebaut sein muss**. Das heutige DMS ist nach einem anderen Konzept gebaut
([docs/konzept.md](../konzept.md)) und steht an den meisten Stellen quer
dazu. Dieses ADR stellt beides gegenüber und benennt die Wege.

## Gegenüberstellung

| Ebene | RealesOS-Vorgabe | DMS heute | Abstand |
|---|---|---|---|
| Oberfläche | React 18 SPA mit Vite, React Router, TanStack Query, React Hook Form + Zod, shadcn-Design-System, `PageLayout`/`UnifiedDialog`; Daten direkt über supabase-js | Next.js 16, React 19, Server-Komponenten, 17 Server-Aktionen, 57 Seitenbausteine, eigenes Stilsystem | **vollständig verschieden** |
| Serverlogik | Edge Functions (Deno), Service-Role-Client, `verifyUserAuth` | Node-Prozesse: Next-Server und ein eigener **Worker** (OCR, Rendern, Extraktion, Barcode, pg-boss, Mailversand, Objektsperre) | **kein Gegenstück** — Deno-Functions können keine minutenlange OCR fahren |
| Datenbank-Schema | Schema `dms`, englische Plural-Namen (`incoming_invoices`), `tenant_id → public.tenants`, Pflichtspalten `created_at`/`updated_at`, Geld als `BIGINT` in Cent | Schemata `public` und `app`, deutsche Namen (`dokument`, `aufgabe`), eigene `mandant`/`benutzer`, Geld als `numeric` | **Umbenennung und Umhängen aller 69 Migrationen** |
| Identität | `auth.uid()` → `public.profiles.tenant_id`; Rollen `admin`/`mitarbeiter` über `has_role`; Feinrechte `user_has_permission` | eigene Sitzung in Postgres (Entra ID), `app.mein_benutzer()` liest bereits auch den Supabase-JWT; eigenes Rollenmodell mit 11 Rechten, Objektzuständigkeit, Stempelrechten, Notfallzugriff | **verschiedene Rechtemodelle**; der JWT-Rückfall ist der Anknüpfungspunkt |
| Zeilenrechte | eine Policy je Operation, `(select auth.uid())`, kein Lizenzcheck | 204 Policies, 129 security-definer-Funktionen, 31 Trigger, gemessen gegen 1 Mio. Belege | **Bauart gleich, Inhalt verschieden** |
| Stammdaten | nur lesen aus `public.objects`, `units`, `persons`, `business_partners` (`ON DELETE SET NULL` + Momentaufnahme) | eigene `objekt`, `einheit`, `person`, `kreditor` mit `externe_id`/`sync_quelle`/`sync_stand` (Adapterschicht, Konzept) | **vorbereitet**: Spiegeln statt führen |
| Dateiablage | Supabase-Bucket `dms-files`, Signed URLs, keine UPDATE/DELETE-Policy | S3 mit **Object Lock** (Compliance), Fassungen, gemessen gegen MinIO (ADR 0006) | Supabase Storage kennt keine Objektsperre — **schwächere Unveränderbarkeit** |
| GoBD-Nachweis | `dms.events` (unveränderbares Protokoll), Trigger gegen UPDATE/DELETE | Hash-Kette über `stempel_ereignis`, Objektsperre, erzeugte Verfahrensdokumentation (drei Säulen) | DMS geht weiter; Protokoll ist Teilmenge |
| Pakete | nur, was RealesOS hat; neue nur nach Freigabe | pg-boss, pdfjs (haben sie), pdf-lib (haben sie), tesseract.js, sharp, zxing-wasm, embedded-postgres, Ollama-Anbindung | **tesseract, sharp, zxing, pg-boss** wären Anträge |
| KI-Auslese | erst nach Entscheidung E-3; Muster „KI schlägt vor, Mensch bestätigt" | Regeln + Ollama/Bedrock hinter Schnittstelle; Felder tragen Vertrauen und Quelle; Mensch bestätigt über Nachtragen | **Muster passt**, Technik (Worker statt Edge) nicht |
| Sprache im Code | Englisch | Deutsch durchgängig (Konvention in CLAUDE.md) | gegensätzliche Konvention |
| Arbeitsweise | „ein Schritt, dann Freigabe" bei Schema, RLS, Auth, Aufbewahrung | autonome Weiterentwicklung mit Rückfrage nur bei kritischen Fragen | gegensätzlich |

Was **passt**, ohne dass jemand nachgibt: Postgres mit RLS als
Sicherheitsgrenze, handgeschriebene Migrationen, security-definer-Funktionen
mit eigener Prüfung, Unveränderbarkeit per Trigger, Originale nie
überschreiben, E-Rechnung mit XML als Original, Aufbewahrung je Belegart
konfigurierbar, Sperrvermerk statt Löschung, Mandantentrennung in jeder
Abfrage. Die fachlichen Regeln des DMS (Summenzwang, Freigabe-Hash, harte
Befunde, Klärung, Stempel als Ereignisse, Nebenläufe als Konfiguration)
widersprechen der Vorschrift nirgends — sie fehlen dort nur.

## Die drei Wege

**A — Neubau nach Vorschrift.** Das DMS wird als Teil des RealesOS-Stacks
neu geschrieben: Seiten als React-SPA mit deren Bausteinen, Schema `dms` auf
Englisch, Logik in Edge Functions, Dateien im Bucket. Übernommen werden
Fachwissen, Regeln und Datenbank-Bauweise; Oberfläche und Worker sind
verloren. OCR, Rendern und Extraktion brauchen eine neue Heimat (Browser
für das Rendern, Drittdienst oder eigener Server für OCR). Aufwand: Wochen
bis Monate; das heutige DMS bleibt so lange stehen.

**B — Datenbank anpassen, Oberfläche und Worker vorerst behalten.** Schema
`dms` mit `tenant_id` und `auth.uid()`-Rechten, Stammdaten aus `public`
gespiegelt (die Adapterschicht war dafür gedacht), alle 69 Migrationen in
eine neue Grundmigration überführt. Die Next.js-Oberfläche läuft als eigene
Anwendung mit Anmeldung über das Supabase-Token und wird aus RealesOS
verlinkt; der Worker läuft als eigener Container. Danach Seite für Seite in
die SPA portieren, soweit es sich lohnt. Braucht **schriftliche Ausnahmen**
nach § 14 der Vorschrift: Stack der Oberfläche, Worker, S3 mit Object Lock,
vier Pakete, Codesprache. Aufwand für die Datenbank: ein bis zwei Wochen;
die Oberfläche liefert ab Tag eins weiter.

**C — Eigenständig bleiben, nur verbinden.** Das DMS bleibt wie es ist;
Verbindung über Stammdaten-Sync (Objekte, Einheiten, Personen,
Geschäftspartner aus `public` nach `objekt`, `einheit`, `person`,
`kreditor`), Anmeldung über das Supabase-Token, Link aus der Sidebar. Kein
Schema `dms`, keine gemeinsame Datenbank zwingend. Schnellster Weg, aber
kein „Modul" im Sinne der Vorschrift — ein Add-on als eigene Anwendung.

## Empfehlung

**B.** Die Vorschrift ist in der Datenbank am strengsten und am klarsten,
und dort liegt zugleich der Wert des DMS. Eine Datenbank, die nach
RealesOS-Regeln gebaut ist, lässt beide Oberflächen zu — die heutige sofort,
die portierte später. Die Oberfläche nach Vorschrift neu zu bauen, bevor
die Datenbank steht, hieße zweimal bauen.

Was B voraussetzt, bevor eine Zeile geändert wird:

1. Entscheidung des Eigentümers (dieses ADR).
2. Schriftliche Ausnahmen in `docs/realesos/INTEGRATION.md` § 14: Oberfläche
   (Next.js, Übergang), Worker (eigener Dienst), Objektspeicher mit Object
   Lock (statt Bucket, weil GoBD), Pakete, Codesprache.
3. Antwort auf E-2 (Lieferanten in `persons` oder `business_partners`) und
   E-3 (KI-Auslese), weil beides das Schema prägt.

## Entscheidung (06.10.2026)

Der Eigentümer beider Anwendungen hat entschieden:

1. **Weg B.** Die Datenbank folgt der Vorschrift (Schema `dms`, `tenant_id`
   auf `public.tenants`, Identität über `auth.uid()`, Stammdaten aus
   `public` gespiegelt). Oberfläche und Worker bleiben vorerst eigene
   Dienste; Ausnahmen stehen in [INTEGRATION.md § 14](../realesos/INTEGRATION.md).
2. **Deutsche Bezeichner bleiben.** Nur das Schema heißt `dms`. Tabellen,
   Spalten, Funktionen und Code bleiben deutsch — als Abweichung eingetragen.
   Die Spalte `mandant_id` ist das deutsche `tenant_id` und zeigt auf
   `public.tenants(id)`.
3. **Lieferanten kommen aus `public.business_partners`** (E-2). IBAN und
   USt-IdNr. hat RealesOS dort nicht; sie bleiben im DMS
   (`kreditor_bankverbindung`, `kreditor.ust_id`), weil der Betrugsschutz
   darauf steht.

## Umsetzung in fünf Schritten

Die 69 bestehenden Migrationen lassen sich nicht verschieben: 129 Funktionen
rufen einander als `app.…` auf, und ein `alter schema` ändert Funktionstexte
nicht. Deshalb wird aus dem heutigen Schema **eine neue Grundmigration**
erzeugt (pg_dump der Struktur, mechanisch umgeschrieben), und die alten
Migrationen werden Geschichte. Die Vorschrift will ohnehin neue Zeitstempel.

1. **Grundlage lokal:** Das RealesOS-`public`-Schema als erste Migration
   (`docs/realesos/realesos_public_baseline.sql`), dazu die Startmigration
   `create_dms_schema` aus dem Paket. Seed legt `tenants`, `profiles`,
   `user_roles` an statt `mandant` und `benutzer`.
2. **Schema `dms`:** alle DMS-Tabellen und alle Funktionen (`app.` → `dms.`),
   `search_path` der Rolle `dms_app` auf `dms, public`. Im Code ein
   mechanischer Tausch `app.` → `dms.`.
3. **Mandant und Benutzer:** `mandant` entfällt, `mandant_id` zeigt auf
   `public.tenants`; `benutzer` bleibt als DMS-Benutzerdatensatz (Rechte,
   Stempelrechte, Zuständigkeiten) mit `id = auth.users.id = profiles.id`;
   `dms.mein_mandant()` liest die Sitzung des Next-Servers oder
   `public.get_user_tenant_id(auth.uid())`.
4. **Stammdaten spiegeln:** `objekt` ← `objects`, `einheit` ← `units`,
   `person` ← `persons`, `kreditor` ← `business_partners`, gleiche
   Kennungen, über die vorhandene Adapterschicht (`externe_id`, `sync_quelle`,
   `sync_stand`); ein security-definer-Durchgang im Worker und auf Abruf.
   Gelöscht wird im Spiegel nie — der Beleg überlebt das Objekt.
5. **Anmeldung:** Der Next-Server nimmt das Supabase-Token an und legt daraus
   die serverseitige Sitzung an; Entra bleibt als zweiter Weg.

Jeder Schritt endet mit grüner Testsuite; die Tests laufen gegen die leichte
Datenbank mit RealesOS-Grundlage.

## Was dieses ADR nicht entscheidet

Ob die deutschen Bezeichner bleiben. Die Vorschrift verlangt Englisch; das
DMS ist durchgängig deutsch, bis in Tabellen- und Funktionsnamen. Eine
Umbenennung ist mechanisch, aber groß (69 Migrationen, 187 Quelldateien,
Tests, Handbuch) und berührt die Hash-Kette nicht. Das entscheidet der
Eigentümer mit Weg B zusammen.
