-- Layer und Seitenmasse in **einem** Aufruf
--
-- Derselbe Fehler zum dritten Mal in diesem Projekt, deshalb hier
-- ausgeschrieben:
--
--   Bei `app.einsicht_datei` stand Pruefung und Datei zuerst getrennt. Die
--   zweite Abfrage lief ohne Benutzer, die RLS blendete alles aus, und es kam
--   nichts zurueck. Zusammengelegt, Kommentar hinterlassen.
--
--   Jetzt dasselbe bei den Layern: `app.einsicht_layer` ist `security
--   definer` und lieferte richtig. Die Seitenbreite holte die Anwendung
--   daneben mit einer gewoehnlichen Abfrage auf `dokument_seite` -- und die
--   laeuft in der externen Einsicht ohne Benutzer. Ergebnis: Breite 0, und
--   damit waere jede Schwaerzung an der falschen Stelle gelandet.
--
-- **Die Regel dahinter:** In der externen Einsicht gibt es keinen Benutzer.
-- Jede Abfrage, die dort etwas liefern soll, muss durch eine `security
-- definer`-Funktion mit eigener Pruefung -- und wenn zwei Angaben
-- zusammengehoeren, gehoeren sie in **eine** Funktion. Zwei Aufrufe sind zwei
-- Gelegenheiten, den zweiten zu vergessen.

drop function if exists app.einsicht_layer(uuid, uuid, integer);

create or replace function app.einsicht_layer(
  p_gewaehrung_id uuid,
  p_dokument_id   uuid,
  p_seite         integer
)
returns table (
  seitenbreite numeric,
  seitenhoehe  numeric,
  typ          text,
  x            numeric,
  y            numeric,
  breite       numeric,
  hoehe        numeric,
  text         text
)
language sql
stable
security definer
set search_path = public, app
as $$
  select s.breite, s.hoehe, l.typ, l.x, l.y, l.breite, l.hoehe, l.inhalt_text
    from dokument_seite s
    join dokument_layer l
      on l.dokument_id = s.dokument_id and l.seite = s.seite
   where s.dokument_id = p_dokument_id
     and s.seite = p_seite
     and l.geloescht_am is null
     and (l.typ = 'schwaerzung' or l.sichtbarkeit in ('extern','alle'))
     -- Der Umfang wird je Beleg neu geprueft, nie ueber die Liste
     -- (Projektregel). Dieselbe Funktion wie in `app.einsicht_datei`.
     and app.einsicht_darf_beleg(p_gewaehrung_id, p_dokument_id)
   order by
     -- Schwaerzungen zuletzt: Sie liegen ueber allem anderen.
     case when l.typ = 'schwaerzung' then 1 else 0 end,
     l.erstellt_am;
$$;

comment on function app.einsicht_layer(uuid, uuid, integer) is
  'Was von den Layern eines Belegs nach draussen darf, **mit** den '
  'Seitenmassen. Zusammen in einer Funktion, weil die zweite Abfrage in der '
  'externen Einsicht ohne Benutzer liefe und nichts faende -- eine '
  'Schwaerzung waere dann an der falschen Stelle gelandet.';

grant execute on function app.einsicht_layer(uuid, uuid, integer) to dms_app;
