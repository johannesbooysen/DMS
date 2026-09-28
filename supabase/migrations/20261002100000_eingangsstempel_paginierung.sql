-- Eingangsstempel und Paginiernummer -- der Abschluss des Posteingangs.
--
-- Beim Bedienen gewuenscht: "sobald der Posteingang abgeschlossen ist, soll
-- das Dokument mit einem Vermerk Posteingang (Stempel Posteingang) versehen
-- werden, Zusatzangaben Mitarbeiter, Datum. Ferner soll jedes Dokument eine
-- Paginiernummer bekommen, in den Stammdaten konfigurierbar."
--
-- Abgeschlossen ist der Posteingang, wenn der Worker den Beleg aufbereitet
-- hat (Seiten, Text, freie Plaetze) -- erst dann gibt es eine Seite, auf
-- der ein Stempel stehen kann. Der Worker ruft app.eingang_abschliessen in
-- derselben Transaktion, in der er den Beleg auf `laufend` stellt.
--
-- Drei Entscheidungen:
--
-- 1. **Der Eingangsstempel ist ein Stempeltyp** (entscheidung 'eingang'),
--    kein Sonderfall im Code: Aussehen, Felder und Farbe kommen aus dem
--    Designer wie bei jedem Stempel. Er haengt an keiner Stufe und taucht
--    deshalb nie als Knopf auf (app.moegliche_stempel verlangt eine Stufe).
--    Fehlt er oder ist er deaktiviert, gibt es keinen Eingangsstempel --
--    das ist die Einstellung "aus".
--
-- 2. **Kein Stempelereignis.** Die Hash-Kette haelt Entscheidungen von
--    Menschen fest; ein Eingangsvermerk ist keine. Der Layer traegt deshalb
--    `stempeltyp_id` direkt statt ueber ein Ereignis -- die Pruefbedingung
--    "ein Stempel hat ein Ereignis" wird zu "ein Stempel hat ein Ereignis
--    oder einen Typ". Verschieben laesst er sich nicht (kein Setzer).
--
-- 3. **Die Paginiernummer ist lueckenlos und je Mandant eindeutig.** Ein
--    Zaehler je Mandant und Jahr, gesperrt beim Vergeben (`for update`),
--    damit zwei Worker nicht dieselbe Nummer ziehen. Vergeben wird einmal
--    und nie wieder geaendert -- eine Paginierung, die sich aendert, ist
--    keine. Die Einstellung (Praefix, Jahr, Stellen, an/aus) ist ein
--    Stammdatum mit beiden Policies; fehlt sie, gelten Vorgaben.
--
-- Bestandsuebernahmen (eingangskanal 'uebernahme') bekommen weder Stempel
-- noch Nummer: Ein Beleg von 2019 ist nicht heute eingegangen.

-- ---------------------------------------------------------------------------
-- Teil 1: Stempeltyp 'eingang', Layer ohne Ereignis
-- ---------------------------------------------------------------------------

alter table stempeltyp drop constraint stempeltyp_entscheidung_check;
alter table stempeltyp add constraint stempeltyp_entscheidung_check
  check (entscheidung in ('freigabe','ablehnung','rueckgabe','klaerung','systemaktion','eingang'));

alter table dokument_layer add column stempeltyp_id uuid references stempeltyp(id);
comment on column dokument_layer.stempeltyp_id is
  'Stempeltyp eines Stempels ohne Ereignis (Eingangsstempel). Bei Stempeln '
  'aus einem Ereignis steht der Typ am Ereignis, hier null.';

alter table dokument_layer drop constraint dokument_layer_stempel_hat_ereignis;
alter table dokument_layer add constraint dokument_layer_stempel_hat_ereignis
  check ((typ = 'stempel') = (stempel_ereignis_id is not null or stempeltyp_id is not null));

-- ---------------------------------------------------------------------------
-- Teil 2: Paginierung
-- ---------------------------------------------------------------------------

alter table dokument add column paginiernummer text;
create unique index dokument_paginiernummer_idx
  on dokument (mandant_id, paginiernummer) where paginiernummer is not null;
comment on column dokument.paginiernummer is
  'Fortlaufende Eingangsnummer je Mandant, vergeben beim Abschluss des '
  'Posteingangs (app.eingang_abschliessen), danach unveraenderlich.';

create table paginierung (
  mandant_id  uuid primary key references mandant(id),
  aktiv       boolean not null default true,
  praefix     text not null default '',
  mit_jahr    boolean not null default true,
  stellen     integer not null default 6 check (stellen between 1 and 10)
);
comment on table paginierung is
  'Einstellung der Paginiernummer je Mandant: Praefix, Jahr im Nummernkreis, '
  'Stellen, an/aus. Stammdatum ohne Personenbezug. Fehlt die Zeile, gelten '
  'die Vorgaben der Spalten.';

alter table paginierung enable row level security;
create policy paginierung_lesen on paginierung for select
  using (mandant_id = (select app.mein_mandant()));
create policy paginierung_schreiben on paginierung for all
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));
grant select, insert, update, delete on paginierung to dms_app;

create table paginierung_zaehler (
  mandant_id  uuid not null references mandant(id),
  jahr        integer not null,
  naechste    bigint not null default 1,
  primary key (mandant_id, jahr)
);
comment on table paginierung_zaehler is
  'Der naechste freie Zaehlerstand je Mandant und Jahr (0 = ohne Jahr). Nur '
  'app.eingang_abschliessen schreibt hier; lesen darf der Mandant.';
alter table paginierung_zaehler enable row level security;
create policy paginierung_zaehler_lesen on paginierung_zaehler for select
  using (mandant_id = (select app.mein_mandant()));
grant select on paginierung_zaehler to dms_app;

-- Eine vergebene Nummer aendert sich nie -- auch nicht durch den Eigentuemer
-- mit einem gut gemeinten update.
create or replace function app.paginiernummer_fest()
returns trigger
language plpgsql
as $$
begin
  if old.paginiernummer is not null and new.paginiernummer is distinct from old.paginiernummer then
    raise exception 'Die Paginiernummer ist vergeben und aendert sich nicht.';
  end if;
  return new;
end;
$$;
create trigger dokument_paginiernummer_fest
  before update of paginiernummer on dokument
  for each row execute function app.paginiernummer_fest();

-- ---------------------------------------------------------------------------
-- Teil 3: Der Stempeltext -- einmal, fuer Trigger und Eingangsstempel
-- ---------------------------------------------------------------------------

-- Neues Feld 'paginiernummer' fuer jeden Stempel.
create or replace function app.stempel_feldwert(
  p_feld        text,
  p_name        text,
  p_wer         text,
  p_zeitpunkt   timestamptz,
  p_kommentar   text,
  p_dokument_id uuid,
  p_stufe_id    uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  wert text;
begin
  case p_feld
    when 'text' then return p_name;
    when 'mitarbeiter' then return p_wer;
    when 'datum' then return to_char(p_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY');
    when 'uhrzeit' then return to_char(p_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI');
    when 'kommentar' then return nullif(btrim(coalesce(p_kommentar, '')), '');
    when 'objekt' then
      select 'Objekt ' || o.objektnummer into wert
        from dokument d join objekt o on o.id = d.objekt_id where d.id = p_dokument_id;
      return wert;
    when 'betrag' then
      select replace(replace(replace(to_char(f.brutto, 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.')
             || ' EUR'
        into wert
        from rechnung_fakten f where f.dokument_id = p_dokument_id and f.brutto is not null;
      return wert;
    when 'stufe' then
      select s.bezeichnung into wert from prozessstufe s where s.id = p_stufe_id;
      return wert;
    when 'paginiernummer' then
      select d.paginiernummer into wert from dokument d where d.id = p_dokument_id;
      return wert;
    else return null;
  end case;
end;
$$;

-- Der Text aus den Feldern des Stempeltyps: Stempeltext zuerst, Datum und
-- Uhrzeit ruecken zusammen -- dieselbe Regel wie textZusammensetzen in
-- src/layer/gestaltung.ts. Vorher stand das im Layer-Trigger; jetzt an einer
-- Stelle fuer Trigger und Eingangsstempel.
create or replace function app.stempeltext(
  p_stempeltyp_id uuid,
  p_wer           text,
  p_zeitpunkt     timestamptz,
  p_kommentar     text,
  p_dokument_id   uuid,
  p_stufe_id      uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  bezeichnung text;
  felder    jsonb;
  feld      text;
  wert      text;
  teile     text[];
  zeit      text[] := '{}';
begin
  select t.name,
         coalesce(t.gestaltung->'felder', '["text","mitarbeiter","datum","uhrzeit"]'::jsonb)
    into bezeichnung, felder
    from stempeltyp t where t.id = p_stempeltyp_id;
  if felder is null or jsonb_typeof(felder) <> 'array' or jsonb_array_length(felder) = 0 then
    felder := '["text","mitarbeiter","datum","uhrzeit"]'::jsonb;
  end if;

  teile := array[coalesce(bezeichnung, '')];
  for feld in select jsonb_array_elements_text(felder) loop
    if feld = 'text' then continue; end if;
    wert := app.stempel_feldwert(feld, bezeichnung, p_wer, p_zeitpunkt, p_kommentar, p_dokument_id, p_stufe_id);
    if wert is null then continue; end if;
    if feld in ('datum', 'uhrzeit') then
      zeit := zeit || wert;
      continue;
    end if;
    if array_length(zeit, 1) > 0 then
      teile := teile || array_to_string(zeit, ' ');
      zeit := '{}';
    end if;
    teile := teile || wert;
  end loop;
  if array_length(zeit, 1) > 0 then
    teile := teile || array_to_string(zeit, ' ');
  end if;
  return array_to_string(teile, ' · ');
end;
$$;

-- Der Layer-Trigger, jetzt ueber app.stempeltext -- sonst wie in
-- Migration 20261001120000 (Lage vom Menschen, sonst app.stempelplatz).
create or replace function app.stempel_layer_setzen()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  dok       uuid;
  mand      uuid;
  obj       uuid;
  platz     jsonb;
  seitennr  integer;
  sichtbar  boolean;
  wer       text;
  grund     text;
begin
  select l.dokument_id into dok from dokument_lauf l where l.id = new.lauf_id;
  if dok is null then
    return new;
  end if;

  if new.entscheidung = 'verfallen' then
    update dokument_layer
       set geloescht_am = now(), geloescht_von = new.benutzer_id
     where dokument_id = dok
       and typ = 'stempel'
       and geloescht_am is null
       and stempel_ereignis_id in (
         select e.id from stempel_ereignis e
          where e.lauf_id = new.lauf_id
            and e.stufe_id is not distinct from new.stufe_id
            and e.entscheidung = 'freigabe'
       );
    return new;
  end if;

  select t.sichtbar_auf_beleg into sichtbar from stempeltyp t where t.id = new.stempeltyp_id;
  if sichtbar is false then
    return new;
  end if;

  select d.mandant_id, d.objekt_id into mand, obj from dokument d where d.id = dok;

  if new.lage is not null then
    seitennr := (new.lage->>'seite')::integer;
    platz := new.lage;
    grund := app.stempel_lage_pruefen(
      dok, null, seitennr,
      (platz->>'x')::numeric, (platz->>'y')::numeric,
      (platz->>'breite')::numeric, (platz->>'hoehe')::numeric);
    if grund is not null then
      raise exception 'Der Stempel kann dort nicht stehen: %', grund;
    end if;
  else
    platz := app.stempelplatz(dok);
    if platz is null then
      seitennr := 0;
      platz := jsonb_build_object('x', 40, 'y', 40, 'breite', 190, 'hoehe', 64);
    else
      seitennr := 1;
    end if;
  end if;

  select b.name into wer from benutzer b where b.id = new.benutzer_id;

  insert into dokument_layer (
    dokument_id, mandant_id, objekt_id, typ, seite,
    x, y, breite, hoehe, inhalt_text, stempel_ereignis_id,
    sichtbarkeit, erstellt_von
  ) values (
    dok, mand, obj, 'stempel', seitennr,
    (platz->>'x')::numeric, (platz->>'y')::numeric,
    (platz->>'breite')::numeric, (platz->>'hoehe')::numeric,
    app.stempeltext(new.stempeltyp_id, wer, new.zeitpunkt, new.kommentar, dok, new.stufe_id),
    new.id,
    'alle',
    new.benutzer_id
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Teil 4: Der Abschluss des Posteingangs
-- ---------------------------------------------------------------------------

-- security definer: Der Worker laeuft unter dem Einliefernden, und der darf
-- weder den Zaehler schreiben noch einen Layer ohne eigenes Recht anlegen.
-- Gibt die Paginiernummer zurueck (null, wenn keine vergeben wurde).
-- Idempotent: ein zweiter Aufruf (Aufbereitung wiederholt) vergibt nichts
-- zweimal und stempelt nicht zweimal.
create or replace function app.eingang_abschliessen(p_dokument_id uuid, p_zeitpunkt timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public, app
as $$
declare
  d         dokument%rowtype;
  e         paginierung%rowtype;
  v_jahr    integer;
  stand     bigint;
  nummer    text;
  v_typ     uuid;
  platz     jsonb;
  seitennr  integer;
  wer       text;
begin
  select * into d from dokument where id = p_dokument_id;
  if d.id is null or d.eingangskanal = 'uebernahme' then
    return d.paginiernummer;
  end if;

  -- Paginiernummer, einmal.
  if d.paginiernummer is null then
    select * into e from paginierung where mandant_id = d.mandant_id;
    if e.mandant_id is null then
      e.aktiv := true; e.praefix := ''; e.mit_jahr := true; e.stellen := 6;
    end if;
    if e.aktiv then
      v_jahr := case when e.mit_jahr then extract(year from p_zeitpunkt at time zone 'Europe/Berlin')::integer else 0 end;
      insert into paginierung_zaehler (mandant_id, jahr) values (d.mandant_id, v_jahr)
        on conflict do nothing;
      select naechste into stand from paginierung_zaehler
       where paginierung_zaehler.mandant_id = d.mandant_id and paginierung_zaehler.jahr = v_jahr
         for update;
      -- Die Nummer wird gesetzt, bevor der Zaehler weiterrueckt: Scheitert
      -- das update, rollt beides zurueck, und es entsteht keine Luecke.
      nummer := e.praefix
                || case when e.mit_jahr then v_jahr::text || '-' else '' end
                || lpad(stand::text, e.stellen, '0');
      update dokument set paginiernummer = nummer where id = d.id;
      update paginierung_zaehler set naechste = stand + 1
       where paginierung_zaehler.mandant_id = d.mandant_id and paginierung_zaehler.jahr = v_jahr;
      d.paginiernummer := nummer;
    end if;
  end if;

  -- Eingangsstempel, einmal -- wenn das Haus einen aktiven Typ dafuer hat.
  select t.id into v_typ from stempeltyp t
   where t.mandant_id = d.mandant_id and t.entscheidung = 'eingang' and t.aktiv and t.sichtbar_auf_beleg
   order by t.name limit 1;
  if v_typ is null then
    return d.paginiernummer;
  end if;
  if exists (select 1 from dokument_layer l
              where l.dokument_id = d.id and l.typ = 'stempel' and l.stempeltyp_id = v_typ and l.geloescht_am is null) then
    return d.paginiernummer;
  end if;

  platz := app.stempelplatz(d.id);
  if platz is null then
    seitennr := 0;
    platz := jsonb_build_object('x', 40, 'y', 40, 'breite', 190, 'hoehe', 64);
  else
    seitennr := 1;
  end if;

  select b.name into wer from benutzer b where b.id = d.erfasst_von;

  insert into dokument_layer (
    dokument_id, mandant_id, objekt_id, typ, seite,
    x, y, breite, hoehe, inhalt_text, stempeltyp_id,
    sichtbarkeit, erstellt_von
  ) values (
    d.id, d.mandant_id, d.objekt_id, 'stempel', seitennr,
    (platz->>'x')::numeric, (platz->>'y')::numeric,
    (platz->>'breite')::numeric, (platz->>'hoehe')::numeric,
    app.stempeltext(v_typ, coalesce(wer, 'System'), p_zeitpunkt, null, d.id, null),
    v_typ,
    'alle',
    d.erfasst_von
  );

  return d.paginiernummer;
end;
$$;

comment on function app.eingang_abschliessen(uuid, timestamptz) is
  'Abschluss des Posteingangs: vergibt die Paginiernummer (Zaehler je Mandant '
  'und Jahr, gesperrt) und setzt den Eingangsstempel (Stempeltyp mit '
  'entscheidung eingang, ohne Ereignis). Nicht fuer Bestandsuebernahmen. '
  'Idempotent.';

grant execute on function app.eingang_abschliessen(uuid, timestamptz) to dms_app;
grant execute on function app.stempeltext(uuid, text, timestamptz, text, uuid, uuid) to dms_app;

-- ---------------------------------------------------------------------------
-- Teil 5: Suche nach der Paginiernummer
-- ---------------------------------------------------------------------------

create or replace function app.suchtreffer(p_begriff text, p_betrag numeric, p_kennung text)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select f.dokument_id
    from rechnung_fakten f
    join dokument d on d.id = f.dokument_id
   where d.mandant_id = app.mein_mandant()
     and f.rechnungsnummer ilike '%' || p_begriff || '%'
  union
  select d.id
    from dokument d
   where d.mandant_id = app.mein_mandant()
     and d.paginiernummer = p_begriff
  union
  select f.dokument_id
    from rechnung_fakten f
    join kreditor k on k.id = f.kreditor_id
   where k.mandant_id = app.mein_mandant()
     and k.name ilike '%' || p_begriff || '%'
  union
  select sv.dokument_id
    from schriftverkehr_fakten sv
    join dokument d on d.id = sv.dokument_id
   where d.mandant_id = app.mein_mandant()
     and (sv.korrespondent ilike '%' || p_begriff || '%' or sv.betreff ilike '%' || p_begriff || '%')
  union
  select d.id
    from dokument d
    join objekt o on o.id = d.objekt_id
   where d.mandant_id = app.mein_mandant()
     and o.objektnummer = p_begriff
  union
  select s.dokument_id
    from dokument_seite s
    join dokument d on d.id = s.dokument_id
   where d.mandant_id = app.mein_mandant()
     and s.text_tsv @@ websearch_to_tsquery('german', p_begriff)
  union
  select f.dokument_id
    from rechnung_fakten f
    join dokument d on d.id = f.dokument_id
   where p_kennung is not null
     and d.mandant_id = app.mein_mandant()
     and upper(replace(f.iban_im_beleg, ' ', '')) = upper(p_kennung)
  union
  select f.dokument_id
    from rechnung_fakten f
    join dokument d on d.id = f.dokument_id
   where p_betrag is not null
     and d.mandant_id = app.mein_mandant()
     and (f.brutto = p_betrag or f.netto = p_betrag)
$$;

-- ---------------------------------------------------------------------------
-- Teil 6: Der Eingangsstempel fuer bestehende Haeuser
-- ---------------------------------------------------------------------------

-- Ein Stempeltyp je Mandant, der noch keinen hat -- der Seed legt ihn fuer
-- die Testdaten an, hier bekommen ihn die Haeuser, die schon laufen.
insert into stempeltyp (mandant_id, name, kurzcode, entscheidung, farbe, gestaltung)
select m.id, 'Posteingang', 'EING', 'eingang', '#5A6270',
       '{"felder":["text","paginiernummer","mitarbeiter","datum"],"form":"rechteck","rahmen":"durchgezogen","drehung":0,"schrift":"normal","linie":2,"schriftfarbe":null}'::jsonb
  from mandant m
 where not exists (select 1 from stempeltyp t where t.mandant_id = m.id and t.entscheidung = 'eingang')
   and not exists (select 1 from stempeltyp t where t.mandant_id = m.id and t.kurzcode = 'EING');
