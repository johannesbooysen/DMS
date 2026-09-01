-- Layer in der externen Einsicht
--
-- Zwei Fragen, die mit der Einfuehrung der Layer neu entstehen:
--
--   1. Welche Layer sieht jemand, der nur einen Token hat?
--   2. Was passiert mit dem PDF-Download, wenn geschwaerzt wurde?
--
-- Die zweite ist die unangenehme, und die Antwort steht weiter unten.


-- Layer, die nach draussen duerfen.
--
-- `security definer` wie alles in der Einsicht: Es gibt keinen Benutzer und
-- keine Sitzung, der Token *ist* der Zugang. Geprueft wird deshalb hier --
-- Gueltigkeit der Gewaehrung und Zugehoerigkeit des Belegs.
--
-- Die Regel selbst ist knapp:
--   * Schwaerzungen **immer**. Sie verdecken; sie wegzulassen hiesse, das
--     Verdeckte zu zeigen.
--   * Stempel und ausdruecklich freigegebene Notizen ja.
--   * Alles andere nein. `intern` ist die Vorgabe, und sie bleibt drinnen.
create or replace function app.einsicht_layer(
  p_gewaehrung_id uuid,
  p_dokument_id   uuid,
  p_seite         integer
)
returns table (
  typ    text,
  x      numeric,
  y      numeric,
  breite numeric,
  hoehe  numeric,
  text   text
)
language sql
stable
security definer
set search_path = public, app
as $$
  select l.typ, l.x, l.y, l.breite, l.hoehe, l.inhalt_text
    from dokument_layer l
   where l.dokument_id = p_dokument_id
     and l.seite = p_seite
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
  'Was von den Layern eines Belegs nach draussen darf. Schwaerzungen immer, '
  'Stempel und freigegebene Notizen ja, interne Notizen nie (Konzept 16).';

grant execute on function app.einsicht_layer(uuid, uuid, integer) to dms_app;


-- Hat der Beleg Schwaerzungen?
--
-- **Der Grund fuer diese Funktion ist unangenehm und gehoert aufgeschrieben.**
--
-- Eine Schwaerzung im gelieferten Bild ist echt: Ein WebP hat keinen
-- Textlayer, was uebermalt ist, ist weg. Ein schwarzes Rechteck in einem PDF
-- ist dagegen nur *daraufgelegt* -- der Text darunter bleibt im Dokument und
-- laesst sich markieren, kopieren oder mit jedem Werkzeug auslesen. Genau so
-- sind schon Behoerden und Kanzleien aufgefallen.
--
-- Richtig schwaerzen hiesse, den Seiteninhalt neu zu schreiben und die
-- betroffenen Textoperatoren zu entfernen. Das kann pdf-lib nicht, und eine
-- halbe Loesung waere hier schlimmer als keine: Sie *sieht aus* wie eine
-- Schwaerzung.
--
-- Deshalb die Entscheidung: Hat ein Beleg eine Schwaerzung, gibt es ihn
-- extern **nur als Bild**. Der PDF-Download entfaellt, mit Begruendung auf
-- der Seite. Lieber eine fehlende Schaltflaeche als eine Schwaerzung, die
-- keine ist.
create or replace function app.hat_schwaerzung(p_dokument_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1 from dokument_layer l
     where l.dokument_id = p_dokument_id
       and l.typ = 'schwaerzung'
       and l.geloescht_am is null
  );
$$;

comment on function app.hat_schwaerzung(uuid) is
  'Sperrt den externen PDF-Download. Ein schwarzes Rechteck in einem PDF '
  'verdeckt den Text nur optisch -- er bleibt markierbar. Geschwaerzte '
  'Belege gehen deshalb nur als Bild hinaus.';

grant execute on function app.hat_schwaerzung(uuid) to dms_app;
