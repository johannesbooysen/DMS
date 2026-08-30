-- Workflow als Blockbaum
--
-- Grundlage: ADR 0002, Teil A. Bausteine rasten ineinander, statt frei
-- verbunden zu werden. Vier Knotenarten:
--
--   nacheinander  enthaelt Bausteine, die der Reihe nach laufen
--   gleichzeitig  enthaelt Bausteine, die parallel laufen; endet, wenn alle
--                 abgeschlossen sind
--   verzweigung   enthaelt genau zwei Zweige, gewaehlt ueber eine Bedingung
--   stufe         ein Blatt: verweist auf eine prozessstufe
--
-- Der Gewinn liegt in dem, was dadurch unmoeglich wird: Jede Aufspaltung ist
-- zusammengefuehrt, jede Stufe erreichbar, jeder Pfad endlich. Gueltig durch
-- Bauart statt gueltig laut nachtraeglicher Pruefung. Ein freier Graph haette
-- unerreichbare Stufen, offene Aufspaltungen und Endlosschleifen erlaubt.
--
-- prozessstufe bleibt unveraendert: Die Stufen behalten ihre stabilen
-- Kennungen, an denen Aufgaben, Stempelereignisse und Objekt-Overrides
-- haengen. prozessstufe.reihenfolge bleibt die topologische Ordnung, die der
-- Ruecksprung beim gebrochenen Freigabe-Hash braucht -- "die erste betroffene
-- Stufe" ist ohne Ordnung nicht definiert.


create table prozessknoten (
  id            uuid primary key default gen_random_uuid(),
  definition_id uuid not null references prozessdefinition(id) on delete cascade,
  eltern_id     uuid references prozessknoten(id) on delete cascade,
  reihenfolge   integer not null default 0,
  knotentyp     text not null check (knotentyp in
                  ('nacheinander','gleichzeitig','verzweigung','stufe')),
  -- Nur bei verzweigung: strukturierter Ausdruck ueber einer Weissliste,
  -- ausgewertet in src/workflow/bedingung.ts. Bewusst kein Freitext und kein
  -- Skript -- das waere wieder Code an einer Stelle, an der ihn niemand
  -- prueft, testet oder versioniert.
  bedingung     jsonb,
  -- Nur bei knotentyp = 'stufe'
  stufe_id      uuid references prozessstufe(id) on delete cascade,

  -- Blatt genau dann, wenn eine Stufe hinterlegt ist
  constraint prozessknoten_blatt
    check ((knotentyp = 'stufe') = (stufe_id is not null)),
  -- Bedingungen gehoeren an die Verzweigung, sonst nirgendwohin
  constraint prozessknoten_bedingung
    check (bedingung is null or knotentyp = 'verzweigung'),
  -- Geschwister haben eine eindeutige Position
  constraint prozessknoten_position
    unique nulls not distinct (definition_id, eltern_id, reihenfolge)
);

-- Genau ein Wurzelknoten je Definition
create unique index prozessknoten_wurzel_idx
  on prozessknoten (definition_id) where eltern_id is null;

create index prozessknoten_eltern_idx on prozessknoten (eltern_id, reihenfolge);
create index prozessknoten_stufe_idx on prozessknoten (stufe_id);

comment on table prozessknoten is
  'Blockbaum des Ablaufs (ADR 0002). Die Engine laeuft den Baum ab, statt '
  'prozessstufe.reihenfolge hochzuzaehlen.';

comment on column prozessknoten.reihenfolge is
  'Position unter den Geschwistern. Bei verzweigung: 0 = Dann-Zweig, '
  '1 = Sonst-Zweig.';


-- ---------------------------------------------------------------------------
-- Bestandsdefinitionen ueberfuehren
-- ---------------------------------------------------------------------------

-- Aus jeder Kette wird ein Baum: eine nacheinander-Wurzel, darunter die
-- Stufen in ihrer Reihenfolge. Stufen mit gleicher parallelgruppe werden zu
-- einem gleichzeitig-Knoten zusammengefasst, der an der Stelle der ersten
-- Stufe dieser Gruppe steht.
do $$
declare
  d          record;
  wurzel     uuid;
  g          record;
  gruppe     uuid;
  position   integer;
begin
  for d in (select id from prozessdefinition) loop
    -- Nur ueberfuehren, was noch keinen Baum hat
    if exists (select 1 from prozessknoten k where k.definition_id = d.id) then
      continue;
    end if;

    insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp)
    values (d.id, null, 0, 'nacheinander')
    returning id into wurzel;

    position := 0;

    -- Blöcke in der Reihenfolge ihres ersten Auftretens: entweder eine
    -- einzelne Stufe oder eine Parallelgruppe.
    for g in (
      select coalesce(s.parallelgruppe::text, 'einzeln:' || s.id::text) as block,
             min(s.reihenfolge) as ab
        from prozessstufe s
       where s.definition_id = d.id
       group by 1
       order by 2
    ) loop
      if g.block like 'einzeln:%' then
        insert into prozessknoten (definition_id, eltern_id, reihenfolge,
                                   knotentyp, stufe_id)
        select d.id, wurzel, position, 'stufe', s.id
          from prozessstufe s
         where s.definition_id = d.id
           and s.parallelgruppe is null
           and s.id = substring(g.block from 9)::uuid;
      else
        insert into prozessknoten (definition_id, eltern_id, reihenfolge, knotentyp)
        values (d.id, wurzel, position, 'gleichzeitig')
        returning id into gruppe;

        insert into prozessknoten (definition_id, eltern_id, reihenfolge,
                                   knotentyp, stufe_id)
        select d.id, gruppe,
               row_number() over (order by s.reihenfolge) - 1,
               'stufe', s.id
          from prozessstufe s
         where s.definition_id = d.id
           and s.parallelgruppe::text = g.block;
      end if;

      position := position + 1;
    end loop;
  end loop;
end
$$;


-- ---------------------------------------------------------------------------
-- Gueltigkeitspruefung
-- ---------------------------------------------------------------------------

-- Was die Bauart nicht schon ausschliesst, faengt diese Funktion ab. Sie
-- laeuft vor dem Aktivieren einer Fassung; ADR 0002 macht sie zur Auflage,
-- nicht zur Kuer.
create or replace function app.prozessbaum_pruefen(p_definition_id uuid)
returns table (schwere text, befund text)
language sql
stable
set search_path = public, app
as $$
  -- Keine Wurzel
  select 'fehler', 'Kein Wurzelknoten vorhanden.'
   where not exists (select 1 from prozessknoten k
                      where k.definition_id = p_definition_id and k.eltern_id is null)

  union all
  -- Behaelter ohne Inhalt
  select 'fehler',
         'Knoten ' || k.knotentyp || ' (' || k.id || ') enthaelt nichts.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp <> 'stufe'
     and not exists (select 1 from prozessknoten kind where kind.eltern_id = k.id)

  union all
  -- Verzweigung ohne beide Zweige
  select 'fehler',
         'Verzweigung ' || k.id || ' hat ' ||
         (select count(*) from prozessknoten kind where kind.eltern_id = k.id) ||
         ' Zweige statt zwei.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp = 'verzweigung'
     and (select count(*) from prozessknoten kind where kind.eltern_id = k.id) <> 2

  union all
  -- Verzweigung ohne Bedingung
  select 'fehler', 'Verzweigung ' || k.id || ' hat keine Bedingung.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp = 'verzweigung'
     and k.bedingung is null

  union all
  -- Parallelblock mit nur einem Zweig: zulaessig, aber vermutlich ein Versehen
  select 'warnung',
         'Paralleler Block ' || k.id || ' enthaelt nur einen Baustein.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp = 'gleichzeitig'
     and (select count(*) from prozessknoten kind where kind.eltern_id = k.id) = 1

  union all
  -- Stufe der Definition, die im Baum nicht vorkommt: sie wuerde nie laufen
  select 'fehler',
         'Stufe "' || s.bezeichnung || '" ist im Ablauf nicht eingehaengt.'
    from prozessstufe s
   where s.definition_id = p_definition_id
     and not exists (select 1 from prozessknoten k where k.stufe_id = s.id)

  union all
  -- Dieselbe Stufe mehrfach eingehaengt: der Lauf waere nicht eindeutig
  select 'fehler',
         'Stufe "' || s.bezeichnung || '" ist mehrfach eingehaengt.'
    from prozessstufe s
    join prozessknoten k on k.stufe_id = s.id
   where s.definition_id = p_definition_id
   group by s.id, s.bezeichnung
  having count(*) > 1;
$$;

comment on function app.prozessbaum_pruefen(uuid) is
  'Liefert Befunde der Schwere "fehler" oder "warnung". Leeres Ergebnis heisst '
  'aktivierbar. Unerreichbare Stufen, offene Aufspaltungen und Endlosschleifen '
  'kann die Blockstruktur nicht erzeugen -- geprueft wird, was uebrig bleibt.';

grant execute on function app.prozessbaum_pruefen(uuid) to dms_app;

alter table prozessknoten enable row level security;

create policy prozessknoten_sicht on prozessknoten for all
  using (exists (select 1 from prozessdefinition p
                  where p.id = definition_id and p.mandant_id = app.mein_mandant()))
  with check (exists (select 1 from prozessdefinition p
                       where p.id = definition_id and p.mandant_id = app.mein_mandant()));

grant select, insert, update, delete on prozessknoten to dms_app;
