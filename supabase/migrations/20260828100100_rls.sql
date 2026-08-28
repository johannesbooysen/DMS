-- Berechtigungen: Row Level Security
--
-- Die Policies sind die Sicherheitsgrenze, kein Feature (Konzept 23).
-- Jede Aenderung hier gehoert von einem Test begleitet, der belegt, dass ein
-- fremder Mandant nichts sieht.
--
-- ===========================================================================
-- WARNUNG, gemessen in Konzept 21 -- bitte vor jeder Aenderung lesen
-- ===========================================================================
-- Die naheliegende Fassung der Objektsichtbarkeit ist die falsche:
--
--   create policy dokument_lesen on dokument for select using (
--     exists (select 1
--               from objekt_zustaendigkeit z
--              where z.objekt_id = dokument.objekt_id
--                and z.benutzer_id = app.mein_benutzer())
--   );
--
-- Diese Policy wird JE ZEILE ausgewertet, erzwingt einen Seq Scan ueber die
-- gesamte Tabelle und waechst linear mit ihr: 264 ms bei 1.000.000 Zeilen,
-- und das fuer eine Trefferliste. Die Aufloesung ueber eine
-- "stable security definer"-Funktion wird je Statement einmal ausgewertet:
-- 2 ms fuer dieselbe Sicht. Mit 50 Testbelegen ist der Unterschied unsichtbar.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Teil 1: Identitaet
-- ---------------------------------------------------------------------------

-- Bewusst ohne auth.uid(): die JWT-Claims werden direkt gelesen. Damit laeuft
-- dasselbe Schema unter Supabase und gegen ein blankes Postgres, und Tests
-- koennen den Benutzer ueber "set local app.benutzer_id" wechseln.
create or replace function app.mein_benutzer()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.benutzer_id', true), '')::uuid,
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  );
$$;

create or replace function app.mein_mandant()
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select b.mandant_id from benutzer b
   where b.id = app.mein_benutzer() and b.aktiv;
$$;

-- security definer, weil die Funktion die Zustaendigkeiten aufloesen muss,
-- ohne selbst der RLS auf objekt_zustaendigkeit zu unterliegen.
create or replace function app.meine_objekte()
returns uuid[]
language sql
stable
security definer
set search_path = public, app
as $$
  select coalesce(array_agg(distinct o.id), '{}'::uuid[])
    from objekt o
   where o.mandant_id = app.mein_mandant()
     and (
       exists (select 1 from benutzer b
                where b.id = app.mein_benutzer()
                  and b.globaler_objektzugriff)
       or exists (select 1 from objekt_zustaendigkeit z
                   where z.objekt_id = o.id
                     and z.benutzer_id = app.mein_benutzer()
                     and z.gueltig_von <= current_date
                     and (z.gueltig_bis is null or z.gueltig_bis >= current_date))
     );
$$;

comment on function app.meine_objekte() is
  'Wird je Statement einmal ausgewertet, nicht je Zeile. Siehe die Warnung am '
  'Kopf dieser Migration -- der Unterschied betraegt 2 ms gegen 264 ms.';

create or replace function app.meine_gruppen()
returns uuid[]
language sql
stable
security definer
set search_path = public, app
as $$
  select coalesce(array_agg(gm.gruppe_id), '{}'::uuid[])
    from gruppe_mitglied gm
   where gm.benutzer_id = app.mein_benutzer();
$$;

create or replace function app.meine_spezialgebiete()
returns uuid[]
language sql
stable
security definer
set search_path = public, app
as $$
  select coalesce(array_agg(distinct sz.spezialgebiet_id), '{}'::uuid[])
    from spezialgebiet_zustaendigkeit sz
   where sz.benutzer_id = app.mein_benutzer()
      or sz.gruppe_id = any (app.meine_gruppen());
$$;

comment on function app.meine_spezialgebiete() is
  'Der Versicherungsfall in Objekt 42 geht an den Spezialisten, ohne dass er '
  'Zugriff auf die uebrigen Belege des Objekts erhaelt (Konzept 17).';


-- ---------------------------------------------------------------------------
-- Teil 2: Anwendungsrolle
-- ---------------------------------------------------------------------------

-- Der Eigentuemer einer Tabelle umgeht RLS. Die Anwendung -- und die Tests --
-- arbeiten deshalb unter einer eigenen Rolle ohne diese Eigenschaft.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dms_app') then
    create role dms_app nologin;
  end if;
end
$$;

-- Der verbindende Benutzer muss Mitglied der Rolle sein, sonst schlaegt
-- "set role dms_app" fehl. In der lokalen Supabase-Instanz ist postgres
-- kein Superuser und darf ohne diese Mitgliedschaft nicht wechseln.
do $$
begin
  execute format('grant dms_app to %I with inherit false', current_user);
end
$$;

grant usage on schema public, app to dms_app;
grant select, insert, update, delete on all tables in schema public to dms_app;
grant execute on all functions in schema app to dms_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 3: Policies
-- ---------------------------------------------------------------------------

-- Mandantengebundene Stammdaten: gleiche Form fuer alle.
alter table mandant                     enable row level security;
alter table benutzer                    enable row level security;
alter table gruppe                      enable row level security;
alter table gruppe_mitglied             enable row level security;
alter table spezialgebiet               enable row level security;
alter table spezialgebiet_zustaendigkeit enable row level security;
alter table kontenrahmen                enable row level security;
alter table konto                       enable row level security;
alter table umlageschluessel            enable row level security;
alter table ordnungsgruppe              enable row level security;
alter table belegmerkmal                enable row level security;
alter table zahlungsweg                 enable row level security;
alter table objekt                      enable row level security;
alter table objekt_zustaendigkeit       enable row level security;
alter table kreditor                    enable row level security;
alter table kreditor_bankverbindung     enable row level security;
alter table vertrag                     enable row level security;
alter table prozessdefinition           enable row level security;
alter table prozessstufe                enable row level security;
alter table prozess_override            enable row level security;
alter table stempeltyp                  enable row level security;
alter table stempel_recht               enable row level security;
alter table vorgang                     enable row level security;
alter table dokument                    enable row level security;
alter table dokument_datei              enable row level security;
alter table dokument_seite              enable row level security;
alter table dokument_merkmal            enable row level security;
alter table extraktion_feld             enable row level security;
alter table rechnung_fakten             enable row level security;
alter table dokument_beziehung          enable row level security;
alter table dokument_lauf               enable row level security;
alter table aufgabe                     enable row level security;
alter table stempel_ereignis            enable row level security;
alter table klaerung                    enable row level security;
alter table zuweisung_ereignis          enable row level security;

create policy mandant_sicht on mandant for select
  using (id = app.mein_mandant());

create policy benutzer_sicht on benutzer for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy gruppe_sicht on gruppe for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy gruppe_mitglied_sicht on gruppe_mitglied for all
  using (exists (select 1 from gruppe g
                  where g.id = gruppe_id and g.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from gruppe g
                       where g.id = gruppe_id and g.mandant_id = app.mein_mandant()));

create policy spezialgebiet_sicht on spezialgebiet for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy spezialgebiet_zustaendigkeit_sicht on spezialgebiet_zustaendigkeit for all
  using (exists (select 1 from spezialgebiet s
                  where s.id = spezialgebiet_id and s.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from spezialgebiet s
                       where s.id = spezialgebiet_id and s.mandant_id = app.mein_mandant()));

create policy kontenrahmen_sicht on kontenrahmen for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy konto_sicht on konto for all
  using (exists (select 1 from kontenrahmen k
                  where k.id = kontenrahmen_id and k.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from kontenrahmen k
                       where k.id = kontenrahmen_id and k.mandant_id = app.mein_mandant()));

create policy umlageschluessel_sicht on umlageschluessel for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy ordnungsgruppe_sicht on ordnungsgruppe for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy belegmerkmal_sicht on belegmerkmal for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy zahlungsweg_sicht on zahlungsweg for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

-- Objekte: nur die eigenen. Nicht "alle des Mandanten" -- ein Bearbeiter
-- sieht Objekt 43 nicht, nur weil es demselben Mandanten gehoert.
create policy objekt_sicht on objekt for all
  using (id = any (app.meine_objekte()))
  with check (mandant_id = app.mein_mandant());

create policy objekt_zustaendigkeit_sicht on objekt_zustaendigkeit for all
  using (objekt_id = any (app.meine_objekte()))
  with check (objekt_id = any (app.meine_objekte()));

create policy kreditor_sicht on kreditor for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy kreditor_bankverbindung_sicht on kreditor_bankverbindung for all
  using (exists (select 1 from kreditor k
                  where k.id = kreditor_id and k.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from kreditor k
                       where k.id = kreditor_id and k.mandant_id = app.mein_mandant()));

create policy vertrag_sicht on vertrag for all
  using (objekt_id = any (app.meine_objekte()))
  with check (objekt_id = any (app.meine_objekte()));

create policy prozessdefinition_sicht on prozessdefinition for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy prozessstufe_sicht on prozessstufe for all
  using (exists (select 1 from prozessdefinition p
                  where p.id = definition_id and p.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from prozessdefinition p
                       where p.id = definition_id and p.mandant_id = app.mein_mandant()));

create policy prozess_override_sicht on prozess_override for all
  using (objekt_id = any (app.meine_objekte()))
  with check (objekt_id = any (app.meine_objekte()));

create policy stempeltyp_sicht on stempeltyp for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy stempel_recht_sicht on stempel_recht for all
  using (exists (select 1 from stempeltyp s
                  where s.id = stempeltyp_id and s.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from stempeltyp s
                       where s.id = stempeltyp_id and s.mandant_id = app.mein_mandant()));

create policy vorgang_sicht on vorgang for all
  using (objekt_id = any (app.meine_objekte()))
  with check (objekt_id = any (app.meine_objekte()));

-- Der Kern: Sicht auf einen Beleg entsteht aus Objektzustaendigkeit ODER
-- Spezialgebietszustaendigkeit. Beide Seiten sind Array-Vergleiche gegen ein
-- je Statement einmal ausgewertetes Ergebnis.
create policy dokument_sicht on dokument for all
  using (
    mandant_id = app.mein_mandant()
    and (
      objekt_id = any (app.meine_objekte())
      or spezialgebiet_id = any (app.meine_spezialgebiete())
    )
  )
  with check (mandant_id = app.mein_mandant());

-- Kindtabellen des Dokuments: Zugriff laeuft immer ueber dokument_id, also
-- ueber den Primaerschluessel. Der exists-Ausdruck ist hier ein Indexzugriff
-- und nicht der in der Kopfwarnung beschriebene Seq Scan.
create policy dokument_datei_sicht on dokument_datei for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy dokument_seite_sicht on dokument_seite for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy dokument_merkmal_sicht on dokument_merkmal for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy extraktion_feld_sicht on extraktion_feld for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy rechnung_fakten_sicht on rechnung_fakten for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy dokument_beziehung_sicht on dokument_beziehung for all
  using (exists (select 1 from dokument d where d.id = von_dokument))
  with check (exists (select 1 from dokument d where d.id = von_dokument));

create policy dokument_lauf_sicht on dokument_lauf for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy klaerung_sicht on klaerung for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy zuweisung_ereignis_sicht on zuweisung_ereignis for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

-- Aufgabe: das eigene Postfach, das Pool-Postfach der eigenen Gruppen, und
-- die Aufgaben sichtbarer Belege -- sonst sieht der Objektverantwortliche
-- nicht, wo sein Beleg gerade steht.
create policy aufgabe_sicht on aufgabe for all
  using (
    zugewiesen_benutzer = app.mein_benutzer()
    or zugewiesen_gruppe = any (app.meine_gruppen())
    or exists (select 1 from dokument_lauf l where l.id = lauf_id)
  )
  with check (exists (select 1 from dokument_lauf l where l.id = lauf_id));

-- Stempelereignisse sind append-only. Kein update, kein delete -- weder in
-- der Policy noch im Trigger (20260828100000_kern.sql, Teil 8).
create policy stempel_ereignis_lesen on stempel_ereignis for select
  using (exists (select 1 from dokument_lauf l where l.id = lauf_id));

create policy stempel_ereignis_anlegen on stempel_ereignis for insert
  with check (
    benutzer_id = app.mein_benutzer()
    and exists (select 1 from dokument_lauf l where l.id = lauf_id)
  );

comment on policy stempel_ereignis_anlegen on stempel_ereignis is
  'Ein Stempel traegt immer den anmeldenden Benutzer. Im fremden Namen zu '
  'stempeln ist auch mit Schreibrecht nicht moeglich.';
