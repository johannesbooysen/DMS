-- Einheit, Person, zeitbezogene Belegeinsicht und Kontierung mit Split
--
-- Grundlage: docs/konzept.md, Abschnitte 6 und 7.
--
-- Bis hierhin hing alles am Objekt. Fuer Rechnungen genuegt das, fuer
-- Schriftverkehr und Belegeinsicht nicht: ein Mahnschreiben betrifft einen
-- Mieter, ein Mietvertrag eine Einheit, eine Anfechtung einen Eigentuemer.


-- ---------------------------------------------------------------------------
-- Teil 1: Einheit und Person
-- ---------------------------------------------------------------------------

create table einheit (
  id            uuid primary key default gen_random_uuid(),
  objekt_id     uuid not null references objekt(id) on delete cascade,
  einheitsnummer text not null,
  lage          text,
  typ           text check (typ in ('wohnung','gewerbe','stellplatz','sonstige')),
  mea           numeric(10,4),
  wohnflaeche   numeric(10,2),
  unique (objekt_id, einheitsnummer)
);

create table person (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  art           text not null check (art in
                  ('eigentuemer','mieter','beirat','dienstleister','sonstige')),
  name          text not null,
  email         text,
  externe_id    text
);

create index on person (mandant_id, art);

create table person_bezug (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references person(id) on delete cascade,
  objekt_id     uuid not null references objekt(id) on delete cascade,
  -- NULL = objektweit, zum Beispiel Beirat
  einheit_id    uuid references einheit(id),
  art           text not null check (art in
                  ('eigentuemer','mieter','beirat','sonstige')),
  gueltig_von   date not null,
  -- NULL = laufend
  gueltig_bis   date,
  check (gueltig_bis is null or gueltig_bis >= gueltig_von)
);

create index person_bezug_zeit_idx on person_bezug (person_id, objekt_id, art);
create index on person_bezug (objekt_id);

comment on table person_bezug is
  'Der Zeitbezug ist der eigentliche Punkt. Ohne ihn laesst sich nach einem '
  'Mieterwechsel nicht begrenzen, welche Belege der neue und welche der alte '
  'Mieter sehen darf. Mit ihm wird die Sichtbarkeit gerechnet statt manuell '
  'freigegeben (Konzept 7).';


-- ---------------------------------------------------------------------------
-- Teil 2: Erweiterung des Dokuments
-- ---------------------------------------------------------------------------

alter table dokument
  add column einheit_id             uuid references einheit(id),
  add column betrifft_person_id     uuid references person(id),
  add column leistung_von           date,
  add column leistung_bis           date,
  add column hat_umlagefaehige_zeile boolean not null default false;

comment on column dokument.hat_umlagefaehige_zeile is
  'Bewusst denormalisiert, per Trigger aus der Kontierung gepflegt. Ersetzt '
  'bei jedem einzelnen Beleganruf eines Mieters einen Semi-Join ueber eine '
  'Million Kontierungszeilen: 48,6 ms auf 11,9 ms (Konzept 7.1). Nie von '
  'Hand setzen.';

comment on column dokument.leistung_von is
  'Grundlage der Mietersicht. Ein Beleg ohne Leistungszeitraum ist fuer '
  'Mieter nicht sichtbar -- im Zweifel weniger zeigen, nicht mehr.';

-- Der Feed der Mietersicht. Zusammengesetzt, nicht zwei einzelne Indizes:
-- ein Index auf eingang_am allein verschlechterte den Feed messbar
-- (Konzept 21).
create index dokument_mietersicht_idx
  on dokument (objekt_id, eingang_am desc)
  where hat_umlagefaehige_zeile;


-- ---------------------------------------------------------------------------
-- Teil 3: Kontierung mit Split
-- ---------------------------------------------------------------------------

create table kontierung (
  id                        uuid primary key default gen_random_uuid(),
  dokument_id               uuid not null references dokument(id) on delete cascade,
  zeile_nr                  integer not null,
  konto_id                  uuid not null references konto(id),
  betrag_netto              numeric(14,2) not null,
  steuersatz                numeric(5,2) not null default 0,
  betrag_brutto             numeric(14,2) not null,
  umlagefaehig              boolean not null default false,
  umlageschluessel_id       uuid references umlageschluessel(id),
  ruecklage_entnahme        boolean not null default false,
  beschluss_id              uuid,
  wirtschaftsplan_position_id uuid,
  quelle                    text not null check (quelle in ('ki','muster','mensch')),
  confidence                numeric(4,3) check (confidence between 0 and 1),
  unique (dokument_id, zeile_nr)
);

create index kontierung_dokument_idx on kontierung (dokument_id);

comment on table kontierung is
  'Die Ordnungsgruppe steht am Dokument, nicht an der Zeile -- sie ist pro '
  'Beleg eindeutig. Konto, Umlagefaehigkeit und Umlageschluessel bleiben '
  'zeilenweise verschieden (Konzept 6).';

create table kontierung_35a (
  kontierung_id           uuid primary key references kontierung(id) on delete cascade,
  art                     text not null check (art in ('haushaltsnah','handwerkerleistung')),
  lohnanteil              numeric(14,2),
  fahrt_maschinenkosten   numeric(14,2),
  materialanteil          numeric(14,2),
  unbar_gezahlt           boolean not null default false
);

comment on table kontierung_35a is
  'Wird immer mitextrahiert, die Auswertung ist pro Objekt zuschaltbar.';


-- ---------------------------------------------------------------------------
-- Teil 4: Summenzwang und Umlageflag
-- ---------------------------------------------------------------------------

create or replace function app.kontierung_summe_stimmt(p_dokument_id uuid)
returns boolean
language sql
stable
set search_path = public, app
as $$
  select coalesce(sum(k.betrag_brutto), 0) = coalesce(f.brutto, 0)
    from rechnung_fakten f
    left join kontierung k on k.dokument_id = f.dokument_id
   where f.dokument_id = p_dokument_id
   group by f.brutto;
$$;

comment on function app.kontierung_summe_stimmt(uuid) is
  'Summe der Kontierungszeilen gegen den Rechnungsbetrag. Verletzung '
  'blockiert die Kontierungsstufe. Die Pruefung laeuft ueber die Kontierung '
  'und NICHT ueber die Zahlungszeilen -- sonst verletzt der Eigenanteil bei '
  'Selbstbeteiligung sie, weil derselbe Beleg zweimal zur Zahlung geht '
  '(Konzept 13.1).';

create or replace function app.umlageflag_pflegen()
returns trigger
language plpgsql
set search_path = public, app
as $$
declare
  betroffen uuid;
begin
  betroffen := coalesce(new.dokument_id, old.dokument_id);

  update dokument d
     set hat_umlagefaehige_zeile = exists (
           select 1 from kontierung k
            where k.dokument_id = betroffen and k.umlagefaehig)
   where d.id = betroffen;

  return null;
end;
$$;

create trigger kontierung_umlageflag
  after insert or update or delete on kontierung
  for each row execute function app.umlageflag_pflegen();


-- ---------------------------------------------------------------------------
-- Teil 5: Belegeinsicht des Mieters
-- ---------------------------------------------------------------------------

-- Ein Mieter sieht einen Beleg genau dann, wenn dieser mindestens eine
-- umlagefaehige Kontierungszeile hat UND sein Leistungszeitraum die Mietzeit
-- ueberschneidet.
--
-- Zwei Dinge sind an der Umsetzung nicht beliebig (Konzept 7.1):
--
--   1. Sortierung und limit stehen INNERHALB der Funktion. "security definer"
--      verhindert das Inlining; stuenden sie ausserhalb, materialisierte der
--      Planer erst alle Treffer und sortierte danach.
--   2. Der Bezugszeitraum wird EINMAL aufgeloest, nicht je Dokument geprueft.
--      range_agg fasst mehrere Mietzeiten zu einem Multirange zusammen --
--      exakt auch bei Unterbrechung, und trotzdem nur eine Auswertung.
create or replace function app.belege_fuer_mieter(
  p_person_id uuid,
  p_objekt_id uuid,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  dokument_id     uuid,
  eingang_am      timestamptz,
  belegart        text,
  leistung_von    date,
  leistung_bis    date
)
language sql
stable
security definer
set search_path = public, app
as $$
  with mietzeit as (
    select range_agg(daterange(pb.gueltig_von,
                               coalesce(pb.gueltig_bis, 'infinity'::date), '[]')) as zeit
      from person_bezug pb
     where pb.person_id = p_person_id
       and pb.objekt_id = p_objekt_id
       and pb.art = 'mieter'
  )
  select d.id, d.eingang_am, d.belegart, d.leistung_von, d.leistung_bis
    from dokument d, mietzeit m
   where d.objekt_id = p_objekt_id
     and d.hat_umlagefaehige_zeile
     and d.leistung_von is not null
     and m.zeit is not null
     and m.zeit && daterange(d.leistung_von,
                             coalesce(d.leistung_bis, d.leistung_von), '[]')
   order by d.eingang_am desc
   limit p_limit offset p_offset;
$$;

comment on function app.belege_fuer_mieter(uuid, uuid, integer, integer) is
  'Die Mietersicht wird gerechnet, nicht freigegeben. Keine manuelle '
  'Belegfreigabe einbauen -- sie uebersieht Mieterwechsel (Konzept 22, 13).';


-- ---------------------------------------------------------------------------
-- Teil 6: Berechtigungen
-- ---------------------------------------------------------------------------

alter table einheit         enable row level security;
alter table person          enable row level security;
alter table person_bezug    enable row level security;
alter table kontierung      enable row level security;
alter table kontierung_35a  enable row level security;

create policy einheit_sicht on einheit for all
  using (objekt_id = any (app.meine_objekte()))
  with check (objekt_id = any (app.meine_objekte()));

create policy person_sicht on person for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

create policy person_bezug_sicht on person_bezug for all
  using (objekt_id = any (app.meine_objekte()))
  with check (objekt_id = any (app.meine_objekte()));

create policy kontierung_sicht on kontierung for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy kontierung_35a_sicht on kontierung_35a for all
  using (exists (select 1 from kontierung k where k.id = kontierung_id))
  with check (exists (select 1 from kontierung k where k.id = kontierung_id));

grant select, insert, update, delete
  on einheit, person, person_bezug, kontierung, kontierung_35a to dms_app;
grant execute on function app.belege_fuer_mieter(uuid, uuid, integer, integer) to dms_app;
grant execute on function app.kontierung_summe_stimmt(uuid) to dms_app;
