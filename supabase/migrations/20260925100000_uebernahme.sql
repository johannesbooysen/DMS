-- ===========================================================================
-- Bestandsuebernahme aus dem abzuloesenden System (Konzept 24.12)
-- ===========================================================================
--
-- Amagno hat zehn Jahre Belege; ohne sie ist jeder Vergleich unfair, und
-- ohne sie steht der Bestand im Pruefungsfall in zwei Systemen. Die
-- Uebernahme bringt ihn hierher -- als **archivierte** Belege mit ihren
-- Fakten, nicht als neue Eingaenge: Ein Beleg von 2019 laeuft nicht noch
-- einmal durch die sachliche Pruefung.
--
-- WAS HIER STEHT
--
-- 1. Ein fuenfter Eingangskanal, `uebernahme`. Er sagt am Beleg fuer immer,
--    woher er kam -- und dass er nicht durch den eigenen Ablauf gegangen
--    ist. Eine Betriebspruefung fragt genau das.
--
-- 2. Ein Protokoll je uebernommenem Beleg: welche Kennung er im alten
--    System hatte, welche Datei, welcher Beleg daraus wurde, mit welchem
--    Ausgang. Append-only, wie alles, was etwas nachweist. Der eindeutige
--    Index verhindert, dass derselbe Altbeleg zweimal uebernommen wird --
--    ein zweiter Lauf ueber denselben Export ueberspringt, was schon da ist.
--
-- Die Zuordnung der Spalten des Exports steht **nicht** hier, sondern in
-- einer JSON-Datei neben dem Export (`uebernahme.json`): Welche Spalte der
-- Kreditor ist, weiss nur, wer den Export gemacht hat.

alter table dokument drop constraint dokument_eingangskanal_check;
alter table dokument add constraint dokument_eingangskanal_check
  check (eingangskanal in ('mail','scan','upload','ftp','uebernahme'));

comment on column dokument.eingangskanal is
  'mail | scan | upload | ftp | uebernahme. "uebernahme" traegt ein Beleg aus '
  'dem abzuloesenden System: archiviert uebernommen, nie durch den eigenen '
  'Ablauf gelaufen.';

create table uebernahme_eintrag (
  id           uuid primary key default gen_random_uuid(),
  mandant_id   uuid not null references mandant(id),
  -- Ein Lauf ist ein Aufruf des Werkzeugs; die Kennung ist der Zeitpunkt.
  lauf         text not null,
  -- Woher: 'amagno', spaeter vielleicht anderes.
  quelle       text not null,
  -- Die Kennung im alten System -- der Schluessel, ueber den ein Pruefer
  -- vom alten zum neuen Beleg findet.
  alt_kennung  text not null,
  datei        text not null,
  dokument_id  uuid references dokument(id) on delete cascade,
  ergebnis     text not null check (ergebnis in ('uebernommen','dublette','fehler')),
  grund        text,
  benutzer_id  uuid references benutzer(id),
  zeitpunkt    timestamptz not null default now()
);

comment on table uebernahme_eintrag is
  'Protokoll der Bestandsuebernahme: je Altbeleg Kennung, Datei, neuer Beleg '
  'und Ausgang. Append-only. Ein Altbeleg wird hoechstens einmal uebernommen.';

create unique index uebernahme_eintrag_einmal
  on uebernahme_eintrag (mandant_id, quelle, alt_kennung)
  where ergebnis = 'uebernommen';

create index on uebernahme_eintrag (mandant_id, lauf);

alter table uebernahme_eintrag enable row level security;

create policy uebernahme_eintrag_lesen on uebernahme_eintrag for select
  using (mandant_id = (select app.mein_mandant()));

create policy uebernahme_eintrag_anlegen on uebernahme_eintrag for insert
  with check (mandant_id = (select app.mein_mandant()));

-- Nie aendern, nie loeschen: Ein Nachweis, der sich anpassen laesst, ist
-- keiner.
create trigger uebernahme_eintrag_unveraenderlich
  before update or delete on uebernahme_eintrag
  for each row execute function app.nur_anfuegen();

grant select, insert on uebernahme_eintrag to dms_app;


-- ---------------------------------------------------------------------------
-- Der neue Trigger gehoert in die Schutzpruefung
-- ---------------------------------------------------------------------------

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
            ('sicherungs_probe_unveraenderlich'),
            ('uebernahme_eintrag_unveraenderlich')
         ) as t(name)
   where not exists (
     select 1 from pg_trigger g
      where g.tgname = t.name and not g.tgisinternal
   )
   order by 2, 1;
$$;
