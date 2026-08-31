-- Zuordnen als eigene Handlung
--
-- Dritter und letzter Fund aus dem Lernspeicher. Die getrennten Policies aus
-- der vorigen Migration haben ihn nicht behoben, weil die Ursache tiefer
-- liegt:
--
-- PostgreSQL laesst nicht zu, dass jemand eine Zeile so aendert, dass er sie
-- danach nicht mehr sehen kann. Die neue Zeile muss die SELECT-Policy
-- weiterhin erfuellen. Das ist eine sinnvolle Regel -- sie verhindert, dass
-- Daten ins Dunkle geschrieben werden.
--
-- Nur ist Zuordnen genau das: Ein Beleg ohne Objekt ist fuer alle sichtbar;
-- sobald er dem Objekt eines Kollegen zugeordnet wird, verschwindet er aus
-- der eigenen Sicht. Das ist gewollt und trotzdem verboten.
--
-- Also ist Zuordnen keine gewoehnliche Aenderung, sondern eine Fachhandlung
-- mit eigener Regel -- und bekommt eine eigene Funktion. Die Regel lautet:
--
--   * Beleg und Zielobjekt gehoeren zum selben Mandanten wie ich.
--   * Der Beleg ist noch nicht zugeordnet.
--
-- Der zweite Punkt ist die Grenze zur Umgruppierung: Einen bereits
-- zugeordneten Beleg auf ein anderes Objekt zu setzen ist ein anderer
-- Vorgang, der laut Konzept 4 eine Begruendung und einen Protokolleintrag
-- braucht. Den gibt es hier bewusst nicht.

create or replace function app.dokument_zuordnen(
  p_dokument_id uuid,
  p_objekt_id   uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  gehoert_mir boolean;
begin
  select d.mandant_id = app.mein_mandant()
         and o.mandant_id = app.mein_mandant()
         and d.objekt_id is null
    into gehoert_mir
    from dokument d, objekt o
   where d.id = p_dokument_id and o.id = p_objekt_id;

  if gehoert_mir is not true then
    return false;
  end if;

  update dokument set objekt_id = p_objekt_id where id = p_dokument_id;
  return true;
end;
$$;

comment on function app.dokument_zuordnen(uuid, uuid) is
  'Ordnet einen noch nicht zugeordneten Beleg einem Objekt des eigenen '
  'Mandanten zu -- auch einem, fuer das der Zuordnende nicht zustaendig ist. '
  'Danach sieht er den Beleg womoeglich nicht mehr, und das ist richtig so. '
  'Eine bereits bestehende Zuordnung aendert die Funktion nicht; das waere '
  'eine Umgruppierung und braucht Begruendung und Protokoll (Konzept 4).';

grant execute on function app.dokument_zuordnen(uuid, uuid) to dms_app;
