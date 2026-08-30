-- Welche Stempel sind an welcher Stufe moeglich?
--
-- Konzept 8.8 fuehrt die Stufenfolge als Liste mit vier Spalten: Reihenfolge,
-- Zustaendigkeit, Bedingung, **erlaubte Stempel**. Die vierte Spalte fehlte
-- im Schema.
--
-- Sie ist der Grund, warum der Anwender keine Stempelgalerie sieht, sondern
-- zwei oder drei Schaltflaechen (Konzept 8.7): Was moeglich ist, ergibt sich
-- aus der aktuellen Stufe und den Rechten des Benutzers -- nicht aus einer
-- Auswahlliste, in der man sich vergreifen kann.

create table prozessstufe_stempeltyp (
  stufe_id      uuid not null references prozessstufe(id) on delete cascade,
  stempeltyp_id uuid not null references stempeltyp(id) on delete cascade,
  sortierung    integer not null default 0,
  primary key (stufe_id, stempeltyp_id)
);

create index on prozessstufe_stempeltyp (stempeltyp_id);

comment on table prozessstufe_stempeltyp is
  'Die vierte Spalte aus Konzept 8.8. Ohne Eintrag ist an einer Stufe kein '
  'Stempel moeglich -- das ist die sichere Vorgabe: lieber eine Stufe, an der '
  'niemand weiterkommt und die auffaellt, als eine, an der jeder alles darf.';


-- ---------------------------------------------------------------------------
-- Stempelrechte an das Rollenmodell anschliessen
-- ---------------------------------------------------------------------------

-- stempel_recht trug die Rolle als Freitext, weil es das Rollenmodell noch
-- nicht gab. Jetzt gibt es rolle -- der Fremdschluessel ersetzt die Zeichen-
-- kette, bevor sich Daten daran gewoehnen.
alter table stempel_recht drop constraint stempel_recht_check;
alter table stempel_recht drop column rolle;
alter table stempel_recht add column rolle_id uuid references rolle(id) on delete cascade;
alter table stempel_recht
  add constraint stempel_recht_traeger check (num_nonnulls(gruppe_id, rolle_id) = 1);

create index on stempel_recht (rolle_id);
create index on stempel_recht (gruppe_id);


-- ---------------------------------------------------------------------------
-- Welche Stempel darf dieser Benutzer an dieser Stufe setzen?
-- ---------------------------------------------------------------------------

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
     and l.status = 'laufend'
     -- Der Benutzer traegt das Recht auf diesen Stempeltyp, ueber eine Gruppe
     -- oder ueber eine Rolle, die fuer dieses Objekt gilt.
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
   order by pst.sortierung, st.name;
$$;

comment on function app.moegliche_stempel(uuid, uuid) is
  'Bestimmt die Schaltflaechen, die der Anwender sieht: aus aktueller Stufe '
  'und seinen Rechten (Konzept 8.7). Kein Zielfeld, keine Auswahl -- keine '
  'Moeglichkeit, den Beleg an die falsche Station zu schicken.';

grant execute on function app.moegliche_stempel(uuid, uuid) to dms_app;


alter table prozessstufe_stempeltyp enable row level security;

create policy prozessstufe_stempeltyp_sicht on prozessstufe_stempeltyp for all
  using (exists (select 1 from prozessstufe s
                   join prozessdefinition p on p.id = s.definition_id
                  where s.id = stufe_id and p.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from prozessstufe s
                        join prozessdefinition p on p.id = s.definition_id
                       where s.id = stufe_id and p.mandant_id = app.mein_mandant()));

grant select, insert, update, delete on prozessstufe_stempeltyp to dms_app;
