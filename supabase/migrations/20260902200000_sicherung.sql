-- ===========================================================================
-- Sicherung und geprobter Restore (Konzept 24, Punkt 7)
-- ===========================================================================
--
-- "Ein Archiv ohne getesteten Restore ist kein Archiv." Was hier entsteht,
-- ist nicht die Sicherung selbst -- die macht `pg_dump` --, sondern das, was
-- danach die eigentliche Frage beantwortet: **Ist das Zurueckgeholte noch
-- dasselbe?**
--
-- Ein `pg_restore`, das mit Rueckgabewert 0 endet, beantwortet sie nicht. Er
-- sagt, dass Zeilen angekommen sind, nicht dass die Hash-Kette traegt, dass
-- die Dateien zu ihren Hashes passen und dass die Zugriffsregeln noch
-- greifen.
--
-- DER FUND: DIE HASH-KETTE WAR NICHT ZEITZONENFEST
--
-- `app.stempel_kette` rechnet den Eintragshash unter anderem ueber
-- `new.zeitpunkt::text`. Die Textdarstellung eines `timestamptz` haengt an
-- den Sitzungseinstellungen `TimeZone` und `DateStyle` -- derselbe Zeitpunkt
-- ergibt unter `UTC` und unter `Europe/Berlin` verschiedene Zeichenketten
-- und damit verschiedene Hashes.
--
-- Gemessen, nicht vermutet: Alle bestehenden Eintraege stimmen unter `UTC`
-- und **keiner einzige** unter `Europe/Berlin`.
--
-- Warum das ausgerechnet hier auffaellt: Ein Restore geht selten auf
-- denselben Rechner. Landet die Datenbank auf einem Server, dessen
-- `timezone` auf `Europe/Berlin` steht -- fuer eine deutsche Verwaltung die
-- naheliegende Einstellung --, dann erschiene die **gesamte** Kette
-- gebrochen. Im Ernstfall, unter Zeitdruck, wuerde daraus entweder "das
-- Archiv ist zerstoert" oder, schlimmer, "die Pruefung ist kaputt, schalten
-- wir sie ab".
--
-- Die Kette selbst laesst sich nicht nachtraeglich anders rechnen -- sie ist
-- append-only, und das ist ihr Sinn. Was geht: die Einstellungen an der
-- Funktion **festnageln**, damit sie kuenftig unabhaengig vom Server gilt.
-- Fuer die bestehenden Eintraege aendert sich dadurch nichts, denn sie sind
-- unter genau diesen Einstellungen entstanden (nachgerechnet: null
-- Abweichungen).


-- ---------------------------------------------------------------------------
-- Teil 1: Die Hashes werden von der Serverkonfiguration unabhaengig
-- ---------------------------------------------------------------------------
--
-- `set` an der Funktion gilt fuer ihre Ausfuehrung, gleich was die Sitzung
-- eingestellt hat. Damit ist der Hash reproduzierbar -- auch in zehn Jahren,
-- auf einem anderen Rechner, durch einen Dritten. Genau das schuldet eine
-- Hash-Kette, die als Nachweis dienen soll.
create or replace function app.stempel_kette()
returns trigger
language plpgsql
set search_path = public, app
-- Festgenagelt, nicht geerbt: siehe Kopf. Ohne diese beiden Zeilen haengt
-- der Nachweis an einer Servereinstellung, die niemand mitsichert.
set timezone = 'UTC'
set datestyle = 'ISO, MDY'
as $$
declare
  vorher text;
begin
  select e.eintrag_hash into vorher
    from stempel_ereignis e
   where e.lauf_id = new.lauf_id
   order by e.folge desc
   limit 1;

  new.vorheriger_hash := vorher;
  new.eintrag_hash := encode(sha256(convert_to(
      coalesce(vorher, '')
      || new.lauf_id::text
      || coalesce(new.stufe_id::text, '')
      || new.benutzer_id::text
      || new.entscheidung
      || coalesce(new.freigabe_hash, '')
      || new.zeitpunkt::text,
    'UTF8')), 'hex');

  return new;
end;
$$;


-- Derselbe Grund: `f.rechnungsdatum::text` und `s.frist_am::text` sind
-- `date`, und deren Textdarstellung haengt am `DateStyle`. Unter 'ISO' ist
-- es 'YYYY-MM-DD', unter 'German' waere es '02.09.2026' -- und der
-- Freigabe-Hash ein anderer. Dass sich dadurch nichts aendert, haelt der
-- Test in `tests/schriftverkehr.test.ts` fest: Er nagelt die alte Formel
-- Wort fuer Wort fest.
create or replace function app.freigabe_hash(p_dokument_id uuid)
returns text
language sql
stable
set search_path = public, app
set timezone = 'UTC'
set datestyle = 'ISO, MDY'
as $$
  select encode(sha256(convert_to(
      coalesce(f.kreditor_id::text, '')
      || coalesce(f.rechnungsnummer, '')
      || coalesce(f.rechnungsdatum::text, '')
      || coalesce(f.brutto::text, '')
      || coalesce(d.objekt_id::text, '')
      || coalesce(s.korrespondent, '')
      || coalesce(s.betreff, '')
      || coalesce(s.frist_am::text, ''),
    'UTF8')), 'hex')
    from dokument d
    left join rechnung_fakten f on f.dokument_id = d.id
    left join schriftverkehr_fakten s on s.dokument_id = d.id
   where d.id = p_dokument_id;
$$;


-- ---------------------------------------------------------------------------
-- Teil 2: Die Kette nachrechnen
-- ---------------------------------------------------------------------------
--
-- Rechnet jeden Eintragshash neu und vergleicht. Zwei Dinge werden dabei
-- gefunden, und sie bedeuten Verschiedenes:
--
--   * `hash_falsch`     -- der Eintrag selbst wurde veraendert.
--   * `verkettung_lose` -- `vorheriger_hash` zeigt nicht auf den Vorgaenger.
--     Ein Eintrag wurde herausgeschnitten oder dazwischengeschoben.
--
-- Dieselben festgenagelten Einstellungen wie beim Schreiben -- sonst pruefte
-- die Funktion eine andere Zeichenkette als die, die gehasht wurde.
create or replace function app.kette_pruefen(p_grenze integer default 100)
returns table (
  ereignis_id uuid,
  lauf_id     uuid,
  folge       bigint,
  befund      text
)
language sql
stable
security definer
set search_path = public, app
set timezone = 'UTC'
set datestyle = 'ISO, MDY'
as $$
  with kette as (
    select e.id, e.lauf_id, e.folge, e.eintrag_hash, e.vorheriger_hash,
           e.stufe_id, e.benutzer_id, e.entscheidung, e.freigabe_hash,
           e.zeitpunkt,
           lag(e.eintrag_hash) over (partition by e.lauf_id order by e.folge)
             as vorgaenger
      from stempel_ereignis e
  )
  select k.id, k.lauf_id, k.folge,
         case
           when k.eintrag_hash <> encode(sha256(convert_to(
                  coalesce(k.vorheriger_hash, '')
                  || k.lauf_id::text
                  || coalesce(k.stufe_id::text, '')
                  || k.benutzer_id::text
                  || k.entscheidung
                  || coalesce(k.freigabe_hash, '')
                  || k.zeitpunkt::text, 'UTF8')), 'hex')
             then 'hash_falsch'
           else 'verkettung_lose'
         end
    from kette k
   where k.eintrag_hash <> encode(sha256(convert_to(
           coalesce(k.vorheriger_hash, '')
           || k.lauf_id::text
           || coalesce(k.stufe_id::text, '')
           || k.benutzer_id::text
           || k.entscheidung
           || coalesce(k.freigabe_hash, '')
           || k.zeitpunkt::text, 'UTF8')), 'hex')
      or k.vorheriger_hash is distinct from k.vorgaenger
   order by k.lauf_id, k.folge
   limit p_grenze;
$$;

comment on function app.kette_pruefen(integer) is
  'Rechnet die Hash-Kette der Stempelereignisse nach. Leeres Ergebnis heisst '
  'unversehrt. `security definer`, weil die Pruefung ueber alle Mandanten '
  'gehen muss -- eine Luecke, die nur deshalb nicht gemeldet wird, weil der '
  'Pruefende das Dokument nicht sieht, waere die schlechteste Art von '
  'Entwarnung. Zeitzone und DateStyle sind festgenagelt: Ohne das ergaebe '
  'dieselbe Kette auf einem anders eingestellten Server lauter Abweichungen.';


-- ---------------------------------------------------------------------------
-- Teil 3: Greifen die Schutzmechanismen noch?
-- ---------------------------------------------------------------------------
--
-- Die stillste Art, ein Archiv zu verlieren.
--
-- `pg_restore` bringt Tabellen und Zeilen zurueck. Ob danach noch RLS
-- eingeschaltet ist, ob die Policies existieren und ob die append-only-
-- Trigger haengen, sagt niemand -- und ein System ohne diese drei sieht im
-- Betrieb voellig normal aus. Es faellt erst auf, wenn jemand Daten sieht,
-- die ihn nichts angehen, oder wenn ein Pruefer fragt, warum ein Ereignis
-- nachtraeglich geaendert werden konnte.
--
-- Deshalb ist das hier kein Zusatz, sondern der Kern der Restore-Probe.
create or replace function app.schutz_pruefen()
returns table (
  gegenstand text,
  art        text,
  befund     text
)
language sql
stable
security definer
set search_path = public, app
as $$
  -- 1. Tabellen mit personenbezogenen oder mandantengebundenen Daten, bei
  --    denen die RLS ausgeschaltet ist.
  select c.relname::text, 'rls_aus',
         'Row Level Security ist nicht eingeschaltet.'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
     -- Tabellen ohne Mandantenbezug brauchen keine: reine Stammdaten, die
     -- fuer alle gleich sind, und die pg-boss-Tabellen liegen im eigenen
     -- Schema.
     and c.relname not in ('schema_migrations','aufbewahrungsfrist')

  union all

  -- 2. Tabellen mit eingeschalteter RLS, aber ohne eine einzige Policy.
  --    Das ist der gefaehrlichere Fall: Es sieht geschuetzt aus, und der
  --    Tabelleneigentuemer merkt nichts, weil ihn RLS ohnehin nicht trifft.
  select c.relname::text, 'policy_fehlt',
         'RLS ist an, aber es gibt keine Policy.'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)

  union all

  -- 3. Die Trigger, die Unveraenderlichkeit erzwingen. Namentlich, weil ein
  --    fehlender still ist: Ohne ihn laesst sich ein Ereignis aendern, und
  --    genau das soll unmoeglich sein.
  --
  --    Eine Liste von Hand, und das ist Absicht: Es gibt keine Regel, aus
  --    der sich ableiten liesse, welche Tabelle unveraenderlich sein *soll*
  --    -- nur die Entscheidung, dass sie es ist. Wer eine neue anlegt,
  --    traegt sie hier nach.
  --
  --    Der erste Entwurf hatte einen Namen falsch (`layer_unveraenderlich`
  --    statt `dokument_layer_unveraenderlich`) und meldete den Trigger als
  --    fehlend. Genau so soll sich die Pruefung verhalten, wenn er wirklich
  --    fehlt -- gefunden hat sie damit als erstes einen Fehler in sich
  --    selbst, und denselben in der CLAUDE.md.
  select t.name, 'trigger_fehlt',
         'Der Trigger fuer Unveraenderlichkeit fehlt.'
    from (values
            ('stempel_ereignis_kette'),
            ('stempel_ereignis_unveraenderlich'),
            ('zuweisung_ereignis_unveraenderlich'),
            ('korrektur_ereignis_unveraenderlich'),
            ('prozessdefinition_ereignis_unveraenderlich'),
            ('zugriff_protokoll_unveraenderlich'),
            ('archiv_eintrag_unveraenderlich'),
            ('verfahrensdoku_unveraenderlich'),
            ('dokument_layer_unveraenderlich'),
            ('dokument_archiv_schutz'),
            ('rechnung_fakten_archiv_schutz'),
            ('schriftverkehr_fakten_archiv_schutz'),
            ('kontierung_archiv_schutz')
         ) as t(name)
   where not exists (
     select 1 from pg_trigger g
      where g.tgname = t.name and not g.tgisinternal
   )
   order by 2, 1;
$$;

comment on function app.schutz_pruefen() is
  'Greifen RLS, Policies und die append-only-Trigger noch? Die stillste Art, '
  'ein Archiv zu verlieren: pg_restore bringt Zeilen zurueck und sagt nichts '
  'darueber, ob die Schutzmechanismen daran haengen. Ein System ohne sie '
  'sieht im Betrieb voellig normal aus.';


grant execute on function app.kette_pruefen(integer) to dms_app;
grant execute on function app.schutz_pruefen() to dms_app;
