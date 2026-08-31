-- Archivierung, Aufbewahrung, Einschraenkung
--
-- Konzept 19. Drei Dinge, die auseinandergehalten gehoeren:
--
--   * **Archiviert** heisst: Der Beleg ist fertig und wird nicht mehr
--     geaendert. Korrekturen laufen ueber Storno plus Neuerfassung mit
--     Verweis auf das Ursprungsdokument.
--   * **Aufbewahrungsfrist** heisst: Er darf bis zu einem Datum nicht
--     geloescht werden. Das ist eine Pflicht, keine Berechtigung.
--   * **Eingeschraenkt** heisst: Es gibt einen Loeschanspruch nach DSGVO, dem
--     eine Aufbewahrungspflicht entgegensteht. Dann wird nicht geloescht,
--     sondern die Verarbeitung eingeschraenkt -- Kennzeichnung und Entzug
--     aller Leserechte, Loeschung erst nach Fristablauf.
--
-- Der dritte Punkt ist der, den man falsch macht, wenn man ihn nicht
-- aufschreibt: Ein Loeschantrag an einem aufbewahrungspflichtigen Beleg wird
-- weder ignoriert noch ausgefuehrt. Beides waere ein Rechtsverstoss, nur
-- gegen verschiedene Gesetze.


-- ---------------------------------------------------------------------------
-- Teil 1: Aufbewahrungsfristen als Stammdatum
-- ---------------------------------------------------------------------------

-- Zehn Jahre fuer Buchungsbelege, sechs fuer Handelsbriefe -- das steht in der
-- Abgabenordnung und aendert sich, wenn der Gesetzgeber es aendert. Also
-- Stammdatum und keine Konstante im Code (Konzept 3, "Konfiguration statt
-- Code"). Wer die Frist anpasst, aendert eine Zeile, kein Deployment.
create table aufbewahrungsfrist (
  id          uuid primary key default gen_random_uuid(),
  mandant_id  uuid not null references mandant(id),
  belegart    text not null,
  jahre       integer not null check (jahre between 1 and 100),
  grund       text not null,
  aktiv       boolean not null default true,
  unique (mandant_id, belegart)
);

comment on table aufbewahrungsfrist is
  'Frist je Belegart. Die Frist beginnt mit Ablauf des Kalenderjahres, in dem '
  'der Beleg entstanden ist (Paragraf 147 AO) -- das rechnet '
  'app.aufbewahrung_bis, nicht diese Tabelle.';


-- Ende der Aufbewahrung.
--
-- Die Frist laeuft ab dem **Ende** des Jahres, nicht ab dem Belegdatum: Ein
-- Beleg vom 2. Januar und einer vom 30. Dezember desselben Jahres verfallen
-- am selben Tag. Wer ab Belegdatum rechnet, loescht zu frueh -- und das faellt
-- erst bei einer Pruefung auf.
create or replace function app.aufbewahrung_bis(p_dokument_id uuid)
returns table (bis date, grund text)
language sql
stable
set search_path = public, app
as $$
  select make_date(
           coalesce(f.wirtschaftsjahr, extract(year from d.eingang_am)::integer)
             + coalesce(af.jahre, 10),
           12, 31),
         coalesce(af.grund, 'Vorgabefrist zehn Jahre (Paragraf 147 AO)')
    from dokument d
    left join rechnung_fakten f on f.dokument_id = d.id
    left join aufbewahrungsfrist af on af.mandant_id = d.mandant_id
                                   and af.belegart = d.belegart
                                   and af.aktiv
   where d.id = p_dokument_id;
$$;

comment on function app.aufbewahrung_bis(uuid) is
  'Ohne hinterlegte Frist gilt zehn Jahre -- die laengere. Eine fehlende '
  'Konfiguration darf nicht dazu fuehren, dass zu frueh geloescht wird.';


-- ---------------------------------------------------------------------------
-- Teil 2: Archiveintrag
-- ---------------------------------------------------------------------------

create table archiv_eintrag (
  dokument_id             uuid primary key references dokument(id) on delete cascade,
  archiviert_am           timestamptz not null default now(),
  archiviert_durch        uuid references benutzer(id),
  hash_sha256             text not null,
  storage_object_lock_bis date,
  aufbewahrung_bis        date not null,
  aufbewahrungsgrund      text not null,
  verfahrensdoku_version  text,
  loeschsperre            boolean not null default false,
  loeschsperre_grund      text,

  check (not loeschsperre or loeschsperre_grund is not null)
);

create index archiv_frist_idx on archiv_eintrag (aufbewahrung_bis)
  where not loeschsperre;

comment on table archiv_eintrag is
  'Ein Eintrag je Dokument, angelegt beim Archivieren und danach '
  'unveraenderlich. Der Hash ist der Nachweis, dass die Datei seither '
  'dieselbe ist -- ohne ihn waere Object Lock eine Behauptung.';

comment on column archiv_eintrag.storage_object_lock_bis is
  'Bis wann der Objektspeicher die Datei selbst schuetzt (S3 Object Lock, '
  'Compliance-Modus). Die Datenbank kann das nicht durchsetzen; sie haelt '
  'nur fest, was gesetzt wurde. Bei der Dateisystem-Ablage der Entwicklung '
  'bleibt die Spalte leer -- ehrlicher als ein Datum, das nichts bewirkt.';

comment on column archiv_eintrag.loeschsperre is
  'Haelt den Beleg ueber die Frist hinaus -- laufendes Verfahren, Pruefung, '
  'Rechtsstreit. Ohne Begruendung nicht setzbar.';

-- Fast unveraenderlich: Die Loeschsperre muss gesetzt und wieder aufgehoben
-- werden koennen -- ein laufendes Verfahren beginnt und endet, und beides ist
-- keine nachtraegliche Aenderung des Archivierten.
--
-- Der erste Entwurf hatte hier `app.nur_anfuegen()`. Damit war die Spalte
-- `loeschsperre` aus Konzept 19 unerreichbar: vorhanden, aber nie setzbar.
-- Ein Test hat es gefunden.
create or replace function app.archiv_eintrag_schutz()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Archiveintraege werden nicht geloescht (Konzept 19).';
  end if;

  if (new.dokument_id, new.archiviert_am, new.hash_sha256,
      new.aufbewahrung_bis, new.aufbewahrungsgrund,
      new.storage_object_lock_bis, new.verfahrensdoku_version)
     is distinct from
     (old.dokument_id, old.archiviert_am, old.hash_sha256,
      old.aufbewahrung_bis, old.aufbewahrungsgrund,
      old.storage_object_lock_bis, old.verfahrensdoku_version) then
    raise exception
      'Am Archiveintrag laesst sich nur die Loeschsperre aendern. Die '
      'Aufbewahrungsfrist ist eine Pflicht, keine Einstellung.';
  end if;

  return new;
end;
$$;

create trigger archiv_eintrag_unveraenderlich
  before update or delete on archiv_eintrag
  for each row execute function app.archiv_eintrag_schutz();


-- ---------------------------------------------------------------------------
-- Teil 3: Einschraenkung der Verarbeitung (DSGVO gegen GoBD)
-- ---------------------------------------------------------------------------

create table einschraenkung (
  id               uuid primary key default gen_random_uuid(),
  dokument_id      uuid not null references dokument(id) on delete cascade,
  mandant_id       uuid not null references mandant(id),
  beantragt_am     date not null,
  eingetragen_am   timestamptz not null default now(),
  eingetragen_von  uuid references benutzer(id),
  grund            text not null,
  -- Wann die Loeschung nachgeholt werden darf: das Ende der Aufbewahrung.
  loeschbar_ab     date not null,
  aufgehoben_am    timestamptz,
  geloescht_am     timestamptz,
  unique (dokument_id)
);

create index einschraenkung_faellig_idx on einschraenkung (loeschbar_ab)
  where geloescht_am is null and aufgehoben_am is null;

comment on table einschraenkung is
  'Ein Loeschanspruch an einem aufbewahrungspflichtigen Beleg fuehrt zur '
  'Einschraenkung der Verarbeitung, nicht zur Loeschung (Konzept 19). Der '
  'Beleg verschwindet aus allen Sichten; der Eintrag hier bleibt sichtbar, '
  'damit nachweisbar ist, dass der Antrag bearbeitet wurde. Er enthaelt '
  'deshalb auch keine personenbezogenen Daten -- nur den Grund der '
  'Aufbewahrung.';

alter table dokument add column eingeschraenkt boolean not null default false;

comment on column dokument.eingeschraenkt is
  'Denormalisiert aus `einschraenkung`, gepflegt per Trigger. Die '
  'RLS-Policy braucht die Auskunft je Zeile -- ein Unterabfrage-Join in der '
  'Policy waere genau der Fehler, vor dem die Warnung in 20260828100100 '
  'steht.';

create or replace function app.einschraenkung_spiegeln()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  update dokument d
     set eingeschraenkt = exists (
           select 1 from einschraenkung e
            where e.dokument_id = d.id
              and e.aufgehoben_am is null
              and e.geloescht_am is null)
   where d.id = coalesce(new.dokument_id, old.dokument_id);
  return null;
end;
$$;

create trigger einschraenkung_spiegel
  after insert or update or delete on einschraenkung
  for each row execute function app.einschraenkung_spiegeln();


-- Die Leserechte entziehen. Das ist der eigentliche Vollzug: Ohne diese
-- Aenderung waere die Einschraenkung eine Notiz.
drop policy dokument_lesen on dokument;

create policy dokument_lesen on dokument for select
  using (
    not eingeschraenkt
    and mandant_id = app.mein_mandant()
    and (
      objekt_id is null
      or objekt_id = any (app.meine_objekte())
      or spezialgebiet_id = any (app.meine_spezialgebiete())
    )
  );

comment on policy dokument_lesen on dokument is
  'Eingeschraenkte Belege sind fuer niemanden mehr lesbar -- auch nicht fuer '
  'den Objektverantwortlichen. Genau das verlangt die Einschraenkung der '
  'Verarbeitung; wer eine Ausnahme einbaut, hebt sie auf. Dass es den Beleg '
  'gibt und warum er aufbewahrt wird, steht in `einschraenkung`.';


-- ---------------------------------------------------------------------------
-- Teil 4: Unveraenderlichkeit nach der Archivierung
-- ---------------------------------------------------------------------------

-- Nach dem Archivieren ist Schluss. Erlaubt bleiben genau zwei Wege:
-- Stornierung und Einschraenkung -- beide sind keine Korrektur des Inhalts,
-- sondern Aussagen ueber den Beleg.
create or replace function app.archiv_unveraenderlich()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from archiv_eintrag a where a.dokument_id = old.id) then
      raise exception 'Archivierte Belege werden nicht geloescht (Konzept 19).';
    end if;
    return old;
  end if;

  if not exists (select 1 from archiv_eintrag a where a.dokument_id = old.id) then
    return new;
  end if;

  if new.status is distinct from old.status
     and new.status not in ('storniert','archiviert') then
    raise exception 'Ein archivierter Beleg wechselt nur nach storniert.';
  end if;

  if (new.objekt_id, new.belegart, new.inhalt_hash, new.ordnungsgruppe_id)
     is distinct from
     (old.objekt_id, old.belegart, old.inhalt_hash, old.ordnungsgruppe_id) then
    raise exception
      'Archivierte Belege werden nicht geaendert. Korrektur laeuft ueber '
      'Storno und Neuerfassung (Konzept 19).';
  end if;

  return new;
end;
$$;

create trigger dokument_archiv_schutz
  before update or delete on dokument
  for each row execute function app.archiv_unveraenderlich();


-- Auch die Fachdaten am archivierten Beleg sind fest.
create or replace function app.archiv_satellit_schutz()
returns trigger
language plpgsql
set search_path = public, app
as $$
declare
  betroffen uuid;
begin
  betroffen := coalesce(
    case tg_op when 'DELETE' then old.dokument_id else new.dokument_id end,
    null);

  if exists (select 1 from archiv_eintrag a where a.dokument_id = betroffen) then
    raise exception
      'Der Beleg ist archiviert. Kontierung und Rechnungsdaten sind damit '
      'fest (Konzept 19).';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger kontierung_archiv_schutz
  before insert or update or delete on kontierung
  for each row execute function app.archiv_satellit_schutz();

create trigger rechnung_fakten_archiv_schutz
  before insert or update or delete on rechnung_fakten
  for each row execute function app.archiv_satellit_schutz();


-- ---------------------------------------------------------------------------
-- Teil 5: Archivieren, Stornieren, Einschraenken
-- ---------------------------------------------------------------------------

create or replace function app.dokument_archivieren(
  p_dokument_id uuid,
  p_object_lock_bis date default null,
  p_verfahrensdoku  text default null
)
returns date
language plpgsql
security definer
set search_path = public, app
as $$
declare
  hash  text;
  frist record;
begin
  -- Der Hash der Originaldatei ist der Nachweis. Faellt er weg, ist das
  -- Archiv eine Behauptung -- deshalb keine Archivierung ohne ihn.
  select d.inhalt_hash into hash
    from dokument d
   where d.id = p_dokument_id
     and d.mandant_id = app.mein_mandant()
     and d.status not in ('storniert');

  if hash is null then
    return null;
  end if;

  select * into frist from app.aufbewahrung_bis(p_dokument_id);

  insert into archiv_eintrag (dokument_id, archiviert_durch, hash_sha256,
                              storage_object_lock_bis, aufbewahrung_bis,
                              aufbewahrungsgrund, verfahrensdoku_version)
  values (p_dokument_id, app.mein_benutzer(), hash, p_object_lock_bis,
          frist.bis, frist.grund, p_verfahrensdoku)
  on conflict (dokument_id) do nothing;

  -- `abgelehnt` bleibt stehen. Abgelehnte Belege werden archiviert und
  -- behalten trotzdem ihren Status -- der Archiveintrag sagt, dass archiviert
  -- wurde, der Status sagt, was aus dem Beleg geworden ist. Wer beides in eine
  -- Spalte presst, verliert die zweite Auskunft.
  update dokument set status = 'archiviert'
   where id = p_dokument_id and status not in ('archiviert','abgelehnt');

  return frist.bis;
end;
$$;


-- Storno. Der Beleg bleibt, er wird nicht korrigiert.
create or replace function app.dokument_stornieren(
  p_dokument_id uuid,
  p_grund       text
)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  vorhanden boolean;
begin
  if p_grund is null or btrim(p_grund) = '' then
    raise exception 'Ein Storno braucht eine Begruendung.';
  end if;

  select true into vorhanden
    from dokument d
   where d.id = p_dokument_id and d.mandant_id = app.mein_mandant();

  if vorhanden is not true then
    return false;
  end if;

  update dokument set status = 'storniert' where id = p_dokument_id;

  -- Der Grund gehoert an den Lauf, nicht an das Dokument: Dort steht die
  -- Geschichte, und dort sucht ihn spaeter jemand.
  insert into stempel_ereignis (lauf_id, benutzer_id, entscheidung, kommentar)
  select l.id, app.mein_benutzer(), 'ablehnung', 'Storniert: ' || p_grund
    from dokument_lauf l where l.dokument_id = p_dokument_id;

  update dokument_lauf
     set status = 'storniert', beendet_am = now()
   where dokument_id = p_dokument_id and status <> 'storniert';

  return true;
end;
$$;

comment on function app.dokument_stornieren(uuid, text) is
  'Nach der Archivierung ist Storno plus Neuerfassung der einzige Weg '
  '(Konzept 19). Die Ersatzrechnung ist ein neues Dokument und wird ueber '
  'dokument_beziehung mit der Art `ersetzt` verkettet.';


create or replace function app.verarbeitung_einschraenken(
  p_dokument_id  uuid,
  p_grund        text,
  p_beantragt_am date default current_date
)
returns date
language plpgsql
security definer
set search_path = public, app
as $$
declare
  frist record;
  m     uuid;
begin
  select d.mandant_id into m
    from dokument d
   where d.id = p_dokument_id and d.mandant_id = app.mein_mandant();

  if m is null then
    return null;
  end if;

  select * into frist from app.aufbewahrung_bis(p_dokument_id);

  insert into einschraenkung (dokument_id, mandant_id, beantragt_am,
                              eingetragen_von, grund, loeschbar_ab)
  values (p_dokument_id, m, p_beantragt_am, app.mein_benutzer(),
          p_grund, frist.bis)
  on conflict (dokument_id) do update
     set aufgehoben_am = null, grund = excluded.grund;

  return frist.bis;
end;
$$;

comment on function app.verarbeitung_einschraenken(uuid, text, date) is
  'Der Beleg wird nicht geloescht, sondern unsichtbar -- fuer alle. Loeschbar '
  'ist er erst nach Ablauf der Aufbewahrung; bis dahin belegt der Eintrag, '
  'dass der Antrag bearbeitet wurde.';


-- Was darf jetzt geloescht werden?
--
-- Liefert nur Kandidaten. Das Loeschen selbst ist eine eigene Handlung mit
-- eigenem Protokoll -- eine Funktion, die beides tut, wuerde irgendwann
-- versehentlich aufgerufen.
-- `security definer`, und das ist hier keine Bequemlichkeit:
--
-- Ein eingeschraenkter Beleg ist fuer niemanden mehr sichtbar -- also auch
-- sein Archiveintrag nicht. Eine gewoehnliche Abfrage faende ihn deshalb nie,
-- und die Loeschpflicht nach Fristablauf waere still unerfuellbar. Genau die
-- Belege, um die es geht, waeren unsichtbar.
--
-- Geliefert werden nur Kennung, Grund und Frist -- kein Inhalt. Die
-- Einschraenkung bleibt damit unangetastet.
create or replace function app.loeschkandidaten(p_stichtag date default current_date)
returns table (dokument_id uuid, grund text, frist date)
language sql
stable
security definer
set search_path = public, app
as $$
  select e.dokument_id,
         'Loeschanspruch, Aufbewahrung abgelaufen'::text,
         e.loeschbar_ab
    from einschraenkung e
    join archiv_eintrag a on a.dokument_id = e.dokument_id
   where e.mandant_id = app.mein_mandant()
     and e.geloescht_am is null
     and e.aufgehoben_am is null
     and e.loeschbar_ab <= p_stichtag
     and not a.loeschsperre;
$$;

comment on function app.loeschkandidaten(date) is
  'Der Mandantenfilter steht hier von Hand, weil `security definer` die RLS '
  'umgeht -- ohne ihn saehe jeder die Loeschkandidaten aller Mandanten.';


-- ---------------------------------------------------------------------------
-- Teil 6: RLS und Rechte
-- ---------------------------------------------------------------------------

alter table aufbewahrungsfrist enable row level security;
alter table archiv_eintrag     enable row level security;
alter table einschraenkung     enable row level security;

create policy aufbewahrungsfrist_sicht on aufbewahrungsfrist for all
  using (mandant_id = app.mein_mandant())
  with check (mandant_id = app.mein_mandant());

-- Der Archiveintrag folgt der Sichtbarkeit des Belegs. Ist der Beleg
-- eingeschraenkt, ist auch sein Archiveintrag weg -- er traegt den Hash und
-- damit einen Bezug zum Inhalt.
create policy archiv_eintrag_sicht on archiv_eintrag for select
  using (exists (select 1 from dokument d where d.id = dokument_id));

-- Die Einschraenkung dagegen bleibt sichtbar, obwohl der Beleg es nicht ist:
-- Sonst gaebe es keinen Nachweis, dass der Loeschantrag bearbeitet wurde --
-- der Beleg waere unsichtbar und der Vorgang spurlos.
create policy einschraenkung_sicht on einschraenkung for select
  using (mandant_id = app.mein_mandant());

grant select on archiv_eintrag, einschraenkung to dms_app;
grant select, insert, update on aufbewahrungsfrist to dms_app;
grant execute on function app.aufbewahrung_bis(uuid) to dms_app;
grant execute on function app.dokument_archivieren(uuid, date, text) to dms_app;
grant execute on function app.dokument_stornieren(uuid, text) to dms_app;
grant execute on function app.verarbeitung_einschraenken(uuid, text, date) to dms_app;
grant execute on function app.loeschkandidaten(date) to dms_app;
