-- Der Stempel wird platziert, bevor er gilt (ADR 0009).
--
-- Bis hierher waehlte die Datenbank den Platz: der naechste freie Block auf
-- Seite 1, gerechnet vom Worker (app.stempelplatz). Wer stempelte, sah den
-- Stempel erst danach -- und nur in der Belegansicht, nicht auf dem
-- Bildschirm, auf dem er entschieden hatte. Rueckmeldung beim Bedienen:
-- "beim Stempeln soll der Stempel optisch auf dem Beleg platziert werden,
-- sobald dies geschehen ist, soll der Vorgang mit Speichern geschlossen
-- werden."
--
-- Jetzt traegt das Ereignis die Lage, die der Mensch gewaehlt hat:
-- `stempel_ereignis.lage` als {seite, x, y, breite, hoehe} in Punkten. Der
-- Trigger nimmt sie statt des errechneten Platzes -- nach derselben
-- Pruefung, die auch beim Verschieben gilt (app.stempel_lage_pruefen:
-- Mindestmass, Seitenrand, kein Text, kein anderer Stempel). Fehlt die
-- Lage, bleibt alles wie bisher; die Entscheidung entsteht nie ohne Layer.
--
-- Die Lage ist **nicht** Teil der Hash-Kette -- wie der Stempeltext. Die
-- Kette belegt die Entscheidung (wer, was, wann), nicht, wo der Abdruck auf
-- der Seite sitzt. Bestehende Ereignisse tragen null und bleiben, was sie
-- sind.

alter table stempel_ereignis
  add column lage jsonb
    check (
      lage is null
      or (jsonb_typeof(lage) = 'object'
          and lage ? 'seite' and lage ? 'x' and lage ? 'y'
          and lage ? 'breite' and lage ? 'hoehe')
    );

comment on column stempel_ereignis.lage is
  'Vom Stempelnden gewaehlte Lage des Abdrucks {seite, x, y, breite, hoehe} '
  'in PDF-Punkten; null = Platz aus app.stempelplatz. Nicht gehasht. Der '
  'Layer-Trigger prueft sie mit app.stempel_lage_pruefen und weist ab, was '
  'Text ueberdeckt.';

-- Der Layer-Trigger, unveraendert bis auf den einen Zweig: die mitgegebene
-- Lage schlaegt den errechneten Platz.
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
  felder    jsonb;
  feld      text;
  wert      text;
  teile     text[] := '{}';
  zeit      text[] := '{}';
  text_     text;
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

  select t.name, t.sichtbar_auf_beleg,
         coalesce(t.gestaltung->'felder', '["text","mitarbeiter","datum","uhrzeit"]'::jsonb)
    into bezeichnung, sichtbar, felder
    from stempeltyp t where t.id = new.stempeltyp_id;
  if sichtbar is false then
    return new;
  end if;
  if felder is null or jsonb_typeof(felder) <> 'array' or jsonb_array_length(felder) = 0 then
    felder := '["text","mitarbeiter","datum","uhrzeit"]'::jsonb;
  end if;

  select d.mandant_id, d.objekt_id into mand, obj from dokument d where d.id = dok;

  if new.lage is not null then
    -- Die Lage vom Menschen: geprueft wie beim Verschieben, sonst abgewiesen.
    -- Abgewiesen heisst: kein Ereignis, kein Layer -- die Transaktion rollt
    -- zurueck, und die Anwendung zeigt den Grund.
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

  -- Der Stempeltext steht immer zuerst -- er ist die Entscheidung.
  teile := array[coalesce(bezeichnung, '')];
  for feld in select jsonb_array_elements_text(felder) loop
    if feld = 'text' then continue; end if;
    wert := app.stempel_feldwert(feld, bezeichnung, wer, new.zeitpunkt, new.kommentar, dok, new.stufe_id);
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
  text_ := array_to_string(teile, ' · ');

  insert into dokument_layer (
    dokument_id, mandant_id, objekt_id, typ, seite,
    x, y, breite, hoehe, inhalt_text, stempel_ereignis_id,
    sichtbarkeit, erstellt_von
  ) values (
    dok, mand, obj, 'stempel', seitennr,
    (platz->>'x')::numeric, (platz->>'y')::numeric,
    (platz->>'breite')::numeric, (platz->>'hoehe')::numeric,
    text_,
    new.id,
    'alle',
    new.benutzer_id
  );

  return new;
end;
$$;
