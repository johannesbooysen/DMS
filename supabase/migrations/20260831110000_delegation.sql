-- Vertretung: Aufgaben weitergeben, Rechte nicht
--
-- Grundlage: ADR 0002, Teil C, und Konzept 22, Entscheidung 8.
--
-- Drei Dinge heissen umgangssprachlich "uebertragen" und sind verschieden:
--
--   Eine Aufgabe weitergeben   -> zuweisung_ereignis, einzeln
--   Zustaendigkeit aendern     -> objekt_zustaendigkeit, dauerhaft
--   Rechte uebertragen         -> gibt es nicht, und zwar mit Absicht
--
-- Diese Tabelle deckt den Fall dazwischen ab: "Frau B ist drei Wochen im
-- Urlaub, alles Technische geht so lange an Herrn A." Sie wirkt beim
-- ZUWEISEN einer Aufgabe, nicht beim Pruefen von Rechten. Herr A bekommt die
-- Aufgabe; was er nicht darf, darf er weiterhin nicht, und die Aufgabe
-- eskaliert dann regulaer.
--
-- Der Grund fuer diese Trennung steht in Konzept 22: Ein Rechtemodell, das
-- sich temporaer verschiebt, ist im Pruefungsfall nicht mehr beantwortbar.
-- Wer im Maerz freigeben durfte, muss im November feststellbar sein.

create table delegation (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),
  von_benutzer      uuid not null references benutzer(id),
  an_benutzer       uuid not null references benutzer(id),

  -- Umfang. Leer heisst "alles"; jede gesetzte Spalte schraenkt weiter ein.
  objekt_id         uuid references objekt(id) on delete cascade,
  ordnungsgruppe_id uuid references ordnungsgruppe(id) on delete cascade,
  stufentyp         text,

  gueltig_von       timestamptz not null default now(),
  gueltig_bis       timestamptz,
  grund             text,
  erstellt_von      uuid not null references benutzer(id),
  erstellt_am       timestamptz not null default now(),
  widerrufen_am     timestamptz,

  constraint delegation_zeitraum
    check (gueltig_bis is null or gueltig_bis >= gueltig_von),
  -- An sich selbst zu delegieren ist keine Vertretung, sondern eine Schleife.
  constraint delegation_nicht_an_sich_selbst
    check (von_benutzer <> an_benutzer)
);

create index delegation_von_idx on delegation (von_benutzer, gueltig_von, gueltig_bis)
  where widerrufen_am is null;
create index delegation_an_idx on delegation (an_benutzer)
  where widerrufen_am is null;

comment on table delegation is
  'Wirkt beim Zuweisen, nicht beim Pruefen von Rechten. Wer vertritt, '
  'bekommt die Aufgabe -- nicht die Berechtigungen des Vertretenen.';

comment on column delegation.stufentyp is
  'Einschraenkung auf eine Art von Station, etwa nur die sachliche Pruefung. '
  'NULL heisst: alle.';


-- ---------------------------------------------------------------------------
-- Wer vertritt diesen Benutzer gerade, fuer diesen Beleg, an dieser Stufe?
-- ---------------------------------------------------------------------------

create or replace function app.vertretung_fuer(
  p_benutzer          uuid,
  p_objekt_id         uuid,
  p_ordnungsgruppe_id uuid,
  p_stufentyp         text
)
returns table (delegation_id uuid, an_benutzer uuid)
language sql
stable
security definer
set search_path = public, app
as $$
  select d.id, d.an_benutzer
    from delegation d
   where d.von_benutzer = p_benutzer
     and d.widerrufen_am is null
     and d.gueltig_von <= now()
     and (d.gueltig_bis is null or d.gueltig_bis >= now())
     and (d.objekt_id is null or d.objekt_id = p_objekt_id)
     and (d.ordnungsgruppe_id is null or d.ordnungsgruppe_id = p_ordnungsgruppe_id)
     and (d.stufentyp is null or d.stufentyp = p_stufentyp)
   -- Die engste Festlegung gewinnt: Wer "nur Objekt 42" und "alles" zugleich
   -- delegiert hat, meinte fuer Objekt 42 die erste Regel.
   order by (d.objekt_id is not null) desc,
            (d.ordnungsgruppe_id is not null) desc,
            (d.stufentyp is not null) desc,
            d.gueltig_von desc
   limit 1;
$$;

comment on function app.vertretung_fuer(uuid, uuid, uuid, text) is
  'Loest genau eine Stufe auf, nicht kettenweise: Delegiert A an B und B an '
  'C, geht die Aufgabe an B. Eine Kette waere schwer zu durchschauen und '
  'koennte im Kreis laufen.';

grant execute on function app.vertretung_fuer(uuid, uuid, uuid, text) to dms_app;


-- ---------------------------------------------------------------------------
-- Sichtbar machen, dass eine Vertretung gewirkt hat
-- ---------------------------------------------------------------------------

alter table aufgabe add column wegen_delegation uuid references delegation(id);
alter table stempel_ereignis add column wegen_delegation uuid references delegation(id);

comment on column stempel_ereignis.wegen_delegation is
  'Ohne diesen Verweis stuende spaeter ein Name im Protokoll, dessen '
  'Zustaendigkeit sich aus den Stammdaten nicht erklaert (ADR 0002).';


alter table delegation enable row level security;

create policy delegation_sicht on delegation for select
  using (mandant_id = app.mein_mandant());

-- Anlegen und widerrufen darf man fuer sich selbst -- oder mit dem Recht
-- "delegieren" auch fuer andere, etwa wenn jemand unerwartet ausfaellt.
create policy delegation_anlegen on delegation for insert
  with check (
    mandant_id = app.mein_mandant()
    and erstellt_von = app.mein_benutzer()
    and (von_benutzer = app.mein_benutzer() or app.darf('delegieren'))
  );

create policy delegation_widerrufen on delegation for update
  using (
    mandant_id = app.mein_mandant()
    and (von_benutzer = app.mein_benutzer() or app.darf('delegieren'))
  )
  with check (mandant_id = app.mein_mandant());

grant select, insert, update on delegation to dms_app;
