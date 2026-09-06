-- ===========================================================================
-- Loeschen nach Fristablauf (Konzept 24, Punkt 5)
-- ===========================================================================
--
-- Die Kehrseite der Aufbewahrungspflicht. Bis hierher konnte das System
-- Belege aufbewahren und einschraenken, aber nichts loeschen -- die
-- Kandidatenliste stand seit Wochen, die Ausfuehrung fehlte. Damit war die
-- Loeschpflicht nach Fristablauf unerfuellbar, und das ist kein kleinerer
-- Verstoss als eine zu kurze Aufbewahrung, nur ein leiserer.
--
-- ZWEI GRUENDE ZU LOESCHEN, UND SIE SIND VERSCHIEDEN
--
-- `app.loeschkandidaten` beantwortete bisher nur die eine Haelfte: Belege
-- mit einem **Loeschanspruch**, dessen Aufbewahrung inzwischen abgelaufen
-- ist. Die andere Haelfte fehlte -- Belege, nach denen niemand gefragt hat,
-- deren Frist aber vorbei ist. Die DSGVO verlangt beides; der Unterschied
-- ist die Dringlichkeit, nicht die Pflicht.
--
-- WIE DIE SCHUTZTRIGGER DAS ZULASSEN
--
-- Drei Trigger weisen jedes Loeschen ab: `app.archiv_unveraenderlich` am
-- Dokument, `app.archiv_satellit_schutz` an Kontierung und Fakten,
-- `app.archiv_eintrag_schutz` am Archiveintrag. Das ist richtig und soll so
-- bleiben.
--
-- Sie bekommen deshalb **eine** Ausnahme, und die ist keine Fahne, die
-- jemand setzen kann, sondern eine Tatsache, die sie selbst nachpruefen:
-- `app.loeschung_faellig()`. Ein Sitzungsschalter waere bequemer und waere
-- genau die Hintertuer, gegen die es die Trigger gibt -- wer ihn setzt,
-- loescht alles. Eine nachgeprueft Tatsache laesst sich nicht setzen.


-- ---------------------------------------------------------------------------
-- Teil 1: Wann ein Beleg wirklich faellig ist
-- ---------------------------------------------------------------------------
--
-- Drei Bedingungen, alle drei noetig:
--
--   * archiviert -- ein laufender Beleg wird nie ueber diesen Weg geloescht,
--     er wird storniert;
--   * die Aufbewahrungsfrist ist vorbei (sie rechnet ab Jahresende, § 147 AO);
--   * keine Loeschsperre -- ein laufendes Verfahren haelt den Beleg, auch
--     wenn die Frist abgelaufen ist.
--
-- `stable` und ohne `security definer`: Die Funktion steht in Triggern, die
-- ohnehin unter den Rechten des Handelnden laufen, und sie liest nur
-- `archiv_eintrag`. Ein `security definer` waere hier eine unnoetige
-- Ausweitung.
create or replace function app.loeschung_faellig(
  p_dokument_id uuid,
  p_stichtag    date default current_date
)
returns boolean
language sql
stable
set search_path = public, app
as $$
  select exists (
    select 1 from archiv_eintrag a
     where a.dokument_id = p_dokument_id
       and a.aufbewahrung_bis < p_stichtag
       and not a.loeschsperre
  );
$$;

comment on function app.loeschung_faellig(uuid, date) is
  'Ob ein Beleg geloescht werden darf: archiviert, Frist abgelaufen, keine '
  'Loeschsperre. Die Schutztrigger fragen sie -- deshalb ist die Ausnahme '
  'vom Loeschverbot eine nachpruefbare Tatsache und keine Fahne, die jemand '
  'setzen kann.';

grant execute on function app.loeschung_faellig(uuid, date) to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 2: Das Loeschprotokoll
-- ---------------------------------------------------------------------------
--
-- Was bleibt, wenn ein Beleg geht.
--
-- Ohne Protokoll waere eine Luecke im Archiv nicht von einem Verlust zu
-- unterscheiden: Ein Pruefer, der Beleg 4711 sucht und nicht findet, kann
-- nicht wissen, ob er geloescht wurde oder abhanden kam. Mit Protokoll ist
-- die Antwort eine Zeile.
--
-- Es enthaelt **keine personenbezogenen Daten** -- das waere der Widerspruch
-- in sich: Ein Loeschprotokoll, das den Namen des Kreditors behaelt, hat
-- nicht geloescht. Was bleibt, ist die Kennung des Belegs, die Fristen und
-- der Hash. Der Hash ist kein Personenbezug, aber er beantwortet die Frage
-- "war der geloeschte Beleg der, der hier im Archiv stand".

create table loeschung (
  dokument_id      uuid primary key,
  mandant_id       uuid not null references mandant(id),

  -- Warum geloescht wurde. Die beiden Gruende sind fachlich verschieden:
  -- Der eine erfuellt einen Anspruch, der andere eine Pflicht.
  grund            text not null check (grund in ('loeschanspruch','fristablauf')),

  archiviert_am    date,
  aufbewahrung_bis date not null,
  hash_sha256      text,

  -- Wo die Datei lag. Nicht als Erinnerung, sondern als Auftrag: Solange
  -- `datei_geloescht_am` leer ist, liegt sie noch im Objektspeicher.
  storage_key      text,
  storage_fassung  text,
  datei_geloescht_am timestamptz,

  geloescht_am     timestamptz not null default now(),
  geloescht_von    uuid references benutzer(id)
);

create index loeschung_offen_idx on loeschung (geloescht_am)
  where datei_geloescht_am is null and storage_key is not null;

comment on table loeschung is
  'Was bleibt, wenn ein Beleg geht: dass es ihn gab, wann seine Frist ablief '
  'und dass er geloescht wurde. Ohne personenbezogene Daten -- ein '
  'Loeschprotokoll, das den Namen behaelt, hat nicht geloescht. Ohne dieses '
  'Protokoll waere eine Luecke im Archiv nicht von einem Verlust zu '
  'unterscheiden.';

comment on column loeschung.storage_key is
  'Der Auftrag an den Durchgang: Solange datei_geloescht_am leer ist, liegt '
  'die Datei noch im Objektspeicher. Dasselbe Muster wie beim Ausgangsbuch '
  'und bei der Objektsperre -- die Zeile ist die Warteschlange.';

alter table loeschung enable row level security;

-- Lesen darf, wer den Mandanten sieht. Ein Loeschprotokoll ist kein
-- Geheimnis -- es ist der Nachweis, dass richtig geloescht wurde.
create policy loeschung_lesen on loeschung for select
  using (mandant_id = (select app.mein_mandant()));

-- Geschrieben wird nur ueber app.dokument_endgueltig_loeschen.
--
-- Fast unveraenderlich: `datei_geloescht_am` muss sich einmal setzen
-- lassen -- der Durchgang, der die Datei im Objektspeicher abraeumt, kommt
-- spaeter. Dieselbe Regel wie bei der Objektsperre: null -> Wert ja,
-- Wert -> anderer Wert nein. Alles andere bleibt fest.
create or replace function app.loeschung_schutz()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Loeschprotokolle werden nicht geloescht -- sonst waere eine Luecke im '
      'Archiv nicht von einem Verlust zu unterscheiden.';
  end if;

  if (new.dokument_id, new.mandant_id, new.grund, new.aufbewahrung_bis,
      new.hash_sha256, new.storage_key, new.geloescht_am, new.geloescht_von)
     is distinct from
     (old.dokument_id, old.mandant_id, old.grund, old.aufbewahrung_bis,
      old.hash_sha256, old.storage_key, old.geloescht_am, old.geloescht_von) then
    raise exception
      'Am Loeschprotokoll laesst sich nur vermerken, dass die Datei '
      'abgeraeumt wurde.';
  end if;

  if old.datei_geloescht_am is not null
     and new.datei_geloescht_am is distinct from old.datei_geloescht_am then
    raise exception 'Der Zeitpunkt steht bereits fest.';
  end if;

  return new;
end;
$$;

create trigger loeschung_unveraenderlich
  before update or delete on loeschung
  for each row execute function app.loeschung_schutz();

grant select on loeschung to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 3: Die Schutztrigger lassen genau diesen einen Fall durch
-- ---------------------------------------------------------------------------

create or replace function app.archiv_unveraenderlich()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from archiv_eintrag a where a.dokument_id = old.id) then
      -- Die einzige Ausnahme: Die Aufbewahrungsfrist ist abgelaufen und
      -- keine Loeschsperre haelt den Beleg. Dann ist das Loeschen keine
      -- Verletzung der Aufbewahrung, sondern ihre Kehrseite.
      if not app.loeschung_faellig(old.id) then
        raise exception 'Archivierte Belege werden nicht geloescht (Konzept 19).';
      end if;
      return old;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and exists (select 1 from archiv_eintrag a where a.dokument_id = old.id) then
    if (new.objekt_id, new.belegart, new.ordnungsgruppe_id)
       is distinct from (old.objekt_id, old.belegart, old.ordnungsgruppe_id) then
      raise exception
        'Der Beleg ist archiviert. Zuordnung und Belegart sind damit fest -- '
        'Korrektur nur ueber Storno und Neuerfassung (Konzept 19).';
    end if;
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;


create or replace function app.archiv_satellit_schutz()
returns trigger
language plpgsql
set search_path = public, app
as $$
declare
  betroffen uuid;
begin
  betroffen := case tg_op when 'DELETE' then old.dokument_id else new.dokument_id end;

  if exists (select 1 from archiv_eintrag a where a.dokument_id = betroffen) then
    -- Dieselbe Ausnahme wie am Dokument: Beim faelligen Loeschen gehen die
    -- Satelliten mit. Ein Beleg ohne Kontierung waere kein geloeschter
    -- Beleg, sondern ein halber.
    if not (tg_op = 'DELETE' and app.loeschung_faellig(betroffen)) then
      raise exception
        'Der Beleg ist archiviert. Kontierung und Rechnungsdaten sind damit '
        'fest (Konzept 19).';
    end if;
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;


create or replace function app.archiv_eintrag_schutz()
returns trigger
language plpgsql
set search_path = public, app
as $$
begin
  if tg_op = 'DELETE' then
    -- Der Archiveintrag geht mit dem Beleg. Was von ihm bleibt, steht im
    -- Loeschprotokoll -- Frist, Hash und dass es ihn gab.
    if not app.loeschung_faellig(old.dokument_id) then
      raise exception 'Archiveintraege werden nicht geloescht (Konzept 19).';
    end if;
    return old;
  end if;

  if (new.dokument_id, new.archiviert_am, new.hash_sha256,
      new.aufbewahrung_bis, new.aufbewahrungsgrund,
      new.verfahrensdoku_version)
     is distinct from
     (old.dokument_id, old.archiviert_am, old.hash_sha256,
      old.aufbewahrung_bis, old.aufbewahrungsgrund,
      old.verfahrensdoku_version) then
    raise exception
      'Am Archiveintrag laesst sich nur die Loeschsperre aendern. Die '
      'Aufbewahrungsfrist ist eine Pflicht, keine Einstellung.';
  end if;

  if old.storage_object_lock_bis is not null
     and new.storage_object_lock_bis is distinct from old.storage_object_lock_bis then
    raise exception
      'Die Objektsperre ist gesetzt und laesst sich nicht mehr aendern -- der '
      'Speicher nimmt sie auch nicht zurueck (Compliance-Modus).';
  end if;

  if old.storage_fassung is not null
     and new.storage_fassung is distinct from old.storage_fassung then
    raise exception
      'Die gesperrte Fassung steht fest. Eine andere einzutragen hiesse, auf '
      'Bytes zu zeigen, die nicht die archivierten sind.';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- Teil 4: Die Kandidaten -- beide Gruende
-- ---------------------------------------------------------------------------
--
-- `app.loeschkandidaten` bleibt, wie sie war: Sie beantwortet die Frage
-- nach offenen **Loeschanspruechen** und wird an mehreren Stellen so
-- benutzt. Daneben tritt die vollstaendige Sicht.
create or replace function app.loeschfaellig(
  p_stichtag date default current_date,
  p_grenze   integer default 500
)
returns table (
  dokument_id      uuid,
  grund            text,
  aufbewahrung_bis date,
  archiviert_am    date,
  belegart         text,
  objektnummer     text
)
language sql
stable
security definer
set search_path = public, app
as $$
  select a.dokument_id,
         case when exists (
                select 1 from einschraenkung e
                 where e.dokument_id = a.dokument_id
                   and e.aufgehoben_am is null
                   and e.geloescht_am is null)
              then 'loeschanspruch' else 'fristablauf' end,
         a.aufbewahrung_bis,
         a.archiviert_am::date,
         d.belegart,
         o.objektnummer
    from archiv_eintrag a
    join dokument d on d.id = a.dokument_id
    left join objekt o on o.id = d.objekt_id
   -- Mandantenfilter von Hand, weil `security definer` die RLS umgeht --
   -- dieselbe Auflage wie bei app.loeschkandidaten.
   where d.mandant_id = app.mein_mandant()
     and a.aufbewahrung_bis < p_stichtag
     and not a.loeschsperre
   -- Loeschanspruecke zuerst: Dort wartet jemand auf eine Antwort.
   order by 2, a.aufbewahrung_bis
   limit p_grenze;
$$;

comment on function app.loeschfaellig(date, integer) is
  'Alle Belege, deren Aufbewahrung abgelaufen ist -- mit und ohne '
  'Loeschanspruch. app.loeschkandidaten kennt nur die mit Anspruch; die '
  'anderen fielen bisher durch, und die Loeschpflicht nach Fristablauf war '
  'damit unerfuellbar.';


-- ---------------------------------------------------------------------------
-- Teil 5: Loeschen -- eine eigene Handlung
-- ---------------------------------------------------------------------------
--
-- Bewusst je Beleg und nicht als Rundumschlag. Eine Funktion, die alle
-- faelligen Belege auf einmal loescht, wird irgendwann versehentlich
-- aufgerufen -- und danach gibt es nichts, worauf man zurueckgreifen
-- koennte.
--
-- Reihenfolge: erst das Protokoll, dann der Beleg. Andersherum bliebe bei
-- einem Abbruch dazwischen ein geloeschter Beleg ohne Spur -- und niemand
-- koennte sagen, ob er geloescht wurde oder verlorenging. Beides in einer
-- Transaktion, also faellt entweder beides oder nichts.
create or replace function app.dokument_endgueltig_loeschen(p_dokument_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  eintrag record;
begin
  if not app.darf('stammdaten_pflegen') then
    raise exception
      'Endgueltiges Loeschen ist Teil der Stammdatenpflege. Dieses Recht '
      'fehlt.';
  end if;

  select a.dokument_id, a.aufbewahrung_bis, a.archiviert_am::date as archiviert_am,
         a.hash_sha256, a.storage_fassung, d.mandant_id,
         (select f.storage_key from dokument_datei f
           where f.dokument_id = a.dokument_id and f.variante = 'original'
           limit 1) as storage_key,
         exists (select 1 from einschraenkung e
                  where e.dokument_id = a.dokument_id
                    and e.aufgehoben_am is null and e.geloescht_am is null) as anspruch
    into eintrag
    from archiv_eintrag a
    join dokument d on d.id = a.dokument_id
   -- Mandantenfilter von Hand: `security definer` umgeht die RLS, und ein
   -- Loeschen ueber die Mandantengrenze waere der schlimmste denkbare Fehler.
   where a.dokument_id = p_dokument_id
     and d.mandant_id = app.mein_mandant();

  if not found then
    return false;
  end if;

  if not app.loeschung_faellig(p_dokument_id) then
    raise exception
      'Der Beleg ist noch aufzubewahren (bis %) oder traegt eine '
      'Loeschsperre.', eintrag.aufbewahrung_bis;
  end if;

  insert into loeschung (dokument_id, mandant_id, grund, archiviert_am,
                         aufbewahrung_bis, hash_sha256, storage_key,
                         storage_fassung, geloescht_von)
  values (p_dokument_id, eintrag.mandant_id,
          case when eintrag.anspruch then 'loeschanspruch' else 'fristablauf' end,
          eintrag.archiviert_am, eintrag.aufbewahrung_bis, eintrag.hash_sha256,
          eintrag.storage_key, eintrag.storage_fassung, app.mein_benutzer());

  /*
   * Die Einschraenkung wird als erledigt vermerkt, bevor sie mitgeloescht
   * wird -- der Vorgang "Loeschantrag bearbeitet" bleibt damit im Protokoll
   * derselben Transaktion nachvollziehbar.
   */
  update einschraenkung set geloescht_am = now()
   where dokument_id = p_dokument_id and geloescht_am is null;

  delete from dokument where id = p_dokument_id;
  return true;
end;
$$;

comment on function app.dokument_endgueltig_loeschen(uuid) is
  'Loescht einen Beleg, dessen Aufbewahrung abgelaufen ist -- je Beleg und '
  'nur auf ausdrueckliche Handlung. Erst das Protokoll, dann der Beleg: '
  'Andersherum bliebe bei einem Abbruch ein geloeschter Beleg ohne Spur. '
  'Die Datei im Objektspeicher raeumt ein eigener Durchgang ab.';

grant execute on function app.loeschfaellig(date, integer) to dms_app;
grant execute on function app.dokument_endgueltig_loeschen(uuid) to dms_app;


-- Was noch im Speicher liegt.
create or replace function app.loeschung_dateien_offen(p_grenze integer default 200)
returns table (dokument_id uuid, storage_key text, storage_fassung text)
language sql
stable
security definer
set search_path = public, app
as $$
  select l.dokument_id, l.storage_key, l.storage_fassung
    from loeschung l
   where l.datei_geloescht_am is null
     and l.storage_key is not null
   order by l.geloescht_am
   limit p_grenze;
$$;

create or replace function app.loeschung_datei_vermerken(p_dokument_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
begin
  -- Der Schutztrigger laesst genau diese eine Aenderung zu: ein Datum,
  -- das vorher leer war. Kein Abschalten noetig -- ein Trigger, den man
  -- zum Arbeiten abschalten muss, wird irgendwann nicht wieder
  -- eingeschaltet.
  update loeschung set datei_geloescht_am = now()
   where dokument_id = p_dokument_id and datei_geloescht_am is null;
  return found;
end;
$$;

grant execute on function app.loeschung_dateien_offen(integer) to dms_app;
grant execute on function app.loeschung_datei_vermerken(uuid) to dms_app;
