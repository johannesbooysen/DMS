-- Umzug in das Schema dms (ADR 0010, Weg B, Schritt 2).
--
-- Die Vorschrift von RealesOS (docs/realesos/vorgaben.md § 5.1): Alle
-- DMS-Objekte liegen im Schema `dms`, dem ersten Schema neben `public`.
-- Bis hierher lagen unsere 83 Tabellen in `public` und 118 Funktionen in
-- `app`. Beides zieht um -- **an Ort und Stelle**, mit denselben OIDs:
--
--   * `alter table … set schema dms` nimmt Indizes, Sequenzen, Trigger,
--     Fremdschluessel und Policies mit, weil sie an der OID haengen.
--   * `alter function … set schema dms` ebenso: Trigger, Policies und
--     Spaltenvorgaben verweisen auf die OID, nicht auf den Namen.
--
-- Was an der OID *nicht* haengt, ist der **Text** der Funktionskoerper:
-- `app.mein_mandant()` steht dort als Zeichenkette, ebenso
-- `set search_path = public, app`. Deshalb wird jede Funktion nach dem
-- Umzug einmal mit `create or replace` neu geschrieben -- gleiche
-- Signatur, gleiche OID, Text umgeschrieben. Geschuetzt bleibt die
-- Sitzungsvariable `'app.benutzer_id'`: Sie heisst so, weil sie eine
-- Einstellung ist und kein Schema; die Anwendung setzt sie seit dem ersten
-- Tag unter diesem Namen.
--
-- Warum nicht eine neue Grundmigration aus pg_dump? Weil 69 Migrationen
-- mit ihren Begruendungen die Geschichte dieses Schemas sind, und weil
-- jede bestehende Datenbank sonst neu aufgesetzt werden muesste. Die
-- Grundmigration fuer die Einbindung erzeugt RealesOS am Ende aus dem
-- Zielschema (Vorschrift § 5.2: Zeitstempel werden neu vergeben).
--
-- Welche Tabellen dem DMS gehoeren, sagt die Datenbank selbst: die, auf
-- denen `dms_app` Rechte hat (Migration 20261006130000 hat sie auf den
-- RealesOS-Tabellen entzogen). `dms.events` aus der Startmigration liegt
-- schon richtig.
--
-- Danach gilt fuer jede Verbindung der Anwendung `search_path = dms, public`
-- -- gesetzt von der Anwendung selbst (src/db.ts), nicht an der Datenbank:
-- Eine Datenbank-Einstellung wuerde auch RealesOS-Migrationen treffen, die
-- unqualifiziert `create table` schreiben, und ihre Tabellen nach dms
-- verlegen. Die Rolleneinstellung unten hilft psql und Werkzeugen, die sich
-- direkt als dms_app anmelden.

create schema if not exists dms;
grant usage on schema dms to dms_app;

-- ---------------------------------------------------------------------------
-- Teil 1: Tabellen
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and has_table_privilege('dms_app', c.oid, 'SELECT')
     order by c.relname
  loop
    execute format('alter table public.%I set schema dms', r.relname);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Teil 2: Funktionen -- umziehen, dann den Text neu schreiben
-- ---------------------------------------------------------------------------
-- Fuer den Rest dieser Datei: SQL-Funktionen werden beim `create or replace`
-- gegen den Suchpfad der Sitzung geprueft, nicht gegen ihren eigenen --
-- und die Tabellen liegen seit Teil 1 in dms.
set search_path = dms, public;

do $$
declare
  r   record;
  def text;
begin
  -- Erst alle umziehen (OIDs bleiben, Trigger und Policies folgen).
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
  loop
    execute format('alter function app.%I(%s) set schema dms', r.proname, r.args);
  end loop;

  -- Dann jeden Text umschreiben: Aufrufe app.* -> dms.*, search_path,
  -- die Sitzungsvariable bleibt.
  for r in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'dms'
  loop
    def := pg_get_functiondef(r.oid);
    def := replace(def, '''app.benutzer_id''', '''@@GUC@@''');
    def := regexp_replace(def, '\mapp\.', 'dms.', 'g');
    def := replace(def, '''@@GUC@@''', '''app.benutzer_id''');
    def := regexp_replace(def, 'SET search_path TO ''public'', ''app''', 'SET search_path TO ''dms'', ''public''', 'g');
    def := regexp_replace(def, 'SET search_path TO ''app'', ''public''', 'SET search_path TO ''dms'', ''public''', 'g');
    execute def;
  end loop;
end
$$;

-- Kommentare an Funktionen nennen das alte Schema; sie wandern mit der OID,
-- der Text nicht -- unerheblich fuer den Betrieb, aber die Doku liest sie.
do $$
declare
  r record;
begin
  for r in
    select p.oid, d.description
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_description d on d.objoid = p.oid
     where n.nspname = 'dms' and d.description like '%app.%'
  loop
    execute format('comment on function %s is %L', r.oid::regprocedure, replace(r.description, 'app.', 'dms.'));
  end loop;
end
$$;

drop schema app;

-- ---------------------------------------------------------------------------
-- Teil 3: Rechte und Suchpfad
-- ---------------------------------------------------------------------------
alter role dms_app set search_path = dms, public;
alter default privileges in schema dms grant select, insert, update, delete on tables to dms_app;
alter default privileges in schema dms grant usage, select on sequences to dms_app;
grant usage, select on all sequences in schema dms to dms_app;

-- Was die Startmigration fuer public offen liess: Neue Tabellen in public
-- bekommen keine pauschalen Rechte mehr -- dort entstehen keine DMS-Tabellen.
alter default privileges in schema public revoke select, insert, update, delete on tables from dms_app;

comment on schema dms is
  'DMS: Belege, Ablaeufe, Stempel, Rechte -- alle Tabellen und Funktionen des '
  'Dokumentenmanagements (ADR 0010). Verweist auf public, nie umgekehrt.';
