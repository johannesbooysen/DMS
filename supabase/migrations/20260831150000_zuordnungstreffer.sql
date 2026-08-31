-- Zuordnungstreffer unabhaengig von der Objektsichtbarkeit
--
-- Gefunden beim Bau des Lernspeichers, und die Art des Fehlers ist die
-- gefaehrliche: Er machte die Zuordnung nicht falsch, sondern zu
-- selbstbewusst.
--
-- Die Suche nach gelernten Merkmalen verband zuordnungs_merkmal mit objekt.
-- Auf objekt liegt RLS -- ein Bearbeiter sieht nur seine Objekte. Deuteten
-- die Merkmale eines Belegs auf zwei Objekte und war eines davon fuer ihn
-- unsichtbar, verschwand dieser Treffer aus dem Ergebnis. Aus "mehrdeutig,
-- bitte ansehen" wurde ein gruenes "eindeutig Objekt 42".
--
-- Ob eine Zuordnung eindeutig ist, ist aber keine Frage der Sichtbarkeit.
-- Die Antwort muss dieselbe sein, egal wer fragt. Deshalb loest eine
-- "stable security definer"-Funktion die Treffer auf -- dasselbe Muster wie
-- app.meine_objekte().
--
-- Die Mandantengrenze bleibt: Sie steht in der Funktion selbst und wird
-- nicht als Parameter uebergeben, damit sie sich nicht umgehen laesst.

create or replace function app.zuordnungstreffer(
  p_kandidaten text[],
  p_kreditor_id uuid
)
returns table (
  objekt_id         uuid,
  objektnummer      text,
  merkmalstyp       text,
  wert_normalisiert text,
  trefferzahl       integer
)
language sql
stable
security definer
set search_path = public, app
as $$
  select m.objekt_id, o.objektnummer, m.merkmalstyp, m.wert_normalisiert, m.trefferzahl
    from zuordnungs_merkmal m
    join objekt o on o.id = m.objekt_id
   where m.mandant_id = app.mein_mandant()
     and m.aktiv
     and m.wert_normalisiert = any (p_kandidaten)
     and (m.kreditor_id is null or m.kreditor_id = p_kreditor_id)
   order by m.trefferzahl desc, m.wert_normalisiert;
$$;

comment on function app.zuordnungstreffer(text[], uuid) is
  'Liefert alle gelernten Treffer des Mandanten -- auch zu Objekten, die der '
  'Fragende nicht sehen darf. Sonst waere eine mehrdeutige Zuordnung fuer '
  'den einen eindeutig und fuer den anderen nicht, und das Ergebnis haette '
  'vom Zufall der Zustaendigkeit abgehangen.';

grant execute on function app.zuordnungstreffer(text[], uuid) to dms_app;
