-- ---------------------------------------------------------------------------
-- Stempel verschieben -- die Herkunft bleibt das Ereignis, die Lage wird frei
-- ---------------------------------------------------------------------------
--
-- Entschieden (docs/entwurf-workflow-und-stempel.md, Antworten; ADR 0008):
--
--   * Verschieben darf, **wer den Stempel gesetzt hat** -- bis zur naechsten
--     Stufe. Danach ist der Stempel Teil eines Verlaufs, den andere schon
--     gesehen haben.
--   * **Kein Stempel ueberdeckt Text.** Auch nicht von Hand. Ein verdeckter
--     Betrag ist im Pruefungsfall eine Behauptung, keine Pruefung.
--   * **Lage und Groesse** sind aenderbar; eine Untergrenze haelt den Stempel
--     lesbar.
--   * **Die Seite ist frei waehlbar**, Vorgabe bleibt Seite 1.
--   * Auf dem Stempel stehen Stempeltext, Datum **mit Uhrzeit** und der
--     Mitarbeiter.
--
-- **Was sich nicht aendert.** `dokument_layer_unveraenderlich` bleibt der
-- Riegel: Typ, Text, Ereignis, Urheber -- nichts davon wird je geaendert.
-- Die Ausnahme ist eng: nur `seite`, `x`, `y`, `breite`, `hoehe`, nur am
-- Stempel, nur unter Bedingungen, die der Trigger **selbst nachprueft**. Kein
-- Sitzungsschalter, keine Fahne, die jemand setzen kann -- dieselbe Regel wie
-- bei `app.loeschung_faellig`: eine nachpruefbare Tatsache oeffnet die Tuer,
-- nicht ein Aufrufer, der behauptet, er duerfe.
--
-- **Warum die Textkaesten gespeichert werden.** Die freien Bloecke aus der
-- Aufbereitung sind fertige Stempelplaetze in einer festen Groesse -- fuer
-- "darf dieses Rechteck dorthin" taugen sie nicht. Dafuer braucht es die
-- Textflaechen der Seite. Die Fundstellen je Wort waeren bei einer Million
-- Belegen zweistellige Gigabytes (Migration 20260901120000); **Zeilen** sind
-- rund zehnmal weniger: eine Rechnung hat sechzig Zeilen, nicht sechshundert
-- Woerter. Gerechnet wird weiterhin einmal, im Worker.

alter table dokument_seite
  add column textkaesten jsonb;

comment on column dokument_seite.textkaesten is
  'Textflaechen der Seite als Zeilenkaesten [{x,y,breite,hoehe}], PDF-Punkte, '
  'Ursprung oben links. Grundlage dafuer, dass ein von Hand verschobener '
  'Stempel keinen Text ueberdeckt. Einmal vom Worker gerechnet; NULL heisst: '
  'vor dieser Migration aufbereitet -- dann ist Verschieben auf dieser Seite '
  'nicht moeglich, bis sie neu aufbereitet wurde.';

-- ---------------------------------------------------------------------------
-- Protokoll: jede Verschiebung, append-only
-- ---------------------------------------------------------------------------

create table layer_position_ereignis (
  id            uuid primary key default gen_random_uuid(),
  layer_id      uuid not null references dokument_layer(id) on delete cascade,
  mandant_id    uuid not null references mandant(id),
  benutzer_id   uuid not null references benutzer(id),
  zeitpunkt     timestamptz not null default now(),
  von           jsonb not null,
  nach          jsonb not null
);

comment on table layer_position_ereignis is
  'Wer einen Stempel wann von wo nach wo verschoben hat. Append-only -- der '
  'Layer traegt nur die aktuelle Lage, die Geschichte steht hier.';

create index on layer_position_ereignis (layer_id, zeitpunkt);

alter table layer_position_ereignis enable row level security;

create policy layer_position_ereignis_lesen on layer_position_ereignis for select
  using (mandant_id = (select app.mein_mandant()));
-- Geschrieben wird nur durch den Trigger unten (security definer).

grant select on layer_position_ereignis to dms_app;

create or replace function app.layer_position_unveraenderlich()
returns trigger
language plpgsql
as $$
begin
  raise exception 'layer_position_ereignis ist append-only.';
end;
$$;

create trigger layer_position_ereignis_unveraenderlich
  before update or delete on layer_position_ereignis
  for each row execute function app.layer_position_unveraenderlich();

-- ---------------------------------------------------------------------------
-- Darf dieser Stempel derzeit verschoben werden -- und von wem?
-- ---------------------------------------------------------------------------
--
-- Liefert NULL, wenn ja, sonst den Grund im Klartext. Eine Funktion fuer
-- Trigger und Oberflaeche: Was der Trigger abweist, zeigt die Oberflaeche
-- gar nicht erst als Griff an.

create or replace function app.stempel_verschiebbar(p_layer_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  l     dokument_layer%rowtype;
  e     stempel_ereignis%rowtype;
  spaeter integer;
begin
  select * into l from dokument_layer where id = p_layer_id;
  if l.id is null then
    return 'Layer nicht gefunden.';
  end if;
  if l.typ <> 'stempel' or l.stempel_ereignis_id is null then
    return 'Nur Stempel lassen sich verschieben.';
  end if;
  if l.geloescht_am is not null then
    return 'Ein ausgeblendeter Stempel wird nicht verschoben.';
  end if;

  select * into e from stempel_ereignis where id = l.stempel_ereignis_id;
  if e.benutzer_id is distinct from app.mein_benutzer() then
    return 'Verschieben darf nur, wer den Stempel gesetzt hat.';
  end if;

  -- Bis zur naechsten Stufe: Sobald auf diesem Lauf ein spaeteres
  -- Stempelereignis steht, ist der Stempel Teil eines Verlaufs, den andere
  -- gesehen haben.
  select count(*) into spaeter
    from stempel_ereignis x
   where x.lauf_id = e.lauf_id
     and x.zeitpunkt > e.zeitpunkt;
  if spaeter > 0 then
    return 'Die naechste Stufe ist schon gestempelt -- der Stempel liegt fest.';
  end if;

  if exists (select 1 from archiv_eintrag a where a.dokument_id = l.dokument_id) then
    return 'Der Beleg ist archiviert.';
  end if;

  return null;
end;
$$;

grant execute on function app.stempel_verschiebbar(uuid) to dms_app;

comment on function app.stempel_verschiebbar(uuid) is
  'NULL, wenn der Handelnde diesen Stempel jetzt verschieben darf; sonst der '
  'Grund. Dieselbe Frage fuer Trigger und Oberflaeche.';

-- ---------------------------------------------------------------------------
-- Passt das Rechteck auf die Seite, ohne Text zu ueberdecken?
-- ---------------------------------------------------------------------------

create or replace function app.stempel_lage_pruefen(
  p_dokument_id uuid,
  p_layer_id    uuid,
  p_seite       integer,
  p_x           numeric,
  p_y           numeric,
  p_breite      numeric,
  p_hoehe       numeric
)
returns text
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  -- Dieselben Werte wie in src/layer/platzierung.ts. Wer sie dort aendert,
  -- aendert sie hier.
  min_breite  constant numeric := 120;
  min_hoehe   constant numeric := 40;
  rand        constant numeric := 12;
  textabstand constant numeric := 6;
  s           dokument_seite%rowtype;
  k           jsonb;
  anderer     dokument_layer%rowtype;
begin
  if p_breite < min_breite or p_hoehe < min_hoehe then
    return format('Ein Stempel bleibt mindestens %s x %s Punkte gross, sonst ist er nicht lesbar.',
                  min_breite, min_hoehe);
  end if;

  -- Seite 0: die angehaengte Leerseite. Dort steht kein Text.
  if p_seite = 0 then
    if p_x < 0 or p_y < 0 then
      return 'Ausserhalb der Seite.';
    end if;
    return null;
  end if;

  select * into s from dokument_seite
   where dokument_id = p_dokument_id and seite = p_seite;
  if s.dokument_id is null then
    return format('Seite %s gibt es nicht.', p_seite);
  end if;
  if s.breite is null or s.hoehe is null then
    return 'Die Masse dieser Seite sind unbekannt.';
  end if;
  if p_x < rand or p_y < rand
     or p_x + p_breite > s.breite - rand
     or p_y + p_hoehe > s.hoehe - rand then
    return 'Der Stempel ragt ueber den Seitenrand.';
  end if;

  if s.textkaesten is null then
    return 'Diese Seite wurde aufbereitet, bevor Stempel verschiebbar waren -- '
           'nach einer erneuten Aufbereitung geht es.';
  end if;

  -- Kein Stempel ueberdeckt Text -- mit demselben Abstand, den der Worker
  -- beim Suchen der freien Plaetze haelt.
  for k in select * from jsonb_array_elements(s.textkaesten) loop
    if p_x < (k->>'x')::numeric + (k->>'breite')::numeric + textabstand
       and p_x + p_breite > (k->>'x')::numeric - textabstand
       and p_y < (k->>'y')::numeric + (k->>'hoehe')::numeric + textabstand
       and p_y + p_hoehe > (k->>'y')::numeric - textabstand then
      return 'An dieser Stelle steht Text -- ein Stempel ueberdeckt keinen Text.';
    end if;
  end loop;

  -- Und keinen anderen Stempel.
  for anderer in
    select * from dokument_layer
     where dokument_id = p_dokument_id and seite = p_seite
       and typ = 'stempel' and geloescht_am is null
       and id is distinct from p_layer_id
  loop
    if p_x < anderer.x + anderer.breite and p_x + p_breite > anderer.x
       and p_y < anderer.y + anderer.hoehe and p_y + p_hoehe > anderer.y then
      return 'Dort liegt schon ein Stempel.';
    end if;
  end loop;

  return null;
end;
$$;

grant execute on function app.stempel_lage_pruefen(uuid, uuid, integer, numeric, numeric, numeric, numeric) to dms_app;

-- ---------------------------------------------------------------------------
-- Der Riegel bekommt seine eine, enge Ausnahme
-- ---------------------------------------------------------------------------

create or replace function app.layer_unveraenderlich()
returns trigger
language plpgsql
as $$
declare
  grund text;
begin
  -- Was nie geaendert wird -- unveraendert gegenueber 20260901120000.
  if new.dokument_id is distinct from old.dokument_id
     or new.typ is distinct from old.typ
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

  -- Die Lage: aenderbar nur am Stempel, nur durch den, der ihn setzte, nur
  -- bis zur naechsten Stufe, nur ohne Text darunter. Alles nachgeprueft --
  -- keine Fahne.
  if new.seite is distinct from old.seite
     or new.x is distinct from old.x
     or new.y is distinct from old.y
     or new.breite is distinct from old.breite
     or new.hoehe is distinct from old.hoehe then
    grund := app.stempel_verschiebbar(old.id);
    if grund is not null then
      raise exception '%', grund;
    end if;
    grund := app.stempel_lage_pruefen(old.dokument_id, old.id, new.seite,
                                      new.x, new.y, new.breite, new.hoehe);
    if grund is not null then
      raise exception '%', grund;
    end if;
  end if;

  return new;
end;
$$;

-- Das Protokoll schreibt der Trigger, nicht der Aufrufer: Jede Verschiebung
-- hinterlaesst eine Spur, gleich ueber welchen Weg sie kam.
create or replace function app.layer_position_protokollieren()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if new.seite is distinct from old.seite
     or new.x is distinct from old.x
     or new.y is distinct from old.y
     or new.breite is distinct from old.breite
     or new.hoehe is distinct from old.hoehe then
    insert into layer_position_ereignis (layer_id, mandant_id, benutzer_id, von, nach)
    values (
      old.id, old.mandant_id, app.mein_benutzer(),
      jsonb_build_object('seite', old.seite, 'x', old.x, 'y', old.y,
                         'breite', old.breite, 'hoehe', old.hoehe),
      jsonb_build_object('seite', new.seite, 'x', new.x, 'y', new.y,
                         'breite', new.breite, 'hoehe', new.hoehe)
    );
  end if;
  return new;
end;
$$;

create trigger dokument_layer_position_protokoll
  after update on dokument_layer
  for each row execute function app.layer_position_protokollieren();

-- Der bequeme Weg fuer die Anwendung. Er prueft nichts selbst -- die Grenze
-- ist der Trigger. Er fasst nur das Update in einen Aufruf und uebersetzt
-- "keine Zeile" in einen Grund.
create or replace function app.stempel_verschieben(
  p_layer_id uuid,
  p_seite    integer,
  p_x        numeric,
  p_y        numeric,
  p_breite   numeric,
  p_hoehe    numeric
)
returns void
language plpgsql
set search_path = public, app
as $$
declare
  n integer;
begin
  update dokument_layer
     set seite = p_seite, x = p_x, y = p_y, breite = p_breite, hoehe = p_hoehe
   where id = p_layer_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Stempel nicht gefunden oder nicht sichtbar.';
  end if;
end;
$$;

grant execute on function app.stempel_verschieben(uuid, integer, numeric, numeric, numeric, numeric) to dms_app;

-- ---------------------------------------------------------------------------
-- Uhrzeit auf dem Stempel
-- ---------------------------------------------------------------------------
--
-- "Stempeltext, Datum + Uhrzeit + Mitarbeiter." In Ortszeit -- der Server
-- laeuft unter UTC (ADR 0007), und ein Stempel "09:12" auf einer Rechnung,
-- die um 11:12 geprueft wurde, waere fuer den Pruefer ein Raetsel. Der
-- Layertext wird nicht gehasht; die Kette haengt am Ereignis.

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

  select t.name, t.sichtbar_auf_beleg into bezeichnung, sichtbar
    from stempeltyp t where t.id = new.stempeltyp_id;
  if sichtbar is false then
    return new;
  end if;

  select d.mandant_id, d.objekt_id into mand, obj from dokument d where d.id = dok;

  platz := app.stempelplatz(dok);
  if platz is null then
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
      ' · ' || to_char(new.zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') ||
      coalesce(' · ' || nullif(btrim(new.kommentar), ''), ''),
    new.id,
    'alle',
    new.benutzer_id
  );

  return new;
end;
$$;
