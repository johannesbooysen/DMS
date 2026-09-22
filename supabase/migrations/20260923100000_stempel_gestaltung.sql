-- ---------------------------------------------------------------------------
-- Stempel-Designer: Felder und Aussehen je Stempeltyp
-- ---------------------------------------------------------------------------
--
-- Antwort auf Frage 9 des Entwurfs: "Stempeltext, Datum + Uhrzeit +
-- Mitarbeiter (es soll jedoch ein Stempel-Designer geben)". Der Designer
-- stellt je Stempeltyp ein, welche Felder auf dem Stempel stehen und wie er
-- aussieht. Die Weissliste steht in src/layer/gestaltung.ts; hier liest der
-- Trigger nur `felder` -- alles andere ist Darstellung und gehoert in
-- Anzeige und Export.
--
-- **Der Text entsteht einmal, hier, beim Stempeln.** Drei Stellen zeichnen
-- einen Stempel -- Viewer, PDF-Export, Einbrennen fuer die Einsicht -- und
-- alle lesen `inhalt_text`. Er ist ausserdem der durchsuchbare Inhalt. Ein
-- Layer, dessen Text sich nachtraeglich aus dem Stempeltyp neu ergaebe,
-- aenderte sich, wenn jemand den Designer bedient -- und ein gesetzter
-- Stempel aendert sich nicht. Was einmal gestempelt ist, bleibt, wie es
-- war; die Gestaltung gilt fuer die naechsten.

alter table stempeltyp
  add column gestaltung jsonb not null default '{}'::jsonb
    check (jsonb_typeof(gestaltung) = 'object');

comment on column stempeltyp.gestaltung is
  'Felder und Aussehen des Stempels (Weissliste in src/layer/gestaltung.ts): '
  'felder [text|mitarbeiter|datum|uhrzeit|kommentar|objekt|betrag|stufe], '
  'form, rahmen, drehung, schrift. Leer heisst Vorgabe: Stempeltext, '
  'Mitarbeiter, Datum, Uhrzeit. Gilt fuer neue Stempel; gesetzte bleiben.';

-- Ein Feldwert des Belegs, wie er auf dem Stempel steht.
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
      -- Deutsche Schreibweise ohne Abhaengigkeit von lc_numeric.
      select replace(replace(replace(to_char(f.brutto, 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.')
             || ' EUR'
        into wert
        from rechnung_fakten f where f.dokument_id = p_dokument_id and f.brutto is not null;
      return wert;
    when 'stufe' then
      select s.bezeichnung into wert from prozessstufe s where s.id = p_stufe_id;
      return wert;
    else return null;
  end case;
end;
$$;

-- Der Layer-Trigger setzt den Text jetzt aus den Feldern des Stempeltyps
-- zusammen. Datum und Uhrzeit ruecken zusammen ("22.09.2026 09:10") --
-- dieselbe Regel wie textZusammensetzen in src/layer/gestaltung.ts.
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

  platz := app.stempelplatz(dok);
  if platz is null then
    seitennr := 0;
    platz := jsonb_build_object('x', 40, 'y', 40, 'breite', 190, 'hoehe', 64);
  else
    seitennr := 1;
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
