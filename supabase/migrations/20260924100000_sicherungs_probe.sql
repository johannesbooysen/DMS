-- ===========================================================================
-- Protokoll der Restore-Proben (Konzept 24.7, Inbetriebnahme)
-- ===========================================================================
--
-- "Eine Probe, die niemand notiert, hat im Pruefungsfall nicht
-- stattgefunden." So stand es bisher im organisatorischen Teil der
-- Verfahrensdokumentation -- als Auftrag an einen Menschen, Datum und
-- Ergebnis von Hand zu fuehren. Ein Auftrag, der beim dritten Mal vergessen
-- wird, und dann steht dort ein Datum von vor einem halben Jahr, oder gar
-- keines.
--
-- Deshalb vermerkt die Probe ihr Ergebnis **selbst**, in derselben
-- Datenbank, die sie geprobt hat. Damit ist "wann wurde zuletzt geprobt,
-- und mit welchem Ausgang" eine Abfrage und keine Erinnerung -- und die
-- Inbetriebnahmepruefung (`npm run inbetriebnahme`) kann es fragen, statt
-- es zu glauben.
--
-- WAS HIER STEHT UND WAS NICHT
--
-- Zeitpunkt, Alter der Sicherung, Ausgang, Zaehlwerte, Programmfassung.
-- **Keine Befundtexte**: Die nennen Dokumentkennungen und Tabellennamen,
-- und ein Protokoll, das dauerhaft bleibt, soll nicht mehr tragen, als die
-- Frage braucht. Wer den Grund wissen will, wiederholt die Probe -- sie ist
-- billig, das ist der Sinn der Sache.
--
-- Ohne `mandant_id`, wie `betrieb_lebenszeichen`: Die Sicherung umfasst
-- alle Mandanten, eine Probe "je Mandant" gibt es nicht. Keine
-- personenbezogenen Daten.

create table sicherungs_probe (
  id              uuid primary key default gen_random_uuid(),
  zeitpunkt       timestamptz not null default now(),
  -- Wann die geprobte Sicherung gezogen wurde (aus ihrem Manifest). Der
  -- Abstand zum Zeitpunkt der Probe sagt, wie alt der Stand war, den man
  -- im Ernstfall zurueckbekaeme.
  sicherung_vom   timestamptz not null,
  -- getragen: fehlerfrei, vollstaendig, Kette und Schutz in Ordnung.
  -- befunde:  mindestens ein harter Befund -- diese Sicherung ist unbrauchbar.
  -- leer:     nichts zu beanstanden, aber auch nichts vorgefunden (keine
  --           Stempelereignisse, keine Archiveintraege). Belegt Kette und
  --           Dateien nicht.
  ergebnis        text not null check (ergebnis in ('getragen', 'befunde', 'leer')),
  ereignisse      integer not null check (ereignisse >= 0),
  archiveintraege integer not null check (archiveintraege >= 0),
  dateien         integer not null check (dateien >= 0),
  befunde         integer not null default 0 check (befunde >= 0),
  fassung         text
);

comment on table sicherungs_probe is
  'Jede Restore-Probe traegt sich hier selbst ein. Betriebsdaten, kein '
  'Mandantenbezug, keine personenbezogenen Daten, keine Befundtexte.';

comment on column sicherungs_probe.ergebnis is
  'getragen | befunde | leer. "leer" ist keine Entwarnung: Die Probe hat '
  'nichts vorgefunden, was Kette und Dateien belegt haette.';

create index sicherungs_probe_zeitpunkt on sicherungs_probe (zeitpunkt desc);

alter table sicherungs_probe enable row level security;

-- Lesen darf jeder Angemeldete -- es steht nichts darin, was jemand nicht
-- wissen duerfte. Geschrieben wird **nur als Eigentuemer**, also von der
-- Probe selbst (sie laeuft wie Sicherung und Migration ausserhalb der RLS).
-- Keine Schreibpolicy: Ein `insert` unter `dms_app` wird abgewiesen, und
-- das ist gewollt -- ein zweiter Weg, eine Probe zu vermerken, waere ein
-- Weg, eine vorzutaeuschen.
create policy sicherungs_probe_lesen on sicherungs_probe
  for select using (true);

grant select on sicherungs_probe to dms_app;

-- Nie aendern, nie loeschen. Ein Protokoll, das sich nachtraeglich anpassen
-- laesst, beweist nichts -- dieselbe Bauart wie bei der
-- Verfahrensdokumentation.
create trigger sicherungs_probe_unveraenderlich
  before update or delete on sicherungs_probe
  for each row execute function app.nur_anfuegen();


-- ---------------------------------------------------------------------------
-- Die letzte Probe
-- ---------------------------------------------------------------------------
--
-- Das Alter rechnet die Datenbank in Tagen, nicht der Aufrufer aus einem
-- `timestamptz` -- die Zeitzonenfalle, die im Projekt schon dreimal
-- zugeschlagen hat. Der Zeitpunkt kommt als ISO-Text mit, fuer die Ausgabe.

create or replace function app.letzte_sicherungsprobe()
returns table (
  zeitpunkt       text,
  alter_tage      integer,
  sicherung_vom   text,
  ergebnis        text,
  ereignisse      integer,
  archiveintraege integer,
  dateien         integer,
  befunde         integer,
  fassung         text
)
language sql
stable
as $$
  select to_char(p.zeitpunkt at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         extract(day from (now() - p.zeitpunkt))::integer,
         to_char(p.sicherung_vom at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         p.ergebnis, p.ereignisse, p.archiveintraege, p.dateien, p.befunde, p.fassung
    from sicherungs_probe p
   order by p.zeitpunkt desc
   limit 1;
$$;

grant execute on function app.letzte_sicherungsprobe() to dms_app;


-- ---------------------------------------------------------------------------
-- Der neue Trigger gehoert in die Schutzpruefung
-- ---------------------------------------------------------------------------
--
-- `app.schutz_pruefen` fuehrt die Unveraenderlichkeitstrigger namentlich
-- (20260902200000: "Wer eine neue anlegt, traegt sie hier nach"). Die
-- Funktion wird deshalb mit der um einen Namen laengeren Liste neu
-- geschrieben; der uebrige Text ist unveraendert.

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
  select c.relname::text, 'rls_aus',
         'Row Level Security ist nicht eingeschaltet.'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
     and c.relname not in ('schema_migrations','aufbewahrungsfrist')

  union all

  select c.relname::text, 'policy_fehlt',
         'RLS ist an, aber es gibt keine Policy.'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)

  union all

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
            ('kontierung_archiv_schutz'),
            ('sicherungs_probe_unveraenderlich')
         ) as t(name)
   where not exists (
     select 1 from pg_trigger g
      where g.tgname = t.name and not g.tgisinternal
   )
   order by 2, 1;
$$;
