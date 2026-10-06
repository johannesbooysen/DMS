# DMS-Zusatzmodul — Vorgaben für Claude Code

> **Für wen:** Claude-Code-Sessions im separaten DMS-Repository und den Entwickler, der dort arbeitet.
> **Ablage im DMS-Repo:** als `CLAUDE.md` im Root oder per `@docs/realesos-vorgaben.md`-Import aus der dortigen `CLAUDE.md`.
> **Quelle:** RealesOS-Repository (`planner-pro-abm`), Stand 2026-10-06. Alle Pfade, Tabellen und Versionen sind dort verifiziert.
> **Vorrang:** Diese Vorgaben gehen eigenen Gewohnheiten, Plugins und Skills vor. Abweichungen nur mit schriftlicher Freigabe des RealesOS-Maintainers; jede Abweichung wird in `INTEGRATION.md` (§ 12) festgehalten.
> **Pflege:** Änderungen an dieser Datei macht ausschließlich RealesOS. Gefundene Fehler als Schnittstellenwunsch melden (§ 12), nicht lokal korrigieren.

---

## 0. Auftrag und Leitprinzip

Das DMS verwaltet **Dokumente, die nicht in RealesOS entstehen**: Eingangsrechnungen, Belege, Posteingang und Schriftverkehr. Es läuft **neben** dem RealesOS-Coremodul „Dokumente" (`public.documents`), das die selbst erzeugten Dokumente hält (Übergabeprotokolle, Mietverträge, Ausgangsrechnungen). Das DMS ersetzt und verändert davon nichts.

Ziel ist die Einbindung in die RealesOS-Webanwendung und in dasselbe Supabase-Projekt — **entweder als Untermodul** unter einer Überkategorie **oder als Add-on**. Diese Entscheidung ist offen (§ 2) und darf den Code nicht verändern: Sie besteht am Ende aus einer Datenbankzeile und einem Registry-Eintrag (§ 10).

**Leitprinzip: Schreibe jede Zeile so, als läge sie bereits im RealesOS-Repository.** Die Integration soll aus Kopieren und Konfigurieren bestehen, nicht aus Umbauen. Alles, was nur im separaten Repo funktioniert, ist ein Integrationsfehler.

---

## 1. Harte Grenzen — ohne Ausnahme

1. **Keine Verbindung zu RealesOS-Datenbanken** (weder Entwicklungs- noch Produktivinstanz). In der RealesOS-Entwicklungsinstanz liegen Daten echter Kunden. Gearbeitet wird gegen ein eigenes Supabase-Projekt oder einen lokalen Stack mit dem Schema-Snapshot aus § 3.4.
2. **Keine Änderung an Objekten im Schema `public`**: kein `ALTER TABLE public.*`, keine neuen Trigger oder Policies auf `public`-Tabellen, keine geänderten `public`-Funktionen, keine neuen Spalten. Bedarf an `public` wird als Schnittstellenwunsch gemeldet (§ 12) und von RealesOS umgesetzt.
3. **Keine Schreibzugriffe auf `public`-Tabellen** in der ersten Ausbaustufe. Gelesen wird ausschließlich unter RLS mit der Sitzung des angemeldeten Nutzers.
4. **Keine Änderung an RealesOS-Snapshot-Dateien** (§ 3.3) — auch nicht „nur kurz". Lücke im Design-System → Schnittstellenwunsch.
5. **Keine Klartext-Credentials** in Code, Konfiguration, Tests, Commits oder `settings.json`-`allow`-Regeln. Secrets setzt der Maintainer im Supabase-Dashboard; der Code kennt nur ihren Namen.
6. **Keine destruktiven Datenbankoperationen** (`DROP`, `TRUNCATE`, Massen-`UPDATE`/`DELETE`, Datenbank-Reset) ohne ausdrücklichen schriftlichen Auftrag des Menschen.
7. **Keine npm-Pakete**, die nicht in RealesOS enthalten sind, ohne vorherige Freigabe (§ 9.8). Ein fremdes Paket ist ein Integrationsblocker.
8. **Kein `ON DELETE CASCADE`** auf Tabellen mit Belegen oder Schriftverkehr (§ 5.5) — Aufbewahrungspflicht.
9. **Keine hardcodierten Farben, keine eigenen Button-Styles, keine Modul-Sonderlösungen** im UI (§ 9.5).

---

## 2. Offene Entscheidungen — nicht selbst treffen

Diese Punkte entscheidet der RealesOS-Maintainer. Bis dahin: den Code so bauen, dass beide Antworten ohne Umbau möglich sind, und die Frage in `INTEGRATION.md` offen führen.

| # | Frage | Bis zur Entscheidung |
|---|---|---|
| E-1 | Untermodul (unter `verwaltung`) oder Add-on? | Code ohne Verzweigung; Unterschied nur in § 10 |
| E-2 | Wo stehen Lieferanten/Dienstleister führend — `public.persons` oder `public.business_partners`? | Beide Verweise vorsehen (§ 8.2) |
| E-3 | KI-gestützte Auslese von Rechnungen und Briefen — ja oder nein? | Ohne KI bauen; Felder für das Vorschlagsmuster dürfen vorbereitet sein (§ 8.4) |
| E-4 | Sehen externe Rollen (Eigentümer, Beirat, Mieter) DMS-Dokumente im Portal? | Nein — nur `admin` und `mitarbeiter` |
| E-5 | Schnittstelle Eingangsrechnung → Kostenbuchung (`public.cost_entries`) | Nur verknüpfen, nicht schreiben (§ 8.3) |
| E-6 | UI-Name des Moduls und Routenpräfix | Vorläufig `/dms`, Name als Platzhalter |
| E-7 | Eingangskanal E-Mail: eine Adresse je Mandant? Welcher Mail-Dienst? | Muster aus § 7.3, Anbieter offen |

---

## 3. Projektaufbau im separaten Repository

### 3.1 Stack — muss mit RealesOS übereinstimmen

| Paket | Version (RealesOS `package.json`) |
|---|---|
| Node | `24.x` |
| react / react-dom | `^18.3.1` |
| vite | `^6.4.3` |
| typescript | `^5.8.3` |
| react-router-dom | `^7.12.0` |
| @tanstack/react-query | `^5.83.0` |
| react-hook-form / zod / @hookform/resolvers | `^7.61.1` / `^3.25.76` / `^3.10.0` |
| @supabase/supabase-js | `^2.75.0` |
| tailwindcss | `^3.4.17` (shadcn/ui + Radix UI) |
| @tiptap/* | `^3.14.0` |
| date-fns | `^3.6.0` (kein dayjs, kein moment) |
| sonner | `^1.7.4` (Toasts) |
| idb | `^8.0.3` |
| pdf-lib / pdfjs-dist | vorhanden — für PDF-Verarbeitung zuerst diese nutzen |
| vitest / jsdom | `^4.1.10` / `^29.0.1` |
| @testing-library/react / jest-dom | `^16.3.2` / `^6.9.1` |
| @playwright/test | `^1.49.1` |

### 3.2 TypeScript und Alias

- Alias `@/*` → `./src/*`, identisch zu RealesOS.
- RealesOS kompiliert mit `strict: false`. DMS-Code muss dort fehlerfrei kompilieren; **strenger schreiben ist erwünscht**: kein `any`, kein `as any` auf dem Supabase-Client, keine `@ts-ignore`.
- `npm run build` prüft keine Typen. Typprüfung: `npx tsc -p tsconfig.app.json --noEmit`.

### 3.3 Ordnerstruktur — spiegelt RealesOS

```
src/
  pages/dms/                 Seiten (PascalCase, eine Datei je Seite)
  components/dms/            Fachkomponenten des DMS (PascalCase)
  hooks/use<Entity>.ts       Daten-Hooks, z. B. useIncomingInvoices.ts, useInboxItems.ts
  test/dms/                  Tests (*.test.ts / *.test.tsx)
supabase/
  migrations/                Migrationen nach § 5.2
  rollback/                  Rollback-Dateien nach § 5.2
  functions/dms-<name>/      Edge Functions nach § 7
  tests/dms_*.sql            Datenbank-Invarianten- und RLS-Tests (§ 11.2)
INTEGRATION.md               Übergabe-Manifest (§ 12)
```

Es gibt in RealesOS **kein** `src/modules/` oder `src/features/`. Nicht einführen.

**RealesOS-Snapshot (nur lesen, nie ändern).** Liegt im Übergabepaket unter `realesos-snapshot/` an den Originalpfaden und wird ins Repo-Root kopiert. Commit-Stand und vollständige Dateiliste: `realesos-snapshot/SNAPSHOT.md`. Bei der Integration werden diese Dateien durch die echten RealesOS-Dateien ersetzt — jede lokale Änderung ginge verloren oder bräche die Integration. Kern des Snapshots:

- `src/components/ui/**`, `src/components/design-system/**`, `src/components/table/**`, `src/components/icons/**`, `scripts/icons/**`
- `src/components/auth/**`, `src/hooks/useTenant.ts`
- `src/hooks/useTableSort.ts`, `useModuleFilters.ts`, `useTableColumns.ts`, `usePagination.ts`, `useBulkSelection.ts`
- `src/hooks/useObjects.ts`, `useUnits.ts`, `usePersons.ts` (lesend, für Auswahlfelder)
- `src/core/**` (Modul-Lizenz, Rechte, Schreibschutz)
- `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`
- `src/lib/utils.ts`, `tailwind.config.ts`, `src/index.css`, `eslint.guardrails.config.js`, `src/test/setup.ts`
- `supabase/functions/_shared/cors.ts`, `auth.ts`, `permissions.ts`
- dazu alle Dateien, die diese importieren (vollständig aufgelöst, keine offenen Importe)

`referenz/` enthält `package.json`, `tsconfig*.json`, `vite.config.ts`, `components.json`, `postcss.config.js` und `eslint.config.js` aus RealesOS — **abgleichen, nicht blind überschreiben**.

### 3.4 Datenbank-Basis für die Entwicklung

- Eigenes Supabase-Projekt oder lokaler Stack (`supabase start`).
- Darin als erste Migration **`supabase/baseline/00000000000000_realesos_public_baseline.sql`** aus dem Paket: 28 RealesOS-Tabellen (Struktur, keine Daten), die RLS-Hilfsfunktionen `get_user_tenant_id`, `has_role`, `user_has_permission`, `update_updated_at`, 52 Policies, Modulkatalog und Rollenrechte. Enthält einen **Entwicklungs-Ersatz für `get_active_modules`**, der jedes aktive Modul freischaltet — wird bei der Integration nicht übernommen.
- Am Dateiende steht eine Vorlage für Testmandant, Profil und Rolle.
- Testdaten nur synthetisch, nie aus RealesOS kopiert.

### 3.5 Startvorlagen (geprüft)

- `vorlagen/supabase/migrations/20261006120000_create_dms_schema.sql` — Schema `dms`, Grundrechte, Ereignisprotokoll `dms.events` (unveränderbar) mit Schreibfunktion `dms.log_event()`, Bucket `dms-files` mit Policies. Idempotent.
- `vorlagen/supabase/rollback/20261006120000_rollback_create_dms_schema.sql`
- `vorlagen/supabase/tests/dms_rls_isolation.sql` — Mandantentrennung, Rollenrecht, Unveränderbarkeit; Muster für jede weitere Tabelle.
- `vorlagen/supabase/config.toml.snippet` — Freigabe des Schemas `dms` für die API.

Alle vier gegen das Basisschema geprüft; der RLS-Test schlägt nachweislich fehl, wenn die Policy aufgeweicht wird.

---

## 4. Sprache und Namen

- **Code-Identifier, Kommentare, technische Doku: Englisch.** UI-Texte: Deutsch.
- **Fachbegriffe nach RealesOS-Glossar** — keine Synonyme, keine Anglizismen in der UI:
  - **Dokument**: Datei mit Zuordnung zu Objekt/Einheit/Person/Vorgang
  - **Rechnung**: Eingangsrechnung an die WEG bzw. den Vermieter
  - **Beleg**: Quittung oder Nachweis, häufig Anhang einer Rechnung
  - **Vorgang**: Geschäftsvorfall (Reparatur, Mängelmeldung, Anfrage, Beschluss-Vorbereitung) — **belegt**, nicht für einzelne Posteingangs-Einträge verwenden
  - **Aufgabe**: Tätigkeit mit Verantwortlichem und Frist · **Ticket**: Vorgang eines Mieters/Eigentümers aus dem Portal
  - **Mandant** heißt im Code `tenant` (`tenant_id`); der Mieter heißt in der UI nie „Tenant"
- **UI-Wörter:** „Anlegen" (nicht Erstellen/Hinzufügen/Neu), „Speichern"/„Abbrechen" (nicht OK/Cancel), „Hochladen" (nicht Upload). In allen externen Bereichen Sie-Form.
- **Neue Begriffe** (z. B. für Posteingang, Eingangskanal, Prüfstatus) nicht improvisieren: als Vorschlag in `INTEGRATION.md` sammeln, RealesOS trägt sie ins Glossar ein.
- **Tabellennamen:** englisch, `snake_case`, Plural. Keine Namen, die mit `public` verwechselbar sind (`documents`, `invoices`, `attachments`, `tasks`) — z. B. `dms.incoming_invoices`, `dms.inbox_items`, `dms.stored_files`.
- **Modulschlüssel:** `dms` (vorläufig, § 2 E-6). **Rechte-Schlüssel:** `UPPER_SNAKE` nach RealesOS-Muster `<VERB>_<OBJEKT>`, z. B. `VIEW_INBOX`, `MANAGE_INBOX`, `APPROVE_INCOMING_INVOICES`.
- **Query-Keys:** `["dms_<entity>", tenant?.id, …]`. **localStorage-Keys** der Tabellen: `"dms-<view>-filters"`, `"dms-<view>-sort"`, `"dms-<view>-pageSize"`, `"dms-<view>-view"`.

---

## 5. Datenbank — Schema `dms`

### 5.1 Schema einrichten

`dms` wird das **erste Schema neben `public`** in RealesOS. Daraus folgt:

```sql
CREATE SCHEMA IF NOT EXISTS dms;
GRANT USAGE ON SCHEMA dms TO authenticated, service_role;
-- je Tabelle explizit, kein GRANT an anon:
GRANT SELECT, INSERT, UPDATE, DELETE ON dms.<table> TO authenticated;
GRANT ALL ON dms.<table> TO service_role;
```

- Die REST-API muss `dms` ausliefern. Lokal: `[api] schemas = ["public", "graphql_public", "dms"]` in `supabase/config.toml`. In RealesOS setzt der Maintainer das bei der Integration (Konfiguration plus Projekteinstellung) — im DMS-Repo nur dokumentieren.
- Client-Zugriff: `supabase.schema("dms").from("<table>")`.
- Typen: `npx supabase gen types typescript --project-id <eigenes-projekt> --schema public --schema dms > src/integrations/supabase/types.ts`. Bei der Integration erzeugt RealesOS die Datei neu.

### 5.2 Migrationen — Hauskonvention RealesOS

- **Dateiname:** `supabase/migrations/YYYYMMDDHHMMSS_<verb>_<snake_name>.sql`, Zeitstempel aus `date -u +%Y%m%d%H%M%S`. Nie die Form `<ts>_<uuid>.sql`.
- **Kopfblock** als SQL-Kommentar: Titel und Zweck, `Spec:`, `Rollback:`, dann die Begründung — welches Muster verwendet wurde, bewusste Abweichungen, was die Migration ausdrücklich **nicht** tut.
- **Idempotent:** `CREATE … IF NOT EXISTS`; `ADD CONSTRAINT` in `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
- **Pflichtspalten jeder Tabelle:**
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE …` (Löschregel nach § 5.5)
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - **Auch dann `tenant_id`, wenn der Mandant über einen Elternsatz ableitbar wäre** (RealesOS-`units` hat keine eigene `tenant_id` — nicht nachahmen).
- **Index auf jeden Fremdschlüssel**, Name `idx_<table>_<column>`. **`COMMENT ON`** für jede Tabelle und jede nicht selbsterklärende Spalte.
- **`updated_at`-Trigger:** `BEFORE UPDATE … FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();` — nicht `update_updated_at_column()` oder `set_updated_at()` (Altlasten).
- **Geld:** `BIGINT` in Cent mit `CHECK`, nie `NUMERIC`, nie Float.
- **Rollback-Datei** ab Risikoklasse M (§ 13.2): `supabase/rollback/<gleicher Zeitstempel>_rollback_<name>.sql` mit Vorab-Prüfabfragen, umgekehrter Abhängigkeitsreihenfolge und `IF EXISTS`.
- **Zeitstempel werden bei der Integration neu vergeben.** Migrationen dürfen daher nur von `public`-Objekten des Snapshots abhängen und nicht von einer bestimmten Einordnung zwischen RealesOS-Migrationen.

### 5.3 RLS — Pflicht auf jeder Tabelle

```sql
ALTER TABLE dms.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view <table> in own tenant" ON dms.<table>
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id((select auth.uid())));

CREATE POLICY "Admins and Mitarbeiter can insert <table>" ON dms.<table>
  FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id((select auth.uid()))
    AND (public.has_role((select auth.uid()), tenant_id, 'admin'::app_role)
      OR public.has_role((select auth.uid()), tenant_id, 'mitarbeiter'::app_role)));
-- UPDATE: dieselbe Bedingung in USING und WITH CHECK
-- DELETE: nur wo fachlich zulässig (§ 5.6, § 8.5)
```

- Immer `(select auth.uid())`, nie nacktes `auth.uid()` (Performance).
- Eine permissive Policy je Operation; `WITH CHECK` immer ausschreiben.
- `app_role`-Werte: `admin`, `mitarbeiter`, `beirat`, `eigentuemer`, `hausgeist`, `facility`. **`mieter` existiert nicht als DB-Rolle.**
- Feinere Rechte zusätzlich über `public.user_has_permission((select auth.uid()), tenant_id, '<KEY>')` (§ 10.3).
- **Keine Lizenzprüfung in RLS.** Die Modul-Lizenz ist in RealesOS eine Vertragsgrenze, keine Sicherheitsgrenze; ein abgeschaltetes Modul darf den Mandanten nicht von seinen eigenen Daten aussperren (Schreibschutz statt Aussperren, § 9.7).

### 5.4 Funktionen mit `SECURITY DEFINER`

- `SET search_path = public` ist Pflicht; `dms`-Objekte im Funktionskörper immer voll qualifizieren (`dms.<table>`).
- Direkt danach: `REVOKE EXECUTE ON FUNCTION dms.<fn>(<vollständige Argumenttypen>) FROM PUBLIC, anon, authenticated;` und `GRANT EXECUTE … TO service_role;`.
- Darf `authenticated` sie aufrufen, prüft die Funktion Mandant und Rolle **selbst** (`get_user_tenant_id`, `has_role`) und gibt dann gezielt `authenticated` frei.
- `SELECT … FOR UPDATE` vor jeder Prüfung, die auf einem Zählerstand oder Saldo beruht.

### 5.5 Beziehungen zu `public` und Löschregeln

- **Verweise zeigen von `dms` nach `public`, nie umgekehrt.** `public` bekommt keine Spalte, die auf `dms` zeigt.
- **Zuordnungen** (`object_id`, `unit_id`, `person_id`, `business_partner_id` …) als `REFERENCES public.<table>(id) ON DELETE SET NULL`, dazu eine **Momentaufnahme** der Bezeichnung zum Zeitpunkt der Zuordnung (z. B. `object_label_snapshot TEXT`). So überlebt der Beleg das Löschen des Objekts nachvollziehbar, und RealesOS wird beim Löschen eines Objekts nicht blockiert.
- **`tenant_id` auf Tabellen mit Belegen oder Schriftverkehr: `ON DELETE RESTRICT`** mit Begründung im Kopfblock (§ 147 AO). Das ist eine bewusste Abweichung vom RealesOS-Standard `CASCADE`. Die Mandantenlöschung in RealesOS (`public.delete_tenant_completely()`) arbeitet mit einer festen Tabellenliste; den Lösch-Wächter auf `public.tenants` ergänzt RealesOS bei der Integration (Vorbild dort: `prevent_tenant_delete_with_commission_history`). Im DMS-Repo nur in `INTEGRATION.md` je Tabelle angeben: Löschregel und Begründung.
- Reine Hilfstabellen ohne Aufbewahrungspflicht (z. B. Ansichtseinstellungen) dürfen `ON DELETE CASCADE` verwenden.

### 5.6 Unveränderbarkeit und Protokoll (GoBD)

- **Das Original ist unveränderbar**: Datei, Eingangszeitpunkt, Eingangskanal, `sha256`-Prüfsumme. Korrekturen erzeugen eine neue Version, nie ein Überschreiben.
- **Ereignisprotokoll `dms.events`** (wer, wann, was, vorher/nachher) — fertig in der Startvorlage (§ 3.5). Jede Änderung an DMS-Daten schreibt über `dms.log_event(p_tenant_id, p_entity_type, p_entity_id, p_action, p_payload)` einen Eintrag. Das Muster dahinter, für weitere nur-anhängende Tabellen:
  - Schreiben ausschließlich über `SECURITY DEFINER`-Funktionen oder Trigger; für `authenticated` nur eine `SELECT`-Policy.
  - `BEFORE UPDATE OR DELETE`-Trigger, der mit `RAISE EXCEPTION` abbricht. Erlaubte Zustandswechsel per Vergleich `(to_jsonb(NEW) - '<erlaubte_spalte>') = (to_jsonb(OLD) - '<erlaubte_spalte>')` — so sind auch künftige Spalten automatisch gesperrt.
  - Korrekturen als Gegeneintrag, Idempotenz über einen `UNIQUE`-Schlüssel plus `ON CONFLICT DO NOTHING`.
- `public.audit_events` **nicht** verwenden — die Tabelle ist in RealesOS nicht nur-anhängend.
- Zuordnungen, Prüfstatus und Freigaben dürfen sich ändern, aber jede Änderung erzeugt einen Protokolleintrag.

---

## 6. Dateiablage (Supabase Storage)

- **Eigener privater Bucket** (vorläufig `dms-files`), mit `file_size_limit` und erlaubten MIME-Typen (PDF, XML, gängige Bildformate, ggf. `message/rfc822`).
- **Pfad:** erster Ordner ist immer die `tenant_id`: `{tenant_id}/{yyyy}/{mm}/{uuid}.{ext}`. Originalnamen nur als Metadatum speichern, nie im Pfad.
- **Policies** nach RealesOS-Muster:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('dms-files', 'dms-files', false, <bytes>) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can view dms-files in own tenant" ON storage.objects FOR SELECT
  USING (bucket_id = 'dms-files'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::TEXT);
-- INSERT: dieselbe Bedingung + has_role(admin|mitarbeiter) in WITH CHECK
-- UPDATE/DELETE: keine Policy für authenticated (Originale sind unveränderbar, § 5.6)
```

- **Auslieferung nur über Signed URLs** (`createSignedUrl`/`createSignedUrls`, Gültigkeit 3600 s). **Nie `getPublicUrl`.**
- Hochladen mit `upsert: false`. Ein vorhandenes Objekt wird nie überschrieben.

---

## 7. Edge Functions

### 7.1 Hausmuster

- Ablage `supabase/functions/dms-<name>/index.ts`, Deno, `Deno.serve`.
- Ablauf: `handleCors(req)` → Service-Role-Client → `verifyUserAuth(req, client)` liefert `{ authorized, userId, tenantId }` → bei Bedarf `requirePermission(client, userId, tenantId, "<KEY>")` → Antwort über `jsonResponse` bzw. `errorResponse`. Alle Helfer aus `supabase/functions/_shared/` (Snapshot, nicht ändern).
- **Jede Abfrage filtert ausdrücklich auf `tenant_id`** — der Service-Role-Client umgeht RLS.
- Fehlermeldungen an den Nutzer auf Deutsch. Fehlt ein Secret, früh mit verständlicher Meldung abbrechen.
- Je Function ein Block in `supabase/config.toml`: `[functions.dms-<name>]` mit `verify_jwt = true`. `false` nur für Webhooks, die ein eigenes Geheimnis prüfen — dann mit Kommentar darüber, warum.
- Secrets nur per Namen (`Deno.env.get("…")`); gesetzt werden sie vom Maintainer im Dashboard. Namen in `INTEGRATION.md` auflisten.

### 7.2 Keine Request-Header loggen

Weder bei Erfolg noch bei Fehlern. Logs enthalten keine personenbezogenen Inhalte (Brieftexte, IBAN, Namen).

### 7.3 Eingangskanal E-Mail (Muster, Anbieter offen — § 2 E-7)

- Mandantenbindung über ein **Token je Mandant** in eigener Tabelle (z. B. `dms.inbox_tokens (tenant_id PK, token UUID UNIQUE)`), Vorbild `public.tenant_webhook_tokens`. **Der Mandant kommt ausschließlich aus dem Token, nie aus dem Payload.**
- **Idempotenz:** `UNIQUE (tenant_id, message_id)`; ein zweiter Eingang derselben Nachricht wird verworfen, nicht verdoppelt.
- **Anhänge** in den Bucket (§ 6), jeder Anhang mit Prüfsumme. Liefert der Kanal die Rohnachricht, wird sie als Original (`.eml`) mit abgelegt.
- Größen- und Anzahlgrenzen für Anhänge; Überschreitung wird protokolliert, nicht still verworfen.

---

## 8. Fachliche Vorgaben

### 8.1 E-Rechnung

- Seit 2025 müssen inländische Unternehmen E-Rechnungen empfangen können (§ 14 UStG). Das DMS nimmt **XRechnung (UBL und CII)** und **ZUGFeRD/Factur-X** (PDF/A-3 mit eingebettetem XML) an.
- **Die XML-Datei ist das rechtlich maßgebliche Original** und wird unverändert archiviert. Eine PDF-Darstellung ist abgeleitet.
- RealesOS hat bisher nur die Erzeugerseite (XRechnung UBL), **keinen Parser**. Ein XML-Parser ist eine neue Abhängigkeit → Freigabe nach § 9.8. Für eingebettete Dateien in PDFs zuerst `pdfjs-dist`/`pdf-lib` prüfen (beide vorhanden).

### 8.2 Zuordnung zu RealesOS-Stammdaten

- Zuordnung an Objekt, Einheit und Person; bei Bedarf an Mietverhältnis (`unit_occupancies`) oder Eigentum (`unit_ownerships`). Tabellen und Fallstricke: Anhang A.
- **Absender** können in `public.persons` (auch Firmen, mit IBAN und Steuernummer) **oder** in `public.business_partners` (ohne Bankverbindung und Steuernummer) stehen. Bis E-2 entschieden ist: beide Verweise vorsehen (`sender_person_id` **oder** `sender_business_partner_id`, per `CHECK` höchstens einer) und beim Zuordnen in beiden suchen.
- **Personen haben in RealesOS keinen fachlichen Unique-Schlüssel, und Dubletten kommen vor.** Abgleich nie automatisch über Name oder E-Mail festschreiben — Treffer als Vorschlag zeigen, der Nutzer bestätigt.
- Löst ein Eingang einen Vorgang aus, sind die Ziele `public.tasks` (Aufgaben), `public.facility_tickets` (Tickets) und `public.service_orders` (Aufträge) — **verknüpfen, nicht anlegen** (§ 1 Nr. 3), bis RealesOS eine Schnittstelle bereitstellt.

### 8.3 Eingangsrechnung und Kostenbuchung

- Kostenbuchungen je Objekt stehen in `public.cost_entries` (Beträge dort in Euro, `numeric`; `vendor_name` ist Freitext; `document_id` zeigt auf `public.documents`).
- Das DMS **schreibt nicht** in `cost_entries`. Es hält seine Rechnungsdaten in `dms` und verknüpft optional per `cost_entry_id → public.cost_entries(id) ON DELETE SET NULL`.
- `key_definition_id` (Umlageschlüssel) und `billing_period_id` gehören zu einem RealesOS-Bereich im Umbau — nicht als stabile Schnittstelle verwenden.
- Den Bedarf „Rechnung freigeben → Kostenbuchung anlegen" als Schnittstellenwunsch formulieren (gewünschte RPC mit Parametern und Rückgabe). RealesOS baut sie.

### 8.4 KI-Auslese (nur nach Freigabe — § 2 E-3)

Wenn freigegeben, gilt das RealesOS-Muster **„KI schlägt vor, Mensch bestätigt"**:
- Auslese in einer Edge Function (Secret `ANTHROPIC_API_KEY`), Ergebnis als `ai_extracted_json JSONB`, `ai_confidence SMALLINT` (0–100), `ai_extracted BOOLEAN`, `manually_verified BOOLEAN`.
- Speichern, Freigeben oder Verbuchen bleibt gesperrt, solange `ai_extracted AND NOT manually_verified`.
- Ausgelesene IBANs per Mod-97 prüfen; bei Fehlschlag Konfidenz deckeln und das Feld markieren.
- Vor dem ersten Einsatz Datenschutzprüfung (Weitergabe an Drittanbieter, Auftragsverarbeitung) durch RealesOS.

### 8.5 Aufbewahrung, Löschung, Datenschutz

- Aufbewahrungsfristen nach § 147 Abs. 3 AO (Stand 2025: Buchungsbelege 8 Jahre, Handels- und Geschäftsbriefe 6 Jahre) **je Dokumentart konfigurierbar**, nicht im Code festschreiben. Fristbeginn mit Ablauf des Kalenderjahres.
- Vor Fristablauf **keine Löschung** — auch nicht auf DSGVO-Anfrage; stattdessen Sperrvermerk (Einschränkung der Verarbeitung) und Protokolleintrag.
- Löschung nach Fristablauf nur als eigener, protokollierter Vorgang mit Freigabe; nie automatisch ohne Bestätigung.
- Schriftverkehr enthält personenbezogene Daten: Zugriff nur für interne Rollen (§ 2 E-4), Anzeige nur der für die Aufgabe nötigen Felder.

---

## 9. Frontend

### 9.1 Daten-Hooks

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

export function useInboxItems() {
  const { data: tenant } = useTenant();
  return useQuery({
    queryKey: ["dms_inbox_items", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error("No tenant ID");
      const { data, error } = await supabase
        .schema("dms")
        .from("inbox_items")
        .select("*")
        .eq("tenant_id", tenant.id);
      if (error) throw error;
      return data;
    },
    enabled: !!tenant?.id,
  });
}

// Mutation: Toasts kommen aus dem Hook, nicht aus dem Dialog
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ["dms_inbox_items"] });
  toast.success("Eingang zugeordnet");
},
onError: (error: Error) => {
  toast.error("Zuordnung fehlgeschlagen", { description: error.message });
},
```

- Mandant über `useTenant()`, Nutzer über `useAuth()` aus `@/components/auth`. **Nie `supabase.auth.getUser()` in Hooks.**
- Auswahl von Objekt, Einheit, Person über die vorhandenen Bausteine: `ObjectCombobox`, `UnitCombobox`, `PersonCombobox`, `MultiSelectPersons` (`@/components/ui/object-combobox` usw.) und die Hooks `useObjects`, `useUnits`, `usePersons`. Nicht nachbauen.
- Abfragen filtern zusätzlich zur RLS ausdrücklich auf `tenant_id`.
- Toasts ausschließlich über `sonner` (nicht `@/hooks/use-toast`).
- Typen aus `@/integrations/supabase/types` (`Database["dms"]["Tables"]["…"]["Row"]`), kein `as any`.

### 9.2 Seiten

- `PageLayout` mit `icon`, `title`, `description`, `actions` — **genau eine Hauptaktion**.
- **Fünf Zustände:** laden (`LoadingState variant="table"|"grid"|"detail"|"list"`), Fehler (`ErrorState compact onRetry`), leer (`EmptyState`), gefiltert leer (eigener Text mit Aktion „Filter zurücksetzen" — nie derselbe Text wie leer), Daten.
- Import der Bausteine aus `@/components/design-system`; Ausnahmen: `@/components/design-system/ColumnHeaderFilter`, `SortableTableHeader` aus `@/components/table`.
- Referenzseiten in RealesOS: `src/pages/Units.tsx` (kanonische Listenseite), `src/pages/orders/OrdersList.tsx` (Tabellen-Pilot).

### 9.3 Tabellen-Standard

1. Abgeleitete Anzeige-Felder (`_objectName` …) per `useMemo` **vor** `useModuleFilters` anreichern.
2. `useModuleFilters` mit `storageKey`; Filter als Arrays, immer `setArrayFilter`.
3. `useTableSort<T>` mit eigenem Sortierwert-Extraktor; Statusreihenfolge nach Arbeitsablauf, nicht alphabetisch.
4. `usePagination(sorted, { initialPageSize: 25, storageKey: "dms-<view>-pageSize" })`; die Tabelle rendert die paginierten Daten, direkt darunter `<PaginationBar>`.
5. `SortableTableHeader` auf allen Datenspalten; Spaltenfilter (`ColumnHeaderFilter.MultiSelect` für Aufzählungen, `.Text` für Freitext) **als Kind** im `SortableTableHeader`. Die Aktionsspalte bleibt ein normales `<TableHead>`.
6. `FilterPanel` + `FilterPanelMultiSelect` für Filter ohne Spalte, in beiden Ansichten.
7. `ViewToggle` + `useViewMode("dms-<view>-view")`, Standard Tabelle; in der Kartenansicht `SortDropdown` mit **demselben** Sortier-Hook; Karten aus `DataCard*`.
8. Mehrfachauswahl über `useBulkSelection` + `BulkActionBar`.
9. Löschen/Bestätigen über `DeleteConfirmDialog`/`ConfirmDialog`; Dialog erst im `onSuccess` schließen.
10. `aria-label` an jedem Icon-Button; `TableHeader` mit `sticky top-0 z-10 bg-card`.
11. Keine Schaltflächen ohne Funktion.

### 9.4 Formulare und Dialoge

- **React Hook Form + Zod** (`zodResolver`), Fehlermeldungen auf Deutsch im Schema.
- Pflichtfelder ausschließlich über `<FormLabel required>` — kein manuelles „ *" im Text, kein `required` am Input. `FormControl` verdrahtet `aria-required`, `aria-describedby` und `aria-invalid` selbst; keine eigenen IDs dafür.
- Hilfetexte mit `FormDescription`, `<FormMessage />` an jedem Feld.
- Dialoge über `UnifiedDialog` (`@/components/ui/unified-dialog`). Größen: `sm` (2–3 Felder), `md` (Standard), `lg` (Tabs oder komplexe Formulare), `xl`, `full` nur bei ausdrücklichem Bedarf.
- Fester Footer: „Speichern" rechts, „Abbrechen" links daneben, destruktive Aktion ganz links. Der Footer liegt außerhalb des `<form>` → Button mit `form="<form-id>"`.
- `disabled={isPending}` am Speichern-Button; **Dialog erst im `onSuccess` der Mutation schließen.**
- Formulare im Dialog-Modus `displayMode="content"` mit `<UnsavedChangesGuard when={isDirty} />` gegen Verlust ungespeicherter Änderungen absichern. Den `displayMode` setzt der Code, nie der Nutzer.

### 9.5 Tokens, Buttons, Icons

- **Nur Design-Tokens.** Verboten: Arbitrary-Value-Farben (`bg-[#…]`, `text-[rgb(…)]`), Palette-Klassen (`text-red-500`, `bg-blue-100`), Inline-`style`-Farben.
- **Nur die vorhandenen Button-Varianten:** `default`, `prominent`, `destructive`, `outline`, `secondary`, `ghost`, `subtle`, `link`. Keine eigenen Klassenketten für Buttons.
- Kein `onClick` auf `<Badge>`.
- **Icons ausschließlich aus `@/components/icons`** (Material Symbols, Lucide-kompatible Namen, z. B. `Inbox`, `Receipt`, `FileText`, `Mail`, `ScanLine`). **`lucide-react` ist verboten.** Fehlt ein Icon: Eintrag in `scripts/icons/icon-map.json` vorschlagen (in `INTEGRATION.md`), nicht selbst ein Paket installieren. Größe `h-4 w-4`, Farbe über `text-*`-Tokens.

### 9.6 Responsive und Barrierefreiheit

- **Desktop hat Vorrang**, Mobil/Tablet müssen funktionieren. Mindestbreite 360 px, kein horizontales Scrollen der Seite.
- Unter 1024 px erzwingt `useViewMode` die Kartenansicht; `ViewToggle` nur zeigen, wenn nicht erzwungen.
- Große Dialoge auf Mobilgeräten als Vollbild, nie als Bottom-Sheet.
- Touch-Ziele mindestens 44 px; `100dvh` und `.safe-area-bottom` für feste Footer.

### 9.7 Lizenz, Rechte, Schreibschutz im UI

- Alle Routen des Moduls liegen unter `<ProtectedModuleRoute moduleId="dms" />` (§ 10.2).
- Schreibaktionen respektieren `useModuleWriteAccess()`: Ist das Modul nur lesend aktiv, werden Anlegen/Bearbeiten/Löschen ausgeblendet, die Daten bleiben sichtbar.
- Feinrechte über `useHasPermission("<KEY>")`; jede Aktion prüft `canEdit`/`canDelete`.
- In der ersten Ausbaustufe keine Oberfläche für externe Rollen (§ 2 E-4). Kommt sie später, gilt BFSG/WCAG 2.1 AA mit reduzierter Portal-Oberfläche.

### 9.8 Abhängigkeiten

- Neue npm-Pakete nur nach Freigabe: Name, Version, Zweck, Größe, Lizenz und warum vorhandene Pakete nicht reichen — als Antrag in `INTEGRATION.md`.
- **Ausgeschlossen:** `lucide-react` und andere Icon-Pakete, andere UI-Bibliotheken (MUI, Ant Design, Chakra …), CSS-in-JS, andere State-Bibliotheken (Redux, Zustand …), andere Formular-Bibliotheken, `axios` (stattdessen supabase-js bzw. `fetch`), `dayjs`/`moment`.

---

## 10. Einbindung als Untermodul oder Add-on

### 10.1 Was sich zwischen den beiden Varianten unterscheidet — und was nicht

Die RealesOS-Kundenanwendung liest die Kategorie eines Moduls nicht. Freischaltung und Sidebar hängen nur am Registry-Eintrag und am effektiven Lizenzzustand je Mandant (`public.get_active_modules(p_tenant_id)`). Deshalb:

| | Untermodul | Add-on |
|---|---|---|
| `saas_modules.category` | `'business'` | `'addon'` |
| `saas_modules.parent_module_id` | ID von `verwaltung` | `NULL` |
| Registry `parentId` | `'verwaltung'` | weglassen |
| Sidebar | unter „Verwaltung" | Gruppe „Module" |
| Preis | über die Überkategorie bzw. Planvariante | eigener Preis (`price_monthly`, `pricing_mode`) |
| **DMS-Code, Tabellen, Policies, Routen** | **identisch** | **identisch** |

**Regel:** Im DMS-Code gibt es keine Verzweigung nach Untermodul oder Add-on.

### 10.2 Entwürfe, die das DMS-Repo liefert (in `INTEGRATION.md`, nicht selbst einspielen)

**Registry-Eintrag** für `src/core/config/moduleRegistry.ts`:

```ts
dms: {
  id: 'dms',
  name: '<UI-Name, offen>',
  description: '<ein Satz, was der Nutzer damit tut>',
  icon: Inbox,
  kind: 'module',
  parentId: 'verwaltung',          // nur Variante Untermodul
  defaultEnabled: false,
  coreFeatures: ['objects', 'units', 'persons', 'documents'],
  routes: [
    { path: '/dms', label: '<Label>' },
    // weitere Unterseiten; ab zwei Routen erzeugt RealesOS die Unternavigation selbst
  ],
},
```

**Routen** für `src/App.tsx` (Seiten werden dort mit `lazyRoute` geladen):

```tsx
<Route element={<ProtectedModuleRoute moduleId="dms" />}>
  <Route path="/dms" element={<DmsInbox />} />
  <Route path="/dms/:id" element={<DmsItemDetail />} />
</Route>
```

**Katalog-Migration** nach dem Vorbild der RealesOS-Migration `20260914100600_add_aufmass_module.sql`: Zeile in `public.saas_modules` (`key = 'dms'`, `name`, `category`, `parent_module_id`, `is_core = false`, `is_active = true`) **plus** Zeilen in `public.saas_plan_variant_entitlements` — ohne diese ist das Modul für jeden Mandanten `exclude`. Diese Migration schreibt RealesOS; das DMS-Repo liefert nur die gewünschten Werte.

### 10.3 Rechte

- Neue Rechte-Schlüssel (§ 4) mit Bedeutung und Standardzuordnung je Rolle in `INTEGRATION.md` auflisten.
- RealesOS legt sie per Migration in `public.role_permissions` an (Vorbild `20260823202150_add_data_import_permission.sql`) und ergänzt den TypeScript-Typ `Permission` in `src/core/hooks/useHasPermission.ts`. Im DMS-Repo werden die Schlüssel im Snapshot nur lokal ergänzt und als solche markiert.

---

## 11. Qualitätssicherung

### 11.1 Gates — vor jeder Fertig-Meldung, alle grün

```bash
npm run lint:guardrails                 # RealesOS-Guardrails (Snapshot-Konfiguration)
npx tsc -p tsconfig.app.json --noEmit   # Typen — keine neuen Fehler
npm run build
npm run test                            # Vitest
npm audit --audit-level=high
```

Ergebnis je Kommando in einer Zeile berichten; bei Rot die entscheidende Fehlerzeile.

### 11.2 Tests

- **Unit-Tests** unter `src/test/dms/`. Supabase-Muster: `vi.hoisted` + `vi.mock("@/integrations/supabase/client", …)`, `@/hooks/useTenant` und `sonner` mocken, eigener `createWrapper()` mit `new QueryClient({ defaultOptions: { queries: { retry: false } } })`.
- **Jeder Daten-Hook** hat einen Test für Erfolg, Fehler und fehlenden Mandanten.
- **RLS- und Invarianten-Test je Tabelle** als SQL-Skript `supabase/tests/dms_<bereich>.sql`, in einer Transaktion mit abschließendem `ROLLBACK`. Pflichtfälle:
  1. Nutzer aus Mandant A sieht keine Zeile aus Mandant B (`SELECT` liefert 0).
  2. Nutzer aus Mandant A kann keine Zeile mit `tenant_id` von B anlegen.
  3. Rolle ohne Schreibrecht (z. B. `eigentuemer`) kann nicht schreiben.
  4. Das Ereignisprotokoll und die Originale lassen sich nicht ändern oder löschen (Trigger löst aus).
  5. Storage: Pfad mit fremder `tenant_id` wird abgelehnt.
  Nutzerwechsel im Skript über `SET LOCAL ROLE authenticated;` und `SET LOCAL request.jwt.claims = '{"sub":"<user-uuid>"}';`.
- **E2E** (Playwright, `e2e/`) optional, gegen das eigene Projekt.

---

## 12. Übergabe-Manifest `INTEGRATION.md`

Das DMS-Repo führt `INTEGRATION.md` laufend mit. Es ist die Checkliste der Integration — was dort nicht steht, wird nicht übernommen.

1. **Snapshot-Stand:** RealesOS-Commit, aus dem der Snapshot (§ 3.3) stammt.
2. **Migrationen:** Liste in Reihenfolge, je Datei Zweck, Risikoklasse, Rollback-Datei.
3. **Tabellen:** je Tabelle Löschregel von `tenant_id` und allen Fremdschlüsseln mit Begründung (§ 5.5).
4. **Storage:** Buckets, Größengrenzen, MIME-Typen, Policies.
5. **Edge Functions:** Name, `verify_jwt`, benötigte Secrets (nur Namen), Zweck.
6. **API-Konfiguration:** Schema `dms` freigeben (§ 5.1).
7. **Rechte-Schlüssel** mit Rollenzuordnung (§ 10.3).
8. **Registry-Eintrag, Routen, Katalogwerte** (§ 10.2).
9. **Neue Icons** (Einträge für `icon-map.json`).
10. **Neue Abhängigkeiten** mit Begründung (§ 9.8) und Freigabestatus.
11. **Glossar-Vorschläge** (§ 4).
12. **Schnittstellenwünsche an RealesOS** — je Wunsch: Was, warum, gewünschte Signatur (Tabelle/Spalte/RPC), Auswirkung, Dringlichkeit.
13. **Offene Entscheidungen** (§ 2) mit Stand.
14. **Abweichungen** von dieser Datei mit Freigabevermerk.

---

## 13. Arbeitsweise für Claude Code im DMS-Repo

### 13.1 Ein Schritt, dann Freigabe

Bei diesen Themen einen Schritt machen, stoppen und auf ausdrückliche Freigabe des Menschen warten:
- Entwurf von Schema, RLS-Policies, Storage-Policies, `SECURITY DEFINER`-Funktionen
- Authentifizierung, Rechte, Mandantenbindung (auch in Edge Functions)
- Aufbewahrung, Löschung, Sperrvermerke, Unveränderbarkeit, KI-Auslese
- neue Abhängigkeiten, erstmalige Muster (erste Edge Function, erste neue Test-Art)
- alles, was einen Schnittstellenwunsch an RealesOS auslöst

Alles andere (Komponenten, Hooks, Tests, Doku) darf selbständig umgesetzt werden — nach bestehenden Mustern, klein und nachvollziehbar.

### 13.2 Risikoklassen (aus RealesOS übernommen)

- **S:** Doku, kleine Korrekturen, Refactoring ohne Verhaltensänderung
- **M:** neue Funktionen, Schnittstellenänderungen, Abhängigkeits-Updates — Rollback-Datei für Migrationen Pflicht
- **L:** Architektur, Datenmigrationen, Breaking Changes — braucht eine zweite ausdrückliche Freigabe

### 13.3 Bei Unklarheit

Nachfragen statt improvisieren. Wenn eine Vorgabe hier und eine Gewohnheit, ein Plugin oder ein generischer Best-Practice-Rat kollidieren, gilt diese Datei. Wenn diese Datei etwas nicht regelt: das naheliegende RealesOS-Muster wählen, die Wahl in einem Satz begründen und in `INTEGRATION.md` vermerken.

---

## Anhang A — RealesOS-Tabellen, die das DMS liest

Schema `public`, Primärschlüssel überall `id uuid`. Nur lesen, nur unter RLS.

**Stammdaten**
- `objects` — fachlicher Schlüssel `UNIQUE (tenant_id, object_number, sub_number)`; Hierarchie über `parent_object_id`, `object_type` ∈ `anlage, haus, mittelhaus, eingang, sonstiges`; Adresse in `street`, `street_number`, `postal_code`, `city` (`address` ist ein Altfeld); `name`, `verw_art` ∈ `WEG, MHV, SMV`, `is_active`, `verwalter_person_id`.
- `units` — `object_id`, optional `sub_object_id`; **keine eigene `tenant_id`** (Mandant über `objects`); `UNIQUE (object_id, unit_number)`; `unit_type` ∈ `apartment, house, commercial, parking, storage`; `floor_number`, `living_area`, `rooms`.
- `persons` — natürliche Personen und Firmen: `first_name`, `last_name`, `company_name`, `legal_form`, Kontakt, Adresse, `iban`, `bic`, `tax_id`. **Kein fachlicher Unique-Schlüssel, Dubletten möglich.** Die Rolle ergibt sich aus den Verknüpfungen (View `person_role_facts (person_id, role, source)`); `person_type`/`roles` sind Altfelder. Achtung: `person_type = 'tenant'` bedeutet Mieter, `tenant_id` dagegen Mandant.
- `company_persons (company_id, person_id)` — Firma ↔ Ansprechpartner, beide in `persons`.

**Verknüpfungen** (aktuell bei `end_date IS NULL OR end_date >= current_date`)
- `unit_occupancies (unit_id, tenant_person_id, start_date, end_date, tenant_number)` — Mietverhältnis, Hauptmieter in `tenant_person_id`; weitere Mieter in `occupancy_tenants (occupancy_id, person_id, is_main_tenant)`, nicht durchgängig befüllt.
- `unit_ownerships (unit_id, owner_person_id, start_date, end_date, owner_number, share_percentage)` + `ownership_owners (ownership_id, person_id, is_main_owner)`
- `object_owners (object_id, person_id, is_main_owner)`
- `person_objects (person_id, object_id, relationship_types[], start_date, end_date)` — Hausmeister, Beirat, sonstige Kontakte

**Lieferanten und Dienstleister**
- `business_partners (company_name, email, phone, industry, specialization, is_active)`, `business_partner_locations` (Adressen), `business_partner_contacts` (Ansprechpartner), `business_partner_objects (business_partner_id, object_id, sub_object_id, relationship_types, start_date, end_date)`

**Anknüpfungspunkte**
- `cost_entries` — Kostenbuchungen (§ 8.3)
- `tasks`, `facility_tickets`, `service_orders` — Vorgänge (§ 8.2)
- `profiles (id = auth.users.id, tenant_id, name, email)` — Benutzer
- `tenants` — Mandanten

**Nicht Teil des DMS** (von RealesOS erzeugt): `documents`, `person_documents`, `attachments`, `invoices`, `primanoten`, `handover_protocol_invoices`.

**Hilfsfunktionen:** `public.get_user_tenant_id(_user_id uuid) → uuid`, `public.has_role(_user_id uuid, _tenant_id uuid, _role app_role) → boolean`, `public.user_has_permission(p_user_id uuid, p_tenant_id uuid, p_permission text) → boolean`, `public.get_active_modules(p_tenant_id uuid)`, `public.update_updated_at()`.
