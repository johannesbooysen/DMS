-- Ablagen: mehrere Bestaende statt einem, mit Rechten je Ablage.
--
-- Beim Bedienen gefragt: "Derzeit hat das DMS nur eine Ablage
-- Eingangsrechnungen. Aehnlich wie Amagno soll es mehrere Ablagen haben,
-- z. B. Lieferantenrechnungen und Schriftverkehr, erweiterbar, mit
-- unterschiedlichen Rechten und Rollen je Ablage."
--
-- Was eine Ablage ist: ein Stammdatum des Hauses (`ablage`), nicht eine
-- Belegart. Die Belegart sagt, *was* ein Beleg ist und welchen Ablauf er
-- nimmt; die Ablage sagt, *wo er liegt und wer ihn sieht*. Beides faellt
-- oft zusammen -- deshalb traegt jede Ablage die Belegarten, deren Belege
-- von selbst in ihr landen (`belegarten`), und eine ist die Vorgabe fuer
-- alles andere (`ist_standard`). Ein Mensch kann einen Beleg in eine andere
-- Ablage legen; dann merkt sich der Beleg, dass das ein Mensch war
-- (`ablage_quelle = 'mensch'`), und die Belegart-Erkennung ruehrt die
-- Ablage nicht mehr an.
--
-- Rechte je Ablage: `rolle_recht` bekommt einen dritten Geltungsbereich
-- neben Belegart und Ordnungsgruppe -- `ablage_id`, null heisst alle. Die
-- Sichtbarkeit eines Belegs haengt seither an **zwei** Fragen: Sehe ich
-- das Objekt (wie bisher, `dms.meine_objekte()`), und sehe ich die Ablage
-- (`dms.meine_ablagen()`)? Beides steht in der Policy auf `dokument`, als
-- unkorrelierte Unterabfrage, aus demselben Grund wie bei den Objekten
-- (Migration 20260831210000).
--
-- **Wirksam je Ablage sind heute zwei Rechte:** `ansehen` (ueber die
-- Policy) und `bearbeiten` (beim Ablagewechsel, `dms.darf_in_ablage`).
-- `dms.darf()` kennt die Ablage nicht -- seine Signatur haengt an Policies,
-- und seine Aufrufer (Kontierung, Stempel, Export, Einsicht) kennen den
-- Beleg nicht immer. Deshalb bietet die Oberflaeche nur diese beiden an
-- (`ABLAGE_RECHTE`); eine Zeile `kontieren` mit Ablage wuerde von `darf()`
-- wie ein uneingeschraenktes Recht gelesen, und ein Haken, der nichts
-- bewirkt, ist schlimmer als keiner. Wer die uebrigen Rechte je Ablage
-- will, fuehrt die Ablage durch `darf()` und seine Aufrufer -- und dann
-- die Liste nach.
--
-- Wer welche Ablagen sieht, sagen die Rollen: ein Recht `ansehen` mit
-- `ablage_id = null` oeffnet alle, mit einer Kennung genau diese. Ein
-- Benutzer **ohne jede Rolle**, der nur ueber eine Objektzustaendigkeit
-- sieht, sieht weiter alle Ablagen seiner Objekte -- die Ablage schraenkt
-- ein, was Rollen oeffnen; sie nimmt niemandem, was er heute hat.
--
-- Nach der Archivierung darf die Ablage wechseln (wie die Ordnungsgruppe,
-- Konzept 18): Sie ist Ablagemerkmal, kein Teil des Belegs. Der Wechsel
-- schreibt ein Korrekturereignis.
--
-- Kein eigener Index auf `dokument.ablage_id`: Der Filter trifft meist alle
-- Ablagen eines Benutzers; vor einem Index gehoert gemessen (CLAUDE.md).

-- ---------------------------------------------------------------------------
-- Teil 1: Die Ablage
-- ---------------------------------------------------------------------------
create table dms.ablage (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references dms.mandant(id),
  name          text not null,
  kurzcode      text not null,
  beschreibung  text,
  -- Belegarten, deren Belege von selbst hier landen. Eine Belegart sollte in
  -- genau einer aktiven Ablage stehen; steht sie in mehreren, gewinnt die
  -- Sortierung, steht sie in keiner, gewinnt die Vorgabe.
  belegarten    text[] not null default '{}',
  ist_standard  boolean not null default false,
  sortierung    integer not null default 100,
  aktiv         boolean not null default true,
  erstellt_am   timestamptz not null default now(),
  unique (mandant_id, kurzcode)
);
comment on table dms.ablage is
  'Ablagen des Hauses (Konzept Amagno-Ersatz): wo ein Beleg liegt und wer '
  'ihn sieht. Stammdatum ohne Personenbezug. Nie loeschen, nur deaktivieren.';
comment on column dms.ablage.belegarten is
  'Belegarten, die beim Eingang von selbst in diese Ablage fallen.';
comment on column dms.ablage.ist_standard is
  'Genau eine je Mandant: nimmt alles auf, was keine Ablage ueber die Belegart findet.';

create unique index ablage_standard_idx on dms.ablage (mandant_id) where ist_standard;

alter table dms.ablage enable row level security;
create policy ablage_lesen on dms.ablage for select
  using (mandant_id = (select dms.mein_mandant()));
create policy ablage_schreiben on dms.ablage for all
  using ((select dms.darf_stammdaten()) and mandant_id = (select dms.mein_mandant()))
  with check ((select dms.darf_stammdaten()) and mandant_id = (select dms.mein_mandant()));
grant select, insert, update, delete on dms.ablage to dms_app;

-- Bestand: Jeder Mandant, der noch keine Ablage hat, bekommt die zwei, mit
-- denen das DMS bisher gelebt hat -- ohne es zu wissen.
insert into dms.ablage (mandant_id, name, kurzcode, beschreibung, belegarten, ist_standard, sortierung)
select m.id, 'Lieferantenrechnungen', 'LR',
       'Eingangsrechnungen, Gutschriften und Mahnungen der Lieferanten und Dienstleister.',
       array['rechnung', 'gutschrift', 'mahnung'], true, 10
  from dms.mandant m
 where not exists (select 1 from dms.ablage a where a.mandant_id = m.id);
insert into dms.ablage (mandant_id, name, kurzcode, beschreibung, belegarten, ist_standard, sortierung)
select m.id, 'Schriftverkehr', 'SV',
       'Briefe, Schreiben und Sonstiges -- was keine Rechnung ist.',
       array['schriftverkehr', 'sonstiges'], false, 20
  from dms.mandant m
 where not exists (select 1 from dms.ablage a where a.mandant_id = m.id and a.kurzcode = 'SV');

-- ---------------------------------------------------------------------------
-- Teil 2: Der Beleg kennt seine Ablage
-- ---------------------------------------------------------------------------
alter table dms.dokument
  add column ablage_id uuid references dms.ablage(id),
  add column ablage_quelle text not null default 'eingang'
    check (ablage_quelle in ('eingang', 'mensch'));
comment on column dms.dokument.ablage_id is
  'Die Ablage des Belegs. Beim Eingang aus der Belegart abgeleitet (dms.ablage_fuer), '
  'von einem Menschen aenderbar -- auch nach der Archivierung.';
comment on column dms.dokument.ablage_quelle is
  'eingang: aus der Belegart abgeleitet, folgt ihr bei Umstellung. mensch: von Hand '
  'gewaehlt, bleibt.';

-- Welche Ablage nimmt einen Beleg dieser Belegart auf?
create or replace function dms.ablage_fuer(p_mandant_id uuid, p_belegart text)
returns uuid
language sql
stable
security definer
set search_path = dms, public
as $$
  select id from (
    select a.id, 0 as rang, a.sortierung
      from ablage a
     where a.mandant_id = p_mandant_id and a.aktiv and p_belegart = any (a.belegarten)
    union all
    select a.id, 1, a.sortierung
      from ablage a
     where a.mandant_id = p_mandant_id and a.aktiv and a.ist_standard
    union all
    select a.id, 2, a.sortierung
      from ablage a
     where a.mandant_id = p_mandant_id and a.aktiv
  ) k
  order by rang, sortierung
  limit 1;
$$;
grant execute on function dms.ablage_fuer(uuid, text) to dms_app;

update dms.dokument d set ablage_id = dms.ablage_fuer(d.mandant_id, d.belegart) where d.ablage_id is null;
alter table dms.dokument alter column ablage_id set not null;

create or replace function dms.dokument_ablage_vorgabe()
returns trigger
language plpgsql
security definer
set search_path = dms, public
as $$
begin
  if new.ablage_id is null then
    new.ablage_id := dms.ablage_fuer(new.mandant_id, new.belegart);
    if new.ablage_id is null then
      raise exception 'Der Mandant hat keine aktive Ablage -- erst eine anlegen (Konfiguration → Ablagen).';
    end if;
  end if;
  -- Ein mitgegebener Wert wird geprueft: Der Fremdschluessel kennt keinen
  -- Mandanten, und eine Ablage eines anderen Hauses machte den Beleg fuer
  -- jeden unsichtbar -- samt Aufbewahrungs- und Loeschpflicht. Eine
  -- deaktivierte bietet die Oberflaeche nicht an; ihre Kennung steht
  -- trotzdem in Links.
  if not exists (
    select 1 from ablage a
     where a.id = new.ablage_id and a.mandant_id = new.mandant_id and a.aktiv
  ) then
    raise exception 'Die Ablage gehoert nicht zu diesem Mandanten oder ist deaktiviert.';
  end if;
  return new;
end;
$$;
create trigger dokument_ablage_vorgabe
  before insert or update of ablage_id on dms.dokument
  for each row execute function dms.dokument_ablage_vorgabe();

-- ---------------------------------------------------------------------------
-- Teil 3: Rechte je Ablage
-- ---------------------------------------------------------------------------
alter table dms.rolle_recht add column ablage_id uuid references dms.ablage(id);
comment on column dms.rolle_recht.ablage_id is
  'Dritter Geltungsbereich neben Belegart und Ordnungsgruppe. null = alle Ablagen.';

-- Dieselbe Pruefung fuer das Recht: Eine Ablage eines anderen Hauses an
-- einer Rolle waere eine mandantenuebergreifende Referenz.
create or replace function dms.rolle_recht_ablage_pruefen()
returns trigger
language plpgsql
security definer
set search_path = dms, public
as $$
begin
  if new.ablage_id is not null and not exists (
    select 1 from ablage a join rolle r on r.mandant_id = a.mandant_id
     where a.id = new.ablage_id and r.id = new.rolle_id
  ) then
    raise exception 'Die Ablage gehoert nicht zum Mandanten der Rolle.';
  end if;
  return new;
end;
$$;
create trigger rolle_recht_ablage_pruefen
  before insert or update of ablage_id, rolle_id on dms.rolle_recht
  for each row execute function dms.rolle_recht_ablage_pruefen();

alter table dms.rolle_recht drop constraint rolle_recht_rolle_id_aktion_belegart_ordnungsgruppe_id_key;
alter table dms.rolle_recht add constraint rolle_recht_geltung_key
  unique (rolle_id, aktion, belegart, ordnungsgruppe_id, ablage_id);

-- Welche Ablagen sieht der Angemeldete?
--
-- Aus den Rollen: `ansehen` ohne Ablage oeffnet alle, mit Ablage genau die.
-- Hat **keine** Rolle des Benutzers ein Recht `ansehen` (keine Rolle, oder
-- nur Rollen ohne Sichtrecht -- der sieht heute ueber die
-- Objektzustaendigkeit), gelten alle Ablagen -- siehe Kopf der Datei: Die
-- Ablage schraenkt ein, was Rollen oeffnen.
create or replace function dms.meine_ablagen()
returns uuid[]
language sql
stable
security definer
set search_path = dms, public
as $$
  with rollen as (
    select bro.rolle_id
      from benutzer_rolle_objekt bro
      join rolle r on r.id = bro.rolle_id and r.aktiv
     where bro.benutzer_id = dms.mein_benutzer()
       and bro.gueltig_von <= current_date
       and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
  )
  select coalesce(array_agg(distinct a.id), '{}'::uuid[])
    from ablage a
   where a.mandant_id = dms.mein_mandant()
     and (
       not exists (
         select 1 from rolle_recht rr join rollen ro on ro.rolle_id = rr.rolle_id
          where rr.aktion = 'ansehen'
       )
       or exists (
         select 1
           from rolle_recht rr
           join rollen ro on ro.rolle_id = rr.rolle_id
          where rr.aktion = 'ansehen'
            and (rr.ablage_id is null or rr.ablage_id = a.id)
       )
     );
$$;
grant execute on function dms.meine_ablagen() to dms_app;
comment on function dms.meine_ablagen() is
  'Die Ablagen, die der Angemeldete sehen darf -- aus dem Recht ansehen seiner '
  'Rollen (null = alle). Ohne ein ansehen aus einer Rolle alle: Die Ablage '
  'schraenkt ein, was Rollen oeffnen, sie nimmt einer Objektzustaendigkeit nichts. '
  'Bewusst ohne Filter auf aktiv: Belege in einer deaktivierten Ablage bleiben sichtbar.';

-- Ein Recht in einer bestimmten Ablage -- fuer Handlungen am Beleg.
--
-- Nicht als fuenfter Parameter von dms.darf: Dessen Signatur haengt an
-- Policies (delegation, eingangsquelle, notfallzugriff), und ein zweiter
-- darf() mit Vorgabewerten waere fuer jeden Aufruf mit einem Argument
-- mehrdeutig.
create or replace function dms.darf_in_ablage(
  p_aktion           text,
  p_ablage_id        uuid,
  p_objekt_id        uuid default null,
  p_belegart         text default null,
  p_ordnungsgruppe_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = dms, public
as $$
  select exists (
    select 1
      from benutzer_rolle_objekt bro
      join rolle r on r.id = bro.rolle_id and r.aktiv
      join rolle_recht rr on rr.rolle_id = r.id
     where bro.benutzer_id = dms.mein_benutzer()
       and bro.gueltig_von <= current_date
       and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
       and (p_objekt_id is null or bro.objekt_id = p_objekt_id or bro.objekt_id is null)
       and rr.aktion = p_aktion
       and (rr.belegart is null or rr.belegart = p_belegart)
       and (rr.ordnungsgruppe_id is null or rr.ordnungsgruppe_id = p_ordnungsgruppe_id)
       and (rr.ablage_id is null or rr.ablage_id = p_ablage_id)
  );
$$;
grant execute on function dms.darf_in_ablage(text, uuid, uuid, text, uuid) to dms_app;

-- ---------------------------------------------------------------------------
-- Teil 4: Die Sichtbarkeit -- Objekt und Ablage
-- ---------------------------------------------------------------------------
drop policy dokument_lesen on dms.dokument;
create policy dokument_lesen on dms.dokument for select
  using (
    not eingeschraenkt
    and mandant_id = (select dms.mein_mandant())
    and ablage_id = any ((select dms.meine_ablagen())::uuid[])
    and (
      objekt_id is null
      or objekt_id = any ((select dms.meine_objekte())::uuid[])
      or spezialgebiet_id = any ((select dms.meine_spezialgebiete())::uuid[])
    )
  );
