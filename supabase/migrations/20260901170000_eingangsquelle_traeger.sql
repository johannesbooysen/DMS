-- Unter wessen Rechten eine Eingangsquelle arbeitet
--
-- Der Worker hat keinen anmeldenden Benutzer, braucht aber einen Kontext --
-- die RLS ist die Sicherheitsgrenze, auch fuer Belege, die von selbst
-- hereinkommen. `alsSystem` sieht dafuer den "technischen Benutzer des
-- Mandanten" vor. Den gibt es nicht, und ihn jetzt zu erfinden hiesse, ein
-- Konto anzulegen, das alles darf und niemandem gehoert.
--
-- Stattdessen: **Wer die Quelle eingerichtet hat, traegt sie.** Das ist
-- zurechenbar (am Beleg steht ein Name, den man fragen kann), es ist
-- automatisch mandantenrichtig, und es begrenzt von selbst -- eine Quelle
-- kann nichts anlegen, was ihr Einrichter nicht auch von Hand anlegen
-- koennte.
--
-- Der Preis: Scheidet die Person aus und wird ihr Zugang gesperrt, steht die
-- Quelle still. Richtig so -- sie steht dann sichtbar still, mit Grund, statt
-- unter dem Namen eines Ausgeschiedenen weiterzulaufen.

alter table eingangsquelle
  alter column angelegt_von set not null;

comment on column eingangsquelle.angelegt_von is
  'Unter dessen Rechten der Worker die Quelle abarbeitet. Kein technischer '
  'Benutzer: Am Beleg soll ein Name stehen, den man fragen kann.';

drop function if exists app.eingangsquellen_faellig(integer);

create or replace function app.eingangsquellen_faellig(p_grenze integer default 20)
returns table (
  quelle_id         uuid,
  mandant_id        uuid,
  art               text,
  bezeichnung       text,
  einstellungen     jsonb,
  objekt_id         uuid,
  ordnungsgruppe_id uuid,
  belegart          text,
  traeger_id        uuid
)
language sql
stable
security definer
set search_path = public, app
as $$
  select q.id, q.mandant_id, q.art, q.bezeichnung, q.einstellungen,
         q.objekt_id, q.ordnungsgruppe_id, q.belegart, q.angelegt_von
    from eingangsquelle q
    join benutzer b on b.id = q.angelegt_von
   where q.aktiv
     -- Gesperrter Einrichter, stehende Quelle. Sichtbar in der Oberflaeche
     -- ueber `zuletzt_geprueft`, das dann nicht mehr weiterlaeuft.
     and b.aktiv
     and (q.zuletzt_geprueft is null
          or q.zuletzt_geprueft < now() - make_interval(secs => q.takt_sekunden))
   order by q.zuletzt_geprueft nulls first
   limit p_grenze;
$$;

grant execute on function app.eingangsquellen_faellig(integer) to dms_app;
