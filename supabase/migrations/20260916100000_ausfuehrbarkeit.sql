-- ---------------------------------------------------------------------------
-- Ausfuehrbarkeit: Kann diesen Ablauf ueberhaupt jemand gehen?
-- ---------------------------------------------------------------------------
--
-- Im Workflow-Diagramm des abzuloesenden Systems (docs/analyse-amagno-
-- bestand.md, Abschnitt 4) stehen drei rot markierte Befunde:
--
--   1. Ein Stempel, den nur eine Einzelperson setzen darf statt der Gruppe.
--   2. Zwei Stempel, die **niemand** setzen darf -- funktional tot.
--   3. Drei Stellen, die an genau einer Person haengen.
--
-- Ein Mensch hat sie gefunden, indem er das ganze Diagramm zurueckkonstruiert
-- hat. Das System selbst meldete nichts: Es hat keinen Begriff davon, dass
-- an einer Stelle jemand haette handeln sollen. Ein Beleg, der dort ankommt,
-- bleibt schweigend liegen -- bis eine Mahnung kommt.
--
-- Unsere Pruefung `app.prozessbaum_pruefen` hatte sieben Befunde, und alle
-- waren **strukturell**: Wurzel, leere Behaelter, Verzweigung ohne Bedingung,
-- Stufe nicht eingehaengt. Keiner fragte, ob den Ablauf jemand gehen kann.
-- Genau dieselbe Luecke, eine Migration spaeter gefunden.
--
-- Drei Befunde kommen hinzu -- geprueft beim Aktivieren, wo sie hingehoeren,
-- statt nach einem Diagramm:
--
--   * **Niemand darf stempeln** (fehler): Die Stufe hat Stempel, aber kein
--     aktiver Benutzer traegt das Recht auf einen davon.
--   * **Zustaendigkeit loest auf niemanden auf** (fehler): Die Rolle hat
--     keinen Traeger, die Gruppe kein Mitglied, das Spezialgebiet keinen
--     Zustaendigen.
--   * **Haengt an genau einer Person** (warnung): Faellt sie aus, steht die
--     Stufe. Eine Warnung und kein Fehler -- ein kleines Haus hat eine
--     Geschaeftsleitung, und das ist kein Konfigurationsfehler, sondern
--     eine Tatsache, die man wissen sollte. Fuer den Ausfall gibt es den
--     Notfallzugriff; fuer den Alltag gehoert die Stelle in eine Gruppe.
--
-- **Was nicht geprueft wird, und warum.** `objektverantwortlich` haengt am
-- Objekt des Belegs, nicht am Ablauf -- ob dort jemand steht, weiss man
-- erst, wenn ein Beleg kommt; die Engine meldet es dann. `extern` und
-- `system` haben keinen Menschen als Traeger. Eine Stufe **ohne** Stempel
-- ist heute die sichere Vorgabe (Migration 20260830130000) und wird hier
-- nicht zusaetzlich gemeldet.
--
-- Gezaehlt wird, wer **heute** darf: aktive Benutzer, Rollen mit gueltigem
-- Zeitraum. Dieselbe Frage wie `app.moegliche_stempel`, nur ohne Objekt --
-- eine Rolle, die nur fuer bestimmte Objekte gilt, zaehlt mit, weil es
-- Belege dieser Objekte geben kann.
--
-- **Gezaehlt wird, wer die Stufe abschliessen kann** -- Entscheidung
-- `freigabe` --, nicht, wer irgendeinen Stempel setzen darf. Der erste
-- Entwurf zaehlte alle Stempel, und im Seed durften ploetzlich an jeder
-- Stufe drei Personen: weil jede Stufe einen Klaerungsstempel hat und den
-- jeder setzen darf. Wer einen Beleg in die Klaerung schieben kann, bringt
-- ihn nicht weiter. Die Frage des roten Kastens war: Wer kann hier
-- **entscheiden**? Und die Antwort im Seed lautet an jeder Stufe: genau
-- eine Person.

create or replace function app.prozessbaum_pruefen(p_definition_id uuid)
returns table (schwere text, befund text)
language sql
stable
set search_path = public, app
as $$
  with
  -- Wer kann diese Stufe abschliessen -- einen ihrer Freigabestempel setzen?
  stempler as (
    select distinct s.id as stufe_id, b.id as benutzer_id
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
  -- Auf wen loest die Zustaendigkeit der Stufe auf?
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
  having count(*) > 1

  union all
  -- Niemand darf stempeln: Die Stufe hat Freigabestempel, aber keinen, der sie setzen darf
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
  -- Zustaendigkeit ohne Menschen
  select 'fehler',
         'Stufe "' || s.bezeichnung || '": die Zustaendigkeit (' || s.zustaendigkeit_typ ||
         ') loest auf keine aktive Person auf. Die Aufgabe erreichte kein Postfach.'
    from prozessstufe s
    join zustaendige z on z.stufe_id = s.id
   where s.definition_id = p_definition_id
     and z.personen = 0

  union all
  -- Genau eine Person: faellt sie aus, steht die Stufe
  select 'warnung',
         'Stufe "' || s.bezeichnung || '" haengt an genau einer Person -- faellt sie aus, ' ||
         'steht der Ablauf. Fuer den Alltag gehoert die Stelle in eine Gruppe oder Rolle ' ||
         'mit mehreren Traegern.'
    from prozessstufe s
   where s.definition_id = p_definition_id
     and s.stufentyp <> 'systemaktion'
     and (select count(*) from stempler x where x.stufe_id = s.id) = 1;
$$;

comment on function app.prozessbaum_pruefen(uuid) is
  'Liefert Befunde der Schwere "fehler" oder "warnung". Leeres Ergebnis heisst '
  'aktivierbar. Prueft Struktur (Wurzel, Behaelter, Verzweigungen, eingehaengte '
  'Stufen) und seit 20260916100000 die Ausfuehrbarkeit: ob an jeder Stufe '
  'jemand stempeln darf, ob die Zustaendigkeit auf Menschen aufloest und ob eine '
  'Stufe an genau einer Person haengt. Unerreichbare Stufen und Endlosschleifen '
  'prueft die Simulation.';
