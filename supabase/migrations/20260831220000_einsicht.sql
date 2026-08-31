-- Externe Belegeinsicht: Eigentuemer, Beirat, Mieter
--
-- Konzept 17. Ein befristeter, gefilterter Zugang fuer jemanden, der keinen
-- Benutzer im DMS hat und keinen bekommen soll.
--
-- Drei Saetze aus dem Konzept legen die Umsetzung fest, und jeder von ihnen
-- schliesst eine naheliegende, falsche Loesung aus:
--
--   1. "Der Mieter sieht ausschliesslich Belege, deren Kontierungszeilen als
--      umlagefaehig markiert sind -- der Filter kommt aus den Daten, nicht aus
--      einer manuellen Auswahl."
--      Also **keine** Liste freigegebener Belege an der Gewaehrung. Eine
--      manuelle Auswahl uebersieht den Mieterwechsel: Wer im Maerz auszieht,
--      darf die Aprilrechnung nicht sehen, auch wenn sie im Januar
--      freigegeben wurde.
--
--   2. "Der Ablauf ist hart: nach `gueltig_bis` liefert der Token nichts mehr,
--      unabhaengig davon, ob jemand ihn weitergegeben hat."
--      Also wird bei **jedem** Aufruf geprueft, nicht beim Anlegen einer
--      Sitzung. Es gibt keine Sitzung -- der Token ist der Zugang.
--
--   3. "Das Zugriffsprotokoll ist gleichzeitig der Nachweis, dass
--      Belegeinsicht gewaehrt wurde."
--      Also append-only, und es haelt fest, was tatsaechlich abgerufen wurde
--      -- nicht, was haette abgerufen werden koennen.


-- ---------------------------------------------------------------------------
-- Teil 1: Die Gewaehrung
-- ---------------------------------------------------------------------------

create table einsicht_gewaehrung (
  id              uuid primary key default gen_random_uuid(),
  mandant_id      uuid not null references mandant(id),
  objekt_id       uuid not null references objekt(id),
  empfaenger_typ  text not null check (empfaenger_typ in
                    ('eigentuemer','beirat','mieter')),
  person_id       uuid not null references person(id),

  umfang          text not null check (umfang in
                    ('vorgang','wirtschaftsjahr','belegliste')),
  -- Statt eines undurchsichtigen `belegfilter` aus dem Konzept stehen hier
  -- die beiden Groessen, auf die sich der Umfang tatsaechlich bezieht. Ein
  -- freier Filter waere nicht pruefbar -- und die Frage "was durfte diese
  -- Person sehen" muss Jahre spaeter beantwortbar sein.
  vorgang_id      uuid references vorgang(id),
  wirtschaftsjahr integer,

  rechte          text[] not null default '{ansicht}',
  wasserzeichen   boolean not null default true,

  gueltig_von     date not null default current_date,
  gueltig_bis     date not null,

  token_hash      bytea not null unique,
  erstellt_von    uuid references benutzer(id),
  erstellt_am     timestamptz not null default now(),
  widerrufen_am   timestamptz,
  widerrufen_von  uuid references benutzer(id),

  check (gueltig_bis >= gueltig_von),
  check (rechte <@ array['ansicht','kommentar','stempel','download']),
  check (umfang <> 'vorgang' or vorgang_id is not null),
  check (umfang <> 'wirtschaftsjahr' or wirtschaftsjahr is not null),
  -- Der Mieter bekommt seine Belege gerechnet; ein Vorgang oder ein
  -- Wirtschaftsjahr wuerde diese Rechnung nur verwaessern.
  check (empfaenger_typ <> 'mieter' or umfang = 'belegliste')
);

create index einsicht_gewaehrung_objekt_idx
  on einsicht_gewaehrung (objekt_id, gueltig_bis desc);

comment on table einsicht_gewaehrung is
  'Befristeter Zugang ohne Benutzerkonto. Der Token liegt beim Empfaenger, '
  'in der Tabelle steht nur sein SHA256 -- wer die Datenbank liest, kann '
  'damit keine Einsicht nehmen.';

comment on column einsicht_gewaehrung.rechte is
  'Was der Empfaenger darf. `ansicht` allein ist der Regelfall; `download` '
  'gibt das Original heraus und ist deshalb eine eigene Entscheidung.';

comment on column einsicht_gewaehrung.wasserzeichen is
  'Legt einen Hinweis ueber die angezeigte Seite. Verhindert kein Abfilmen, '
  'macht aber eine weitergereichte Aufnahme zuordenbar.';


-- ---------------------------------------------------------------------------
-- Teil 2: Das Zugriffsprotokoll
-- ---------------------------------------------------------------------------

create table zugriff_protokoll (
  id            bigserial primary key,
  gewaehrung_id uuid not null references einsicht_gewaehrung(id) on delete cascade,
  dokument_id   uuid references dokument(id) on delete set null,
  aktion        text not null check (aktion in
                  ('liste','ansicht','seite','download','abgelehnt')),
  zeitpunkt     timestamptz not null default now(),
  ip            inet
);

create index zugriff_protokoll_gewaehrung_idx
  on zugriff_protokoll (gewaehrung_id, zeitpunkt desc);

create trigger zugriff_protokoll_unveraenderlich
  before update or delete on zugriff_protokoll
  for each row execute function app.nur_anfuegen();

comment on table zugriff_protokoll is
  'APPEND ONLY. Gleichzeitig der Nachweis, dass Belegeinsicht gewaehrt wurde '
  '(Konzept 17) -- deshalb haelt es fest, was abgerufen wurde, nicht was '
  'abrufbar gewesen waere.';

comment on column zugriff_protokoll.ip is
  'Personenbezogen und trotzdem hier: Bei einem Zugang ohne Benutzerkonto ist '
  'die Adresse das einzige Merkmal, an dem sich ein weitergereichter Token '
  'erkennen laesst. Sie faellt mit der Gewaehrung weg, wenn diese geloescht '
  'wird -- eine eigene Aufbewahrungsfrist dafuer ist offen.';


-- ---------------------------------------------------------------------------
-- Teil 3: Aufloesen -- der harte Ablauf
-- ---------------------------------------------------------------------------

-- `security definer`, weil zum Zeitpunkt des Aufrufs niemand angemeldet ist.
-- Derselbe Grund wie bei app.sitzung_aufloesen, und derselbe Schutz: Der
-- Schluessel ist der Token, in der Datenbank steht nur sein Hash.
create or replace function app.einsicht_aufloesen(p_token_hash bytea)
returns table (
  gewaehrung_id  uuid,
  mandant_id     uuid,
  objekt_id      uuid,
  objektnummer   text,
  objekt_name    text,
  empfaenger_typ text,
  person_id      uuid,
  person_name    text,
  umfang         text,
  vorgang_id     uuid,
  wirtschaftsjahr integer,
  rechte         text[],
  wasserzeichen  boolean,
  gueltig_bis    date
)
language sql
stable
security definer
set search_path = public, app
as $$
  select g.id, g.mandant_id, g.objekt_id, o.objektnummer, o.bezeichnung,
         g.empfaenger_typ, g.person_id, p.name,
         g.umfang, g.vorgang_id, g.wirtschaftsjahr,
         g.rechte, g.wasserzeichen, g.gueltig_bis
    from einsicht_gewaehrung g
    join objekt o on o.id = g.objekt_id
    join person p on p.id = g.person_id
   where g.token_hash = p_token_hash
     and g.widerrufen_am is null
     -- Der harte Ablauf. Keine Kulanz, keine Verlaengerung beim Zugriff:
     -- Wer den Token weitergereicht hat, hat damit auch nichts verlaengert.
     and g.gueltig_von <= current_date
     and g.gueltig_bis >= current_date;
$$;

comment on function app.einsicht_aufloesen(bytea) is
  'Prueft den harten Ablauf bei jedem Aufruf. Es gibt keine Sitzung -- der '
  'Token ist der Zugang, und er gilt bis zum Tag, nicht bis zum naechsten '
  'Aufraeumlauf.';


-- ---------------------------------------------------------------------------
-- Teil 4: Welche Belege gehoeren zu dieser Gewaehrung?
-- ---------------------------------------------------------------------------

-- Gerechnet, nicht freigegeben.
--
-- Fuer den Mieter uebernimmt app.belege_fuer_mieter die Arbeit: umlagefaehige
-- Zeile UND Ueberschneidung mit der Mietzeit. Fuer Eigentuemer und Beirat
-- entscheidet der Umfang -- ein Vorgang oder ein Wirtschaftsjahr.
--
-- In keinem Fall dabei: eingeschraenkte und stornierte Belege. Ein Beleg, den
-- im Haus niemand mehr sehen darf, darf erst recht nicht nach draussen.
create or replace function app.einsicht_belege(
  p_gewaehrung_id uuid,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  dokument_id     uuid,
  eingang_am      timestamptz,
  belegart        text,
  rechnungsnummer text,
  brutto          numeric,
  kreditor        text,
  leistung_von    date,
  leistung_bis    date
)
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  g record;
begin
  select * into g from einsicht_gewaehrung eg
   where eg.id = p_gewaehrung_id
     and eg.widerrufen_am is null
     and eg.gueltig_von <= current_date
     and eg.gueltig_bis >= current_date;

  if not found then
    return;
  end if;

  if g.empfaenger_typ = 'mieter' then
    return query
      select b.dokument_id, b.eingang_am, b.belegart,
             f.rechnungsnummer, f.brutto, k.name,
             b.leistung_von, b.leistung_bis
        from app.belege_fuer_mieter(g.person_id, g.objekt_id, p_limit, p_offset) b
        join dokument d on d.id = b.dokument_id
        left join rechnung_fakten f on f.dokument_id = d.id
        left join kreditor k on k.id = f.kreditor_id
       where not d.eingeschraenkt
         and d.status <> 'storniert';
    return;
  end if;

  return query
    select d.id, d.eingang_am, d.belegart,
           f.rechnungsnummer, f.brutto, k.name,
           d.leistung_von, d.leistung_bis
      from dokument d
      left join rechnung_fakten f on f.dokument_id = d.id
      left join kreditor k on k.id = f.kreditor_id
     where d.objekt_id = g.objekt_id
       and not d.eingeschraenkt
       and d.status <> 'storniert'
       and (g.umfang <> 'vorgang' or d.vorgang_id = g.vorgang_id)
       and (g.umfang <> 'wirtschaftsjahr' or f.wirtschaftsjahr = g.wirtschaftsjahr)
     order by d.eingang_am desc
     limit p_limit offset p_offset;
end;
$$;


-- Darf dieser Beleg unter dieser Gewaehrung ausgeliefert werden?
--
-- Eigene Funktion, weil die Frage bei **jeder** Seite und jedem Download neu
-- gestellt wird. Sie ueber die Liste zu beantworten -- "steht er unter den
-- ersten 50?" -- waere falsch: Der 51. Beleg waere unsichtbar und trotzdem
-- abrufbar, sobald jemand die Kennung kennt.
create or replace function app.einsicht_darf_beleg(
  p_gewaehrung_id uuid,
  p_dokument_id   uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1 from app.einsicht_belege(p_gewaehrung_id, 1000000, 0) b
     where b.dokument_id = p_dokument_id
  );
$$;


-- Die Datei zu einem Beleg -- **mit** der Umfangspruefung in derselben
-- Funktion.
--
-- Der erste Entwurf hatte beides getrennt: erst `einsicht_darf_beleg`, dann
-- eine gewoehnliche Abfrage auf `dokument_datei`. Das ging nicht, und der
-- Grund ist lehrreich: Die zweite Abfrage lief ohne angemeldeten Benutzer,
-- also lieferte die RLS nichts -- das Bild blieb leer.
--
-- Die Abhilfe ist nicht, die RLS zu umgehen, sondern beides
-- zusammenzuziehen: Wer die Datei bekommt, hat die Pruefung bestanden, und
-- zwar in derselben Funktion. Zwei getrennte Schritte waeren zwei Stellen, an
-- denen jemand den ersten vergessen kann.
create or replace function app.einsicht_datei(
  p_gewaehrung_id uuid,
  p_dokument_id   uuid,
  p_variante      text,
  p_seite         integer default null
)
returns table (storage_key text, mime text)
language sql
stable
security definer
set search_path = public, app
as $$
  select f.storage_key, f.mime
    from dokument_datei f
   where f.dokument_id = p_dokument_id
     and f.variante = p_variante
     and (p_seite is null or f.seite = p_seite)
     and app.einsicht_darf_beleg(p_gewaehrung_id, p_dokument_id)
   -- Bei mehreren Treffern je Seite (Leseansicht und Miniatur liegen beide
   -- als `ansicht_webp` mit seite = 1) gewinnt die Leseansicht.
   order by f.storage_key like '%miniatur%', f.storage_key
   limit 1;
$$;


create or replace function app.einsicht_protokollieren(
  p_gewaehrung_id uuid,
  p_dokument_id   uuid,
  p_aktion        text,
  p_ip            text default null
)
returns void
language sql
security definer
set search_path = public, app
as $$
  insert into zugriff_protokoll (gewaehrung_id, dokument_id, aktion, ip)
  values (p_gewaehrung_id, p_dokument_id, p_aktion,
          nullif(p_ip, '')::inet);
$$;


-- ---------------------------------------------------------------------------
-- Teil 5: Anlegen und widerrufen -- aus dem Haus heraus
-- ---------------------------------------------------------------------------

create or replace function app.einsicht_gewaehren(
  p_objekt_id      uuid,
  p_person_id      uuid,
  p_empfaenger_typ text,
  p_umfang         text,
  p_token_hash     bytea,
  p_gueltig_bis    date,
  p_rechte         text[] default array['ansicht'],
  p_vorgang_id     uuid default null,
  p_wirtschaftsjahr integer default null,
  p_wasserzeichen  boolean default true
)
returns uuid
language plpgsql
set search_path = public, app
as $$
declare
  neue uuid;
  m    uuid;
begin
  -- Ohne security definer: Wer Einsicht gewaehrt, muss das Objekt selbst
  -- sehen duerfen. Die RLS auf `objekt` beantwortet das -- eine eigene
  -- Pruefung hier waere eine zweite Wahrheit.
  select o.mandant_id into m from objekt o where o.id = p_objekt_id;
  if m is null then
    return null;
  end if;

  insert into einsicht_gewaehrung (mandant_id, objekt_id, empfaenger_typ,
                                   person_id, umfang, vorgang_id,
                                   wirtschaftsjahr, rechte, wasserzeichen,
                                   gueltig_bis, token_hash, erstellt_von)
  values (m, p_objekt_id, p_empfaenger_typ, p_person_id, p_umfang,
          p_vorgang_id, p_wirtschaftsjahr, p_rechte, p_wasserzeichen,
          p_gueltig_bis, p_token_hash, app.mein_benutzer())
  returning id into neue;

  return neue;
end;
$$;


create or replace function app.einsicht_widerrufen(p_gewaehrung_id uuid)
returns boolean
language plpgsql
set search_path = public, app
as $$
declare
  betroffen integer;
begin
  update einsicht_gewaehrung
     set widerrufen_am = now(), widerrufen_von = app.mein_benutzer()
   where id = p_gewaehrung_id and widerrufen_am is null;
  get diagnostics betroffen = row_count;
  return betroffen > 0;
end;
$$;

comment on function app.einsicht_widerrufen(uuid) is
  'Der Widerruf wirkt sofort -- die naechste Anfrage mit dem Token findet '
  'nichts mehr. Kein Aufraeumlauf dazwischen, weil der Token bis dahin '
  'weiter funktionieren wuerde.';


-- ---------------------------------------------------------------------------
-- Teil 6: RLS und Rechte
-- ---------------------------------------------------------------------------

alter table einsicht_gewaehrung enable row level security;
alter table zugriff_protokoll   enable row level security;

-- Aus dem Haus heraus: Wer das Objekt sieht, sieht die Gewaehrungen dazu.
create policy einsicht_gewaehrung_sicht on einsicht_gewaehrung for all
  using (objekt_id = any ((select app.meine_objekte())::uuid[]))
  with check (objekt_id = any ((select app.meine_objekte())::uuid[]));

create policy zugriff_protokoll_lesen on zugriff_protokoll for select
  using (exists (select 1 from einsicht_gewaehrung g where g.id = gewaehrung_id));

grant select, insert, update on einsicht_gewaehrung to dms_app;
grant select on zugriff_protokoll to dms_app;
grant execute on function app.einsicht_aufloesen(bytea) to dms_app;
grant execute on function app.einsicht_belege(uuid, integer, integer) to dms_app;
grant execute on function app.einsicht_darf_beleg(uuid, uuid) to dms_app;
grant execute on function app.einsicht_datei(uuid, uuid, text, integer) to dms_app;
grant execute on function app.einsicht_protokollieren(uuid, uuid, text, text) to dms_app;
grant execute on function app.einsicht_gewaehren(uuid, uuid, text, text, bytea, date,
                                                 text[], uuid, integer, boolean) to dms_app;
grant execute on function app.einsicht_widerrufen(uuid) to dms_app;
