-- Layer: Stempel, Notizen, Hervorhebungen, Schwaerzungen (Konzept 16)
--
-- **Alles liegt neben dem PDF, nichts darin.** Das ist keine Sparsamkeit,
-- sondern gibt vier Dinge auf einmal:
--
--   * Das Original bleibt bitgenau -- der Hash im Archiv gilt weiter.
--   * Anmerkungen sind volltextdurchsuchbar (`inhalt_tsv`).
--   * Die Sichtbarkeit ist je Layer steuerbar: Eine interne Notiz geht nie
--     in die externe Belegeinsicht.
--   * Der Export kann Layer wahlweise einbrennen oder weglassen.
--
-- Der Preis dafuer: Wer das PDF direkt herunterlaedt, sieht nichts davon.
-- Genau deshalb hat der Export vier Varianten (Konzept 16) und die externe
-- Einsicht liefert nie das Original.


-- ---------------------------------------------------------------------------
-- Teil 1: Wo ein Stempel hindarf
-- ---------------------------------------------------------------------------

-- Freie Plaetze auf der Seite, bei der Aufbereitung gerechnet.
--
-- Bisher stand in `aufbereitung.ts`: "Die Fundstellen der einzelnen
-- Textstuecke bleiben vorerst im Speicher. Persistiert werden sie erst, wenn
-- die Stempelplatzierung sie braucht." Jetzt braucht sie sie.
--
-- Gespeichert werden aber **nicht** die Fundstellen, sondern das Ergebnis:
-- eine Handvoll fertiger Rechtecke. Die Fundstellen waeren bei einer Million
-- Dokumenten zweistellige Gigabytes; die Rechtecke sind ein paar hundert
-- Bytes je Seite. Und sie muessen ohnehin nur einmal gerechnet werden -- der
-- Text aendert sich nicht mehr.
alter table dokument_seite
  add column freie_bloecke jsonb;

comment on column dokument_seite.freie_bloecke is
  'Fertige Stempelplaetze in Reihenfolge (Konzept 16: rechts oben, dann '
  'rechts unten). Ergebnis statt Rohdaten -- die Fundstellen selbst waeren '
  'bei einer Million Dokumenten zweistellige Gigabytes. Leeres Array heisst: '
  'Seite voll, es braucht eine Leerseite.';


-- ---------------------------------------------------------------------------
-- Teil 2: Die Layer
-- ---------------------------------------------------------------------------

create table dokument_layer (
  id                 uuid primary key default gen_random_uuid(),
  dokument_id        uuid not null references dokument(id) on delete cascade,

  -- Denormalisiert wie ueberall, wo eine Policy sonst joinen muesste
  -- (Migration 20260831210000). `objekt_id` traegt die Sichtbarkeit.
  mandant_id         uuid not null references mandant(id),
  objekt_id          uuid references objekt(id),

  typ                text not null check (typ in
                       ('stempel','notiz','highlight','schwaerzung')),
  -- 0 heisst: gehoert auf eine angehaengte Leerseite, weil auf Seite 1 kein
  -- Platz mehr war (Konzept 16).
  seite              integer not null check (seite >= 0),

  -- Ursprung oben links, in PDF-Punkten -- dieselbe Rechnung wie in
  -- `dokument_seite.breite`/`hoehe` und in `seitenLesen`.
  x                  numeric(10,2) not null,
  y                  numeric(10,2) not null,
  breite             numeric(10,2) not null check (breite > 0),
  hoehe              numeric(10,2) not null check (hoehe > 0),

  inhalt_text        text,
  inhalt_tsv         tsvector generated always as
                       (to_tsvector('german', coalesce(inhalt_text, ''))) stored,

  -- Beim Stempel die Verbindung zum Ereignis. Der Layer ist die *Darstellung*
  -- des Ereignisses, nie seine Quelle: `stempel_ereignis` bleibt die Wahrheit.
  stempel_ereignis_id uuid references stempel_ereignis(id) on delete cascade,

  sichtbarkeit       text not null default 'intern'
                       check (sichtbarkeit in ('intern','extern','alle')),

  erstellt_von       uuid references benutzer(id),
  erstellt_am        timestamptz not null default now(),
  -- Geloescht wird nie wirklich: Eine Notiz, die spurlos verschwindet, macht
  -- den Beleg unerklaerbar. Sie wird ausgeblendet.
  geloescht_am       timestamptz,
  geloescht_von      uuid references benutzer(id),

  constraint dokument_layer_stempel_hat_ereignis
    check ((typ = 'stempel') = (stempel_ereignis_id is not null)),
  constraint dokument_layer_geloescht_vollstaendig
    check ((geloescht_am is null) = (geloescht_von is null))
);

create index dokument_layer_seite_idx
  on dokument_layer (dokument_id, seite) where geloescht_am is null;
create index dokument_layer_tsv_idx on dokument_layer using gin (inhalt_tsv);
-- Ein Stempelereignis hat hoechstens einen Layer.
create unique index dokument_layer_ereignis_idx
  on dokument_layer (stempel_ereignis_id) where stempel_ereignis_id is not null;

comment on table dokument_layer is
  'Stempel, Notizen, Hervorhebungen und Schwaerzungen -- neben dem PDF, nie '
  'darin (Konzept 16). Das Original bleibt bitgenau, die Sichtbarkeit ist je '
  'Layer steuerbar, und der Export entscheidet, was eingebrannt wird.';

comment on column dokument_layer.sichtbarkeit is
  '`intern` ist die Vorgabe und die sichere Richtung: Eine Notiz geht nur '
  'nach draussen, wenn jemand das ausdruecklich sagt. `schwaerzung` wirkt '
  'unabhaengig davon immer nach aussen -- sie verdeckt, sie zeigt nicht.';

comment on column dokument_layer.geloescht_am is
  'Ausgeblendet, nicht entfernt. Eine Notiz, die spurlos verschwindet, macht '
  'den Beleg unerklaerbar -- und eine geloeschte Schwaerzung waere ein '
  'Datenschutzvorfall ohne Spur.';


alter table dokument_layer enable row level security;

-- Dieselbe Form wie `dokument_lesen`, mit unkorrelierter Unterabfrage. Ein
-- Join nach `dokument` liefe im Zeilenfilter je Zeile.
create policy dokument_layer_lesen on dokument_layer
  for select using (
    mandant_id = (select app.mein_mandant())
    and (objekt_id is null
         or objekt_id = any ((select app.meine_objekte())::uuid[])
         or exists (select 1 from dokument d
                     where d.id = dokument_id
                       and d.spezialgebiet_id = any (
                             (select app.meine_spezialgebiete())::uuid[])))
  );

create policy dokument_layer_anlegen on dokument_layer
  for insert with check (
    mandant_id = (select app.mein_mandant())
    and (objekt_id is null
         or objekt_id = any ((select app.meine_objekte())::uuid[]))
  );

create policy dokument_layer_aendern on dokument_layer
  for update using (
    mandant_id = (select app.mein_mandant())
    and (objekt_id is null
         or objekt_id = any ((select app.meine_objekte())::uuid[]))
  );

grant select, insert, update on dokument_layer to dms_app;


-- Ein Layer ist so unveraenderlich wie der Beleg, an dem er haengt.
--
-- Erlaubt ist genau eines: ausblenden. Wer den Text einer Notiz nachtraeglich
-- aendern koennte, koennte eine Entscheidung umschreiben, die jemand anders
-- getroffen hat -- und beim Stempel waere es die Hash-Kette gleich mit.
create or replace function app.layer_unveraenderlich()
returns trigger
language plpgsql
as $$
begin
  if new.dokument_id is distinct from old.dokument_id
     or new.typ is distinct from old.typ
     or new.seite is distinct from old.seite
     or new.x is distinct from old.x
     or new.y is distinct from old.y
     or new.breite is distinct from old.breite
     or new.hoehe is distinct from old.hoehe
     or new.inhalt_text is distinct from old.inhalt_text
     or new.stempel_ereignis_id is distinct from old.stempel_ereignis_id
     or new.erstellt_von is distinct from old.erstellt_von
     or new.erstellt_am is distinct from old.erstellt_am then
    raise exception
      'Ein Layer wird nicht geaendert, sondern ausgeblendet und neu angelegt.';
  end if;

  if old.geloescht_am is not null and new.geloescht_am is null then
    raise exception 'Ein ausgeblendeter Layer kommt nicht zurueck.';
  end if;

  return new;
end;
$$;

create trigger dokument_layer_unveraenderlich
  before update on dokument_layer
  for each row execute function app.layer_unveraenderlich();


-- ---------------------------------------------------------------------------
-- Teil 3: Der Stempel entsteht mit dem Ereignis
-- ---------------------------------------------------------------------------

-- Wo der naechste Stempel hindarf.
--
-- `security definer`, weil auch der Trigger unten sie ruft -- und der laeuft
-- in derselben Transaktion wie ein Stempel, moeglicherweise ohne dass der
-- Stempelnde den Beleg ueber `objekt_id` sieht (Pool-Aufgaben).
create or replace function app.stempelplatz(p_dokument_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  bloecke jsonb;
  benutzt integer;
begin
  select s.freie_bloecke into bloecke
    from dokument_seite s
   where s.dokument_id = p_dokument_id and s.seite = 1;

  if bloecke is null or jsonb_array_length(bloecke) = 0 then
    return null;
  end if;

  select count(*) into benutzt
    from dokument_layer l
   where l.dokument_id = p_dokument_id
     and l.typ = 'stempel'
     and l.seite = 1
     and l.geloescht_am is null;

  -- Alle Plaetze belegt: Es braucht eine Leerseite. Die haengt der Export an,
  -- nicht die Datenbank -- hier wird nur gesagt, dass kein Platz mehr ist.
  if benutzt >= jsonb_array_length(bloecke) then
    return null;
  end if;

  return bloecke -> benutzt;
end;
$$;

comment on function app.stempelplatz(uuid) is
  'Der naechste freie Stempelplatz auf Seite 1, oder NULL wenn keiner mehr '
  'da ist. Die Plaetze selbst rechnet der Worker bei der Aufbereitung '
  '(Konzept 16) -- hier wird nur abgezaehlt.';


-- Zu jedem Stempelereignis ein Layer.
--
-- Als Trigger und nicht in der Anwendung, aus demselben Grund wie beim
-- `freigabe_hash`: Ein Ereignis ohne Layer waere ein Stempel, den man im
-- Beleg nicht sieht -- und niemand wuesste, ob er fehlt oder nie gesetzt
-- wurde.
--
-- `verfallen` bekommt keinen eigenen Layer, sondern blendet den aus, dessen
-- Freigabe gebrochen ist. Ein Beleg mit vier Stempeln, von denen zwei nicht
-- mehr gelten, muss beim Ansehen als solcher erkennbar sein.
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
  bezeichnung text;
  sichtbar  boolean;
  wer       text;
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

  -- Ein Stempeltyp kann ausdruecklich unsichtbar sein -- Systemaktionen etwa
  -- gehoeren ins Protokoll, aber nicht auf den Beleg. Das Ereignis entsteht
  -- trotzdem; nur die Darstellung entfaellt.
  select t.name, t.sichtbar_auf_beleg into bezeichnung, sichtbar
    from stempeltyp t where t.id = new.stempeltyp_id;
  if sichtbar is false then
    return new;
  end if;

  select d.mandant_id, d.objekt_id into mand, obj from dokument d where d.id = dok;

  platz := app.stempelplatz(dok);
  if platz is null then
    -- Kein Platz auf Seite 1 -- oder die Seite wurde nie aufbereitet. Der
    -- Layer entsteht trotzdem: Seite 0 heisst "gehoert auf eine angehaengte
    -- Leerseite" (Konzept 16). Ein Stempel darf nie verloren gehen, nur weil
    -- die Seite voll ist.
    seitennr := 0;
    platz := jsonb_build_object('x', 40, 'y', 40, 'breite', 190, 'hoehe', 64);
  else
    seitennr := 1;
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
    coalesce(bezeichnung, '') || ' · ' || coalesce(wer, '') ||
      ' · ' || to_char(new.zeitpunkt, 'DD.MM.YYYY') ||
      coalesce(' · ' || nullif(btrim(new.kommentar), ''), ''),
    new.id,
    -- Stempel gehen mit nach draussen: Wer einen Beleg zur Einsicht bekommt,
    -- soll sehen, dass und von wem er geprueft wurde (Konzept 16).
    'alle',
    new.benutzer_id
  );

  return new;
end;
$$;

create trigger stempel_ereignis_layer
  after insert on stempel_ereignis
  for each row execute function app.stempel_layer_setzen();


-- ---------------------------------------------------------------------------
-- Teil 4: Layer von Hand
-- ---------------------------------------------------------------------------

-- Notiz, Hervorhebung, Schwaerzung.
--
-- Kein `security definer`: Wer den Beleg nicht sieht, schreibt auch nichts
-- daran. Die Policy oben ist die Grenze.
create or replace function app.layer_anlegen(
  p_dokument_id  uuid,
  p_typ          text,
  p_seite        integer,
  p_x            numeric,
  p_y            numeric,
  p_breite       numeric,
  p_hoehe        numeric,
  p_text         text default null,
  p_sichtbarkeit text default 'intern'
)
returns uuid
language plpgsql
set search_path = public, app
as $$
declare
  mand  uuid;
  obj   uuid;
  neuer uuid;
begin
  if p_typ = 'stempel' then
    raise exception
      'Ein Stempel entsteht aus seinem Ereignis, nicht von Hand.';
  end if;

  -- Ueber die Sicht des Aufrufers: Steht hier nichts, ist der Beleg fuer ihn
  -- nicht da, und der Layer entsteht nicht.
  select d.mandant_id, d.objekt_id into mand, obj
    from dokument d where d.id = p_dokument_id;
  if mand is null then
    return null;
  end if;

  insert into dokument_layer (
    dokument_id, mandant_id, objekt_id, typ, seite,
    x, y, breite, hoehe, inhalt_text, sichtbarkeit, erstellt_von
  ) values (
    p_dokument_id, mand, obj, p_typ, p_seite,
    p_x, p_y, p_breite, p_hoehe, nullif(btrim(coalesce(p_text, '')), ''),
    -- Eine Schwaerzung verdeckt; ihre Sichtbarkeit zu setzen waere sinnlos
    -- und gefaehrlich, wenn jemand `intern` waehlt und sie nach aussen
    -- verschwindet.
    case when p_typ = 'schwaerzung' then 'alle' else p_sichtbarkeit end,
    app.mein_benutzer()
  )
  returning id into neuer;

  return neuer;
end;
$$;

grant execute on function
  app.layer_anlegen(uuid, text, integer, numeric, numeric, numeric, numeric,
                    text, text) to dms_app;


create or replace function app.layer_ausblenden(p_id uuid)
returns boolean
language plpgsql
set search_path = public, app
as $$
declare
  betroffen integer;
begin
  update dokument_layer
     set geloescht_am = now(), geloescht_von = app.mein_benutzer()
   where id = p_id
     and geloescht_am is null
     -- Ein Stempel wird nicht ausgeblendet. Er verfaellt, und das ist ein
     -- Ereignis -- kein Handgriff an der Darstellung.
     and typ <> 'stempel';

  get diagnostics betroffen = row_count;
  return betroffen > 0;
end;
$$;

grant execute on function app.layer_ausblenden(uuid) to dms_app;
grant execute on function app.stempelplatz(uuid) to dms_app;
