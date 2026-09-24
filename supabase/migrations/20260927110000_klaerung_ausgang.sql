-- Der Weg aus der Klaerung (Konzept 8.5): der naechste Stempel an der
-- gemerkten Stufe.
--
-- `app.moegliche_stempel` bot nur bei laufendem Lauf Stempel an. In der
-- Klaerung gab es damit keinen einzigen -- und da nichts anderes den Zustand
-- aendert, blieb ein Beleg, der einmal zur Klaerung ging, dort fuer immer:
-- Lauf auf "klaerung", Eintrag im Klaerungspostfach offen, Aufgabe offen.
-- Gefunden beim Schreiben des Browsertests fuer die Klaerung.
--
-- Jetzt gilt in der Klaerung dieselbe Auswahl wie im Lauf. Was den Stempel
-- trotzdem aufhaelt, ist ein harter Befund -- das prueft `stempelSetzen`
-- fuer jede Entscheidung ausser Ablehnung und Klaerung, und die Engine
-- schliesst mit dem Stempel die offenen Klaerungen und stellt den Lauf
-- zurueck auf laufend.

create or replace function app.moegliche_stempel(p_lauf_id uuid, p_stufe_id uuid)
returns table (
  stempeltyp_id     uuid,
  name              text,
  kurzcode          text,
  entscheidung      text,
  farbe             text,
  kommentar_pflicht boolean
)
language sql
stable
set search_path = public, app
as $$
  select st.id, st.name, st.kurzcode, st.entscheidung, st.farbe, st.kommentar_pflicht
    from dokument_lauf l
    join dokument d on d.id = l.dokument_id
    join aufgabe a on a.lauf_id = l.id and a.stufe_id = p_stufe_id
                  and a.status in ('offen','in_arbeit')
    join prozessstufe_stempeltyp pst on pst.stufe_id = p_stufe_id
    join stempeltyp st on st.id = pst.stempeltyp_id and st.aktiv
   where l.id = p_lauf_id
     -- Auch in der Klaerung: Der naechste Stempel an der gemerkten Stufe ist
     -- der Weg heraus (Migration 20260927110000). Vorher bot die Funktion in
     -- der Klaerung nichts an, und der Beleg kam nie wieder heraus.
     and l.status in ('laufend', 'klaerung')
     and exists (
       select 1 from stempel_recht sr
        where sr.stempeltyp_id = st.id
          and (
            sr.gruppe_id = any (app.meine_gruppen())
            or exists (
              select 1 from benutzer_rolle_objekt bro
               where bro.rolle_id = sr.rolle_id
                 and bro.benutzer_id = app.mein_benutzer()
                 and (bro.objekt_id = d.objekt_id or bro.objekt_id is null)
                 and bro.gueltig_von <= current_date
                 and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)
            )
          )
     )
     -- Vier Augen: Was der Trigger abweisen wuerde, wird nicht angeboten.
     and (st.entscheidung <> 'freigabe'
          or app.vier_augen_grund(p_lauf_id, p_stufe_id, st.id, app.mein_benutzer()) is null)
   order by pst.sortierung, st.name;
$$;
