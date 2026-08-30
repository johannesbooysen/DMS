-- Rollenmodell
--
-- Grundlage: docs/konzept.md, Abschnitt 17, und ADR 0002.
--
-- Vier Achsen: Rolle x Objekt x Dokumentklasse x Aktion, ergaenzt um die
-- Fachgebietszustaendigkeit. Damit laesst sich abbilden, dass ein Mitarbeiter
-- in Objekt 42 Bearbeiter und in Objekt 43 nur Leser ist.
--
-- Diese Migration loest den Platzhalter benutzer.globaler_objektzugriff ab.
-- Er war als solcher gekennzeichnet: Buchhaltung und Geschaeftsleitung
-- brauchen Sicht auf alle Objekte, ohne je Objekt eine Zustaendigkeit zu
-- tragen. Genau das ist jetzt eine Rollenzuweisung ohne Objektbezug.


-- ---------------------------------------------------------------------------
-- Teil 1: Rolle, Recht, Zuweisung
-- ---------------------------------------------------------------------------

create table rolle (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  name          text not null,
  kurzcode      text not null,
  beschreibung  text,
  aktiv         boolean not null default true,
  unique (mandant_id, kurzcode)
);

create table rolle_recht (
  id                uuid primary key default gen_random_uuid(),
  rolle_id          uuid not null references rolle(id) on delete cascade,
  aktion            text not null check (aktion in
                      ('ansehen','bearbeiten','kontieren','stempeln',
                       'exportieren','freigeben_einsicht',
                       'prozess_konfigurieren','delegieren')),
  -- NULL = gilt fuer alle Belegarten bzw. alle Ordnungsgruppen
  belegart          text,
  ordnungsgruppe_id uuid references ordnungsgruppe(id),
  unique (rolle_id, aktion, belegart, ordnungsgruppe_id)
);

comment on column rolle_recht.aktion is
  'prozess_konfigurieren ist das Recht am Workflow-Baukasten (ADR 0002). '
  'delegieren erlaubt, Aufgaben mit Zeitfenster weiterzugeben -- ohne dabei '
  'Rechte zu uebertragen.';

comment on column rolle_recht.belegart is
  'NULL heisst "alle". Zwei Zeilen mit unterschiedlicher Einschraenkung '
  'ergaenzen sich, sie schliessen sich nicht aus -- das Recht ist die '
  'Vereinigung, nie der Durchschnitt.';

create table benutzer_rolle_objekt (
  id            uuid primary key default gen_random_uuid(),
  benutzer_id   uuid not null references benutzer(id) on delete cascade,
  rolle_id      uuid not null references rolle(id) on delete cascade,
  -- NULL = mandantenweit, also fuer jedes Objekt des Mandanten
  objekt_id     uuid references objekt(id) on delete cascade,
  gueltig_von   date not null default current_date,
  gueltig_bis   date,
  check (gueltig_bis is null or gueltig_bis >= gueltig_von)
);

create index benutzer_rolle_objekt_benutzer_idx
  on benutzer_rolle_objekt (benutzer_id, gueltig_von, gueltig_bis);
create index on benutzer_rolle_objekt (objekt_id);

comment on table benutzer_rolle_objekt is
  'objekt_id NULL bedeutet mandantenweit. Das ist der Weg fuer Buchhaltung '
  'und Geschaeftsleitung -- sie tragen keine Objektzustaendigkeit, sehen aber '
  'alles. Datiert, damit ein Rollenwechsel nachvollziehbar bleibt.';


-- ---------------------------------------------------------------------------
-- Teil 2: Uebernahme des Platzhalters
-- ---------------------------------------------------------------------------

-- Fuer bestehende Daten: aus jedem globalen Zugriff wird eine mandantenweite
-- Rollenzuweisung. Bei einer frisch aufgebauten Datenbank tut das nichts --
-- die Migrationen laufen vor dem Seed.
do $$
declare
  m record;
begin
  for m in (select distinct mandant_id from benutzer where globaler_objektzugriff) loop
    insert into rolle (id, mandant_id, name, kurzcode, beschreibung)
    values (gen_random_uuid(), m.mandant_id, 'Mandantenweite Sicht', 'GLOBAL',
            'Aus dem Platzhalter globaler_objektzugriff uebernommen.')
    on conflict (mandant_id, kurzcode) do nothing;

    insert into rolle_recht (rolle_id, aktion)
    select r.id, 'ansehen' from rolle r
     where r.mandant_id = m.mandant_id and r.kurzcode = 'GLOBAL'
    on conflict do nothing;

    insert into benutzer_rolle_objekt (benutzer_id, rolle_id, objekt_id)
    select b.id, r.id, null
      from benutzer b
      join rolle r on r.mandant_id = b.mandant_id and r.kurzcode = 'GLOBAL'
     where b.mandant_id = m.mandant_id and b.globaler_objektzugriff;
  end loop;
end
$$;

alter table benutzer drop column globaler_objektzugriff;


-- ---------------------------------------------------------------------------
-- Teil 3: Funktionen
-- ---------------------------------------------------------------------------

-- Objektsichtbarkeit, jetzt aus drei Quellen: Objektzustaendigkeit,
-- objektbezogene Rollenzuweisung, mandantenweite Rollenzuweisung.
--
-- Weiterhin "stable security definer" und weiterhin ein einziger Aufruf je
-- Statement. Die Warnung am Kopf von 20260828100100_rls.sql gilt unveraendert:
-- dieselbe Sicht als Unterabfrage je Zeile kostete 264 ms statt 2 ms.
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
       exists (select 1 from objekt_zustaendigkeit z
                where z.objekt_id = o.id
                  and z.benutzer_id = app.mein_benutzer()
                  and z.gueltig_von <= current_date
                  and (z.gueltig_bis is null or z.gueltig_bis >= current_date))
       or exists (select 1
                    from benutzer_rolle_objekt bro
                    join rolle r on r.id = bro.rolle_id and r.aktiv
                    join rolle_recht rr on rr.rolle_id = r.id and rr.aktion = 'ansehen'
                   where bro.benutzer_id = app.mein_benutzer()
                     and (bro.objekt_id = o.id or bro.objekt_id is null)
                     and bro.gueltig_von <= current_date
                     and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date))
     );
$$;

comment on function app.meine_objekte() is
  'Wird je Statement einmal ausgewertet, nicht je Zeile. Siehe die Warnung am '
  'Kopf von 20260828100100_rls.sql -- der Unterschied betraegt 2 ms gegen '
  '264 ms.';

-- Rechtepruefung fuer die Anwendung. Die RLS bleibt die Sicherheitsgrenze;
-- diese Funktion beantwortet die feinere Frage, ob eine Aktion erlaubt ist --
-- etwa ob eine Schaltflaeche ueberhaupt angeboten wird.
create or replace function app.darf(
  p_aktion            text,
  p_objekt_id         uuid default null,
  p_belegart          text default null,
  p_ordnungsgruppe_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1
      from benutzer_rolle_objekt bro
      join rolle r on r.id = bro.rolle_id and r.aktiv
      join rolle_recht rr on rr.rolle_id = r.id
     where bro.benutzer_id = app.mein_benutzer()
       and bro.gueltig_von <= current_date
       and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
       and (p_objekt_id is null or bro.objekt_id = p_objekt_id or bro.objekt_id is null)
       and rr.aktion = p_aktion
       and (rr.belegart is null or rr.belegart = p_belegart)
       and (rr.ordnungsgruppe_id is null or rr.ordnungsgruppe_id = p_ordnungsgruppe_id)
  );
$$;

comment on function app.darf(text, uuid, text, uuid) is
  'Vereinigung ueber alle Rollen des Benutzers: mehrere Rollen ergaenzen '
  'sich. Ein Recht wird nie durch eine zweite Rolle entzogen -- eine '
  'Verbotsregel waere im Rechtemodell nicht mehr nachvollziehbar zu machen.';


-- ---------------------------------------------------------------------------
-- Teil 4: Berechtigungen
-- ---------------------------------------------------------------------------

alter table rolle                 enable row level security;
alter table rolle_recht           enable row level security;
alter table benutzer_rolle_objekt enable row level security;

create policy rolle_sicht on rolle for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy rolle_recht_sicht on rolle_recht for all
  using (exists (select 1 from rolle r
                  where r.id = rolle_id and r.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from rolle r
                       where r.id = rolle_id and r.mandant_id = app.mein_mandant()));

create policy benutzer_rolle_objekt_sicht on benutzer_rolle_objekt for all
  using (exists (select 1 from benutzer b
                  where b.id = benutzer_id and b.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from benutzer b
                       where b.id = benutzer_id and b.mandant_id = app.mein_mandant()));

grant select, insert, update, delete
  on rolle, rolle_recht, benutzer_rolle_objekt to dms_app;
grant execute on function app.darf(text, uuid, text, uuid) to dms_app;
