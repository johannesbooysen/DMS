-- ---------------------------------------------------------------------------
-- Vier Augen: zwei Einstellungen, die es seit dem Kernschema gibt und die
-- nie jemand ausgewertet hat
-- ---------------------------------------------------------------------------
--
-- `prozessstufe.vier_augen_pflicht` und `stempeltyp.vier_augen_pflicht`
-- stehen seit 20260828100000. Beide wurden beim Versionieren gewissenhaft
-- mitkopiert und hatten keine Wirkung -- eine Einstellung, die aussieht, als
-- schuetze sie etwas. Im abzuloesenden System steht derselbe Befund rot im
-- Kasten: "Zahlung erfassen" und "Zahlung ausfuehren" durch dieselbe
-- Person, weil niemand es verhindert (docs/analyse-amagno-bestand.md, 4).
--
-- Die Frage "darf dieselbe Person erfassen und ausfuehren?" hat zwei Ebenen,
-- und sie duerfen nicht verwechselt werden:
--
--   * **Rollen sagen, wer darf.** Wer beide Rechte traegt, darf beides --
--     im Allgemeinen. Das regelt das Rollenmodell, und daran aendert sich
--     nichts.
--   * **Vier Augen sagt: nicht dieselben zwei auf einem Beleg.** Das ist
--     keine Eigenschaft einer Person, sondern der **Stufe im Ablauf** -- und
--     der Ablauf gilt je Kategorie. Also je Kategorie definierbar, ohne an
--     Rollen zu drehen.
--
-- Zwei Schaerfen, zwei Schalter:
--
--   * **An der Stufe** (`prozessstufe.vier_augen_pflicht`): Wer diese Stufe
--     abschliesst, darf nicht die **vorherige** abgeschlossen haben. Das ist
--     das klassische Vier-Augen-Paar: Erfassung und Pruefung, Kontierung und
--     Zahlung.
--   * **Am Stempeltyp** (`stempeltyp.vier_augen_pflicht`): Wer diesen
--     Stempel setzt, darf auf diesem Beleg **noch keine** Stufe
--     abgeschlossen haben. Fuer den Stempel, der Geld anweist.
--
-- Beides prueft ein Trigger auf `stempel_ereignis` -- die Grenze ist die
-- Datenbank, nicht die Oberflaeche. `app.moegliche_stempel` spiegelt die
-- Regel, damit der Knopf gar nicht erst erscheint. Und die
-- Ausfuehrbarkeitspruefung meldet, wenn eine Stufe vier Augen verlangt, es
-- aber keine zwei gibt, die sie liefern koennten.
--
-- **Keine Namen in der Fehlermeldung.** Wer die vorherige Stufe gestempelt
-- hat, weiss der Handelnde -- er war es selbst. Der Stufenname genuegt.

-- ---------------------------------------------------------------------------
-- Die Frage, an einer Stelle
-- ---------------------------------------------------------------------------

-- Liefert NULL, wenn der Benutzer an dieser Stufe mit diesem Stempeltyp
-- stempeln darf, sonst den Grund. Nur fuer Entscheidungen, die die Stufe
-- abschliessen (`freigabe`) -- eine Klaerung ist keine Pruefung.
create or replace function app.vier_augen_grund(
  p_lauf_id      uuid,
  p_stufe_id     uuid,
  p_stempeltyp_id uuid,
  p_benutzer_id  uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  stufe_pflicht   boolean;
  stempel_pflicht boolean;
  vorherige       record;
begin
  select s.vier_augen_pflicht into stufe_pflicht from prozessstufe s where s.id = p_stufe_id;
  select t.vier_augen_pflicht into stempel_pflicht from stempeltyp t where t.id = p_stempeltyp_id;

  if coalesce(stufe_pflicht, false) then
    -- Die zuletzt abgeschlossene *andere* Stufe dieses Laufs.
    select e.benutzer_id, s.bezeichnung
      into vorherige
      from stempel_ereignis e
      join prozessstufe s on s.id = e.stufe_id
     where e.lauf_id = p_lauf_id
       and e.entscheidung = 'freigabe'
       and e.stufe_id is distinct from p_stufe_id
     order by e.zeitpunkt desc
     limit 1;
    if vorherige.benutzer_id = p_benutzer_id then
      return format('Vier-Augen-Prinzip: Diese Stufe muss jemand anderes abschliessen als die vorherige (%s).',
                    vorherige.bezeichnung);
    end if;
  end if;

  if coalesce(stempel_pflicht, false) then
    if exists (select 1 from stempel_ereignis e
                where e.lauf_id = p_lauf_id
                  and e.entscheidung = 'freigabe'
                  and e.stufe_id is distinct from p_stufe_id
                  and e.benutzer_id = p_benutzer_id) then
      return 'Vier-Augen-Prinzip: Diesen Stempel setzt nur, wer auf diesem Beleg noch keine Stufe abgeschlossen hat.';
    end if;
  end if;

  return null;
end;
$$;

grant execute on function app.vier_augen_grund(uuid, uuid, uuid, uuid) to dms_app;

comment on function app.vier_augen_grund(uuid, uuid, uuid, uuid) is
  'NULL, wenn das Vier-Augen-Prinzip dem Stempel nicht entgegensteht; sonst '
  'der Grund. Dieselbe Frage fuer Trigger und Oberflaeche.';

-- ---------------------------------------------------------------------------
-- Die Grenze: der Trigger
-- ---------------------------------------------------------------------------

create or replace function app.vier_augen_pruefen()
returns trigger
language plpgsql
as $$
declare
  grund text;
begin
  if new.entscheidung <> 'freigabe' or new.stufe_id is null then
    return new;
  end if;
  grund := app.vier_augen_grund(new.lauf_id, new.stufe_id, new.stempeltyp_id, new.benutzer_id);
  if grund is not null then
    raise exception '%', grund;
  end if;
  return new;
end;
$$;

-- Vor dem Layer-Trigger und vor der Kette: Ein abgewiesenes Ereignis darf
-- weder Layer noch Hash hinterlassen. Trigger derselben Stufe feuern in
-- alphabetischer Reihenfolge; "aaa_" stellt das sicher, ohne dass jemand
-- die uebrigen Namen kennen muss.
create trigger aaa_stempel_ereignis_vier_augen
  before insert on stempel_ereignis
  for each row execute function app.vier_augen_pruefen();

-- ---------------------------------------------------------------------------
-- Der Spiegel: kein Knopf fuer einen Stempel, der abgewiesen wuerde
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

-- ---------------------------------------------------------------------------
-- Die Pruefung: vier Augen verlangt, aber nur zwei vorhanden
-- ---------------------------------------------------------------------------
--
-- Erweitert 20260916100000 um einen Befund. Der Rest der Funktion ist
-- unveraendert und steht hier nur, weil eine SQL-Funktion nicht stueckweise
-- ergaenzt werden kann.

create or replace function app.prozessbaum_pruefen(p_definition_id uuid)
returns table (schwere text, befund text)
language sql
stable
set search_path = public, app
as $$
  with
  stempler as (
    select distinct s.id as stufe_id, s.reihenfolge, s.vier_augen_pflicht, s.bezeichnung,
           b.id as benutzer_id
      from prozessstufe s
      join prozessdefinition p on p.id = s.definition_id
      join prozessstufe_stempeltyp pst on pst.stufe_id = s.id
      join stempeltyp st on st.id = pst.stempeltyp_id and st.aktiv
                        and st.entscheidung = 'freigabe'
      join stempel_recht sr on sr.stempeltyp_id = st.id
      join benutzer b on b.mandant_id = p.mandant_id and b.aktiv
     where s.definition_id = p_definition_id
       and (
         exists (select 1 from gruppe_mitglied gm
                  where gm.gruppe_id = sr.gruppe_id and gm.benutzer_id = b.id)
         or exists (select 1 from benutzer_rolle_objekt bro
                     where bro.rolle_id = sr.rolle_id
                       and bro.benutzer_id = b.id
                       and bro.gueltig_von <= current_date
                       and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date))
       )
  ),
  zustaendige as (
    select s.id as stufe_id, count(distinct b.id) as personen
      from prozessstufe s
      join prozessdefinition p on p.id = s.definition_id
      left join benutzer b on b.mandant_id = p.mandant_id and b.aktiv and (
           (s.zustaendigkeit_typ = 'rolle' and exists (
              select 1 from benutzer_rolle_objekt bro
               where bro.rolle_id = s.zustaendigkeit_ref and bro.benutzer_id = b.id
                 and bro.gueltig_von <= current_date
                 and (bro.gueltig_bis is null or bro.gueltig_bis >= current_date)))
        or (s.zustaendigkeit_typ = 'gruppe' and exists (
              select 1 from gruppe_mitglied gm
               where gm.gruppe_id = s.zustaendigkeit_ref and gm.benutzer_id = b.id))
        or (s.zustaendigkeit_typ = 'spezialgebiet' and exists (
              select 1 from spezialgebiet_zustaendigkeit sz
               where sz.spezialgebiet_id = s.zustaendigkeit_ref
                 and (sz.benutzer_id = b.id
                      or exists (select 1 from gruppe_mitglied gm
                                  where gm.gruppe_id = sz.gruppe_id and gm.benutzer_id = b.id))))
      )
     where s.definition_id = p_definition_id
       and s.zustaendigkeit_typ in ('rolle','gruppe','spezialgebiet')
     group by s.id
  )

  select 'fehler', 'Kein Wurzelknoten vorhanden.'
   where not exists (select 1 from prozessknoten k
                      where k.definition_id = p_definition_id and k.eltern_id is null)

  union all
  select 'fehler',
         'Knoten ' || k.knotentyp || ' (' || k.id || ') enthaelt nichts.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp <> 'stufe'
     and not exists (select 1 from prozessknoten kind where kind.eltern_id = k.id)

  union all
  select 'fehler',
         'Verzweigung ' || k.id || ' hat ' ||
         (select count(*) from prozessknoten kind where kind.eltern_id = k.id) ||
         ' Zweige statt zwei.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp = 'verzweigung'
     and (select count(*) from prozessknoten kind where kind.eltern_id = k.id) <> 2

  union all
  select 'fehler', 'Verzweigung ' || k.id || ' hat keine Bedingung.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp = 'verzweigung'
     and k.bedingung is null

  union all
  select 'warnung',
         'Paralleler Block ' || k.id || ' enthaelt nur einen Baustein.'
    from prozessknoten k
   where k.definition_id = p_definition_id
     and k.knotentyp = 'gleichzeitig'
     and (select count(*) from prozessknoten kind where kind.eltern_id = k.id) = 1

  union all
  select 'fehler',
         'Stufe "' || s.bezeichnung || '" ist im Ablauf nicht eingehaengt.'
    from prozessstufe s
   where s.definition_id = p_definition_id
     and not exists (select 1 from prozessknoten k where k.stufe_id = s.id)

  union all
  select 'fehler',
         'Stufe "' || s.bezeichnung || '" ist mehrfach eingehaengt.'
    from prozessstufe s
    join prozessknoten k on k.stufe_id = s.id
   where s.definition_id = p_definition_id
   group by s.id, s.bezeichnung
  having count(*) > 1

  union all
  select 'fehler',
         'An Stufe "' || s.bezeichnung || '" darf niemand stempeln, was sie abschliesst -- ' ||
         'kein aktiver Benutzer traegt das Recht auf einen ihrer Freigabestempel. ' ||
         'Belege blieben dort liegen.'
    from prozessstufe s
   where s.definition_id = p_definition_id
     and s.stufentyp <> 'systemaktion'
     and exists (select 1 from prozessstufe_stempeltyp pst
                  join stempeltyp st on st.id = pst.stempeltyp_id and st.aktiv
                                    and st.entscheidung = 'freigabe'
                 where pst.stufe_id = s.id)
     and not exists (select 1 from stempler x where x.stufe_id = s.id)

  union all
  select 'fehler',
         'Stufe "' || s.bezeichnung || '": die Zustaendigkeit (' || s.zustaendigkeit_typ ||
         ') loest auf keine aktive Person auf. Die Aufgabe erreichte kein Postfach.'
    from prozessstufe s
    join zustaendige z on z.stufe_id = s.id
   where s.definition_id = p_definition_id
     and z.personen = 0

  union all
  select 'warnung',
         'Stufe "' || s.bezeichnung || '" haengt an genau einer Person -- faellt sie aus, ' ||
         'steht der Ablauf. Fuer den Alltag gehoert die Stelle in eine Gruppe oder Rolle ' ||
         'mit mehreren Traegern.'
    from prozessstufe s
   where s.definition_id = p_definition_id
     and s.stufentyp <> 'systemaktion'
     and (select count(*) from stempler x where x.stufe_id = s.id) = 1

  union all
  -- Vier Augen verlangt, aber es gibt kein zweites Paar: Niemand kann diese
  -- Stufe abschliessen, ohne auch die vorherige abgeschlossen zu haben.
  select 'fehler',
         'Stufe "' || s.bezeichnung || '" verlangt vier Augen, aber niemand kann sie ' ||
         'abschliessen, der nicht auch die vorherige Stufe "' || v.bezeichnung ||
         '" abschliessen kann. Die Stufe waere unerfuellbar.'
    from prozessstufe s
    join lateral (
      select x.id, x.bezeichnung from prozessstufe x
       where x.definition_id = s.definition_id and x.reihenfolge < s.reihenfolge
       order by x.reihenfolge desc limit 1
    ) v on true
   where s.definition_id = p_definition_id
     and s.vier_augen_pflicht
     and exists (select 1 from stempler a where a.stufe_id = s.id)
     and not exists (
       select 1 from stempler a
        join stempler b on b.stufe_id = v.id and b.benutzer_id <> a.benutzer_id
       where a.stufe_id = s.id
     );
$$;
