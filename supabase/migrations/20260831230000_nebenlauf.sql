-- Nebenlaeufe: Wartecontainer und Bauteile
--
-- Konzept 10. Der erste Satz des Abschnitts legt fest, was hier **nicht**
-- entsteht:
--
--   "Nebenlaeufe sind keine Sonderprogramme, sondern Prozessdefinitionen mit
--    eigenem Einstieg."
--
-- Also kein Versicherungsmodul und kein Technikmodul. Was fehlt, sind zwei
-- Mechanismen, die das Konzept als Tabellen nennt und die beide Nebenlaeufe
-- brauchen:
--
--   * **Wartecontainer** -- ein Lauf im Zustand "wartet auf ein externes
--     Ereignis", mit Pflicht-Wiedervorlage. Ohne ihn hat die Engine keinen
--     Zustand fuer "wir haben alles getan und warten jetzt auf jemand
--     anderen", und der Beleg bliebe entweder als offene Aufgabe liegen oder
--     verschwaende ganz.
--   * **Bauteil** -- die Grundlage der Gewaehrleistungspruefung. Sie macht
--     aus der bisherigen Mailmeldung eine auswertbare Historie: Bei der
--     naechsten Reparatur schlaegt das System die betroffenen Bauteile samt
--     Frist vor, statt dass jemand nachsehen muss.
--
-- Die Abfolgen aus den Diagrammen in Konzept 11 -- Selbstzahlung gegen
-- Abtretung, Wartung gegen Reparatur gegen Erneuerung -- sind Stufen und
-- Bedingungen in `prozessdefinition`. Sie gehoeren in die Einstellungen, nicht
-- hierher.


-- ---------------------------------------------------------------------------
-- Teil 1: Der Lauf darf warten
-- ---------------------------------------------------------------------------

alter table dokument_lauf drop constraint dokument_lauf_status_check;
alter table dokument_lauf add constraint dokument_lauf_status_check
  check (status in ('laufend','klaerung','wartend','abgeschlossen','storniert'));

comment on column dokument_lauf.status is
  '`wartend` heisst: Im Haus ist alles getan, es fehlt ein externes Ereignis '
  '-- eine Erstattung, eine Zahlungsbestaetigung, eine Antwort auf eine '
  'Gewaehrleistungsruege. Ohne diesen Zustand waere ein wartender Beleg '
  'entweder eine offene Aufgabe, die niemand bearbeiten kann, oder gar '
  'nichts (Konzept 10).';


-- ---------------------------------------------------------------------------
-- Teil 2: Wartecontainer
-- ---------------------------------------------------------------------------

create table wartecontainer (
  id                  uuid primary key default gen_random_uuid(),
  dokument_id         uuid not null references dokument(id) on delete cascade,
  art                 text not null,
  erwartetes_ereignis text not null check (erwartetes_ereignis in
                        ('erstattung','versicherungszahlung',
                         'gewaehrleistungsantwort')),
  erwarteter_betrag   numeric(14,2),

  -- Pflicht, nicht optional. Ein Wartecontainer ohne Wiedervorlage ist ein
  -- Beleg, der still liegen bleibt -- und genau das soll er verhindern.
  wiedervorlage_am    date not null,

  eroeffnet_am        timestamptz not null default now(),
  eroeffnet_von       uuid references benutzer(id),
  erledigt_am         timestamptz,
  erledigt_von        uuid references benutzer(id),
  ergebnis            text,

  check (erledigt_am is null or ergebnis is not null)
);

create index wartecontainer_faellig_idx on wartecontainer (wiedervorlage_am)
  where erledigt_am is null;
create index wartecontainer_dokument_idx on wartecontainer (dokument_id);

comment on table wartecontainer is
  'Ein Lauf im Zustand "wartet auf ein externes Ereignis" (Konzept 10). Die '
  'Wiedervorlage ist Pflicht: Ohne sie waere der Container ein Ort, an dem '
  'Belege verschwinden.';

comment on column wartecontainer.art is
  'Die Bezeichnung aus dem Ablauf -- "zur Erstattung Vers.RE", "Offene '
  'Vers.RE". Freitext und kein Aufzaehlungstyp: Ein neuer Nebenlauf soll '
  'keinen Schemawechsel kosten (Konzept 10, "keine Sonderprogramme").';

comment on column wartecontainer.ergebnis is
  'Womit der Container geschlossen wurde. Pflicht beim Schliessen -- ein '
  'Container, der ohne Ergebnis endet, hinterlaesst die Frage, warum nicht '
  'mehr gewartet wird.';


-- ---------------------------------------------------------------------------
-- Teil 3: Bauteile und Gewaehrleistung
-- ---------------------------------------------------------------------------

create table bauteil (
  id                  uuid primary key default gen_random_uuid(),
  objekt_id           uuid not null references objekt(id) on delete cascade,
  bezeichnung         text not null,
  einbau_am           date,
  lieferant_id        uuid references kreditor(id),
  gewaehrleistung_bis date,
  -- Haelt die Kette ueber Erneuerungen hinweg zusammen: Welches Teil hat
  -- welches ersetzt, und wann.
  ersetzt_bauteil_id  uuid references bauteil(id),
  dokument_id         uuid references dokument(id) on delete set null,
  aktiv               boolean not null default true,
  erfasst_am          timestamptz not null default now(),

  check (ersetzt_bauteil_id is null or ersetzt_bauteil_id <> id)
);

create index bauteil_objekt_idx on bauteil (objekt_id) where aktiv;
create index bauteil_gewaehrleistung_idx on bauteil (objekt_id, gewaehrleistung_bis)
  where aktiv and gewaehrleistung_bis is not null;

comment on table bauteil is
  'Macht aus der bisherigen Mailmeldung eine auswertbare Historie (Konzept '
  '10.2): Bei der naechsten Reparatur schlaegt das System die betroffenen '
  'Bauteile samt Gewaehrleistungsfrist vor, statt dass jemand nachsieht.';

comment on column bauteil.ersetzt_bauteil_id is
  'Das Teil, das dieses hier abgeloest hat. Ohne die Kette waere nach der '
  'zweiten Erneuerung nicht mehr zu sagen, wie alt die Anlage ist.';


-- Bauteile mit laufender Gewaehrleistung.
--
-- Der Vorschlag bei einer Reparatur. Bewusst mit Stichtag statt
-- `current_date`: Die Frage ist "war zum Schadenszeitpunkt Gewaehrleistung
-- offen", nicht "ist sie heute offen" -- zwischen Schaden und Rechnung
-- vergehen Wochen.
create or replace function app.gewaehrleistung_offen(
  p_objekt_id uuid,
  p_stichtag  date default current_date
)
returns table (
  bauteil_id          uuid,
  bezeichnung         text,
  einbau_am           date,
  gewaehrleistung_bis date,
  lieferant           text,
  resttage            integer
)
language sql
stable
set search_path = public, app
as $$
  select b.id, b.bezeichnung, b.einbau_am, b.gewaehrleistung_bis,
         k.name, (b.gewaehrleistung_bis - p_stichtag)::integer
    from bauteil b
    left join kreditor k on k.id = b.lieferant_id
   where b.objekt_id = p_objekt_id
     and b.aktiv
     and b.gewaehrleistung_bis is not null
     and b.gewaehrleistung_bis >= p_stichtag
   order by b.gewaehrleistung_bis;
$$;

comment on function app.gewaehrleistung_offen(uuid, date) is
  'Der Vorschlag bei einer Reparatur. Mit Stichtag, weil die Frage dem '
  'Schadenszeitpunkt gilt und nicht dem Tag der Bearbeitung.';


-- ---------------------------------------------------------------------------
-- Teil 4: Oeffnen und schliessen
-- ---------------------------------------------------------------------------

create or replace function app.warten_beginnen(
  p_dokument_id         uuid,
  p_art                 text,
  p_erwartetes_ereignis text,
  p_wiedervorlage_am    date,
  p_erwarteter_betrag   numeric default null
)
returns uuid
language plpgsql
set search_path = public, app
as $$
declare
  neuer uuid;
  lauf  uuid;
begin
  if p_wiedervorlage_am is null then
    raise exception 'Ein Wartecontainer braucht eine Wiedervorlage (Konzept 10).';
  end if;
  if p_wiedervorlage_am <= current_date then
    raise exception 'Die Wiedervorlage muss in der Zukunft liegen.';
  end if;

  select l.id into lauf from dokument_lauf l where l.dokument_id = p_dokument_id;
  if lauf is null then
    return null;
  end if;

  insert into wartecontainer (dokument_id, art, erwartetes_ereignis,
                              wiedervorlage_am, erwarteter_betrag, eroeffnet_von)
  values (p_dokument_id, p_art, p_erwartetes_ereignis,
          p_wiedervorlage_am, p_erwarteter_betrag, app.mein_benutzer())
  returning id into neuer;

  -- Die offenen Aufgaben ruhen, solange gewartet wird: Sonst stuende der
  -- Beleg im Postfach und niemand koennte ihn abschliessen.
  update dokument_lauf set status = 'wartend' where id = lauf;

  return neuer;
end;
$$;


create or replace function app.warten_beenden(
  p_container_id uuid,
  p_ergebnis     text
)
returns boolean
language plpgsql
set search_path = public, app
as $$
declare
  dok uuid;
begin
  if p_ergebnis is null or btrim(p_ergebnis) = '' then
    raise exception 'Ein Wartecontainer wird nicht ohne Ergebnis geschlossen.';
  end if;

  update wartecontainer
     set erledigt_am = now(), erledigt_von = app.mein_benutzer(),
         ergebnis = p_ergebnis
   where id = p_container_id and erledigt_am is null
  returning dokument_id into dok;

  if dok is null then
    return false;
  end if;

  -- Zurueck in den Lauf -- aber nur, wenn kein zweiter Container offen ist.
  -- Ein Beleg kann auf zwei Dinge gleichzeitig warten.
  update dokument_lauf l
     set status = 'laufend'
   where l.dokument_id = dok
     and l.status = 'wartend'
     and not exists (
       select 1 from wartecontainer w
        where w.dokument_id = dok and w.erledigt_am is null);

  return true;
end;
$$;

comment on function app.warten_beenden(uuid, text) is
  'Setzt den Lauf erst fort, wenn **kein** Container mehr offen ist: Ein '
  'Beleg kann gleichzeitig auf eine Versicherungszahlung und auf eine '
  'Gewaehrleistungsantwort warten.';


-- Was ist faellig?
--
-- Konzept 11: "Frist ueberschritten" fuehrt ins Klaerungspostfach. Diese
-- Funktion liefert, was dorthin gehoert -- sie schiebt nichts selbst, weil
-- die Klaerung Kommentar und Verantwortlichen braucht und beides ein Mensch
-- setzt.
create or replace function app.wartecontainer_faellig(
  p_stichtag date default current_date
)
returns table (
  container_id        uuid,
  dokument_id         uuid,
  art                 text,
  erwartetes_ereignis text,
  wiedervorlage_am    date,
  ueberfaellig_tage   integer
)
language sql
stable
set search_path = public, app
as $$
  select w.id, w.dokument_id, w.art, w.erwartetes_ereignis, w.wiedervorlage_am,
         (p_stichtag - w.wiedervorlage_am)::integer
    from wartecontainer w
    join dokument d on d.id = w.dokument_id
   where w.erledigt_am is null
     and w.wiedervorlage_am <= p_stichtag
   order by w.wiedervorlage_am;
$$;


-- ---------------------------------------------------------------------------
-- Teil 5: RLS und Rechte
-- ---------------------------------------------------------------------------

alter table wartecontainer enable row level security;
alter table bauteil        enable row level security;

-- Der Container folgt der Sichtbarkeit seines Belegs.
create policy wartecontainer_sicht on wartecontainer for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

create policy bauteil_sicht on bauteil for all
  using (objekt_id = any ((select app.meine_objekte())::uuid[]))
  with check (objekt_id = any ((select app.meine_objekte())::uuid[]));

grant select, insert, update on wartecontainer to dms_app;
grant select, insert, update on bauteil to dms_app;
grant execute on function app.gewaehrleistung_offen(uuid, date) to dms_app;
grant execute on function app.warten_beginnen(uuid, text, text, date, numeric) to dms_app;
grant execute on function app.warten_beenden(uuid, text) to dms_app;
grant execute on function app.wartecontainer_faellig(date) to dms_app;
