-- ===========================================================================
-- Verfahrensdokumentation (Konzept 24, Punkt 4)
-- ===========================================================================
--
-- Das dritte Stueck der Revisionssicherheit. Die ersten beiden stehen:
--
--   * die Hash-Kette (20260831200000) -- sie *erkennt* eine Aenderung,
--   * die Objektsperre (20260902100000) -- sie *bewahrt* das Original.
--
-- Beide zusammen belegen, dass ein Beleg seit dem Archivieren derselbe ist.
-- Sie belegen nicht, **nach welchem Verfahren** er dorthin kam. Genau das
-- verlangt die GoBD, und ohne diesen Nachweis wird die Archivierung im
-- Pruefungsfall nicht anerkannt -- unabhaengig davon, wie gut die ersten
-- beiden Stuecke sind.
--
-- WAS HIER STEHT UND WAS NICHT
--
-- Der *Text* der Verfahrensdokumentation gehoert nicht in die Datenbank; er
-- steht in `docs/verfahrensdokumentation.md` und wird zum groessten Teil aus
-- dem Repository erzeugt (`npm run verfahrensdoku`) -- so, wie `stand.md` es
-- schon tut. Eine von Hand gepflegte Beschreibung eines Systems, das sich
-- woechentlich aendert, ist nach einem Monat eine Erzaehlung.
--
-- Hier steht nur, **welche Fassung wann galt**. Das ist der Teil, den die
-- GoBD verlangt und den ein Dokument ueber sich selbst nicht sagen kann: Bei
-- einem Beleg aus 2027 muss beantwortbar sein, nach welchem Verfahren er
-- damals verarbeitet wurde -- nicht nach welchem heute.
--
-- Deshalb ist eine freigegebene Fassung unveraenderlich, traegt den Hash
-- ihres Textes und liegt als Kopie in der Ablage. Ohne die Kopie waere die
-- Versionsnummer eine Behauptung: Der erzeugte Text von heute ist nicht mehr
-- der von damals, und `git` ist kein Archiv im Sinne der GoBD.


-- ---------------------------------------------------------------------------
-- Teil 1: Die freigegebenen Fassungen
-- ---------------------------------------------------------------------------

create table verfahrensdokumentation (
  id               uuid primary key default gen_random_uuid(),
  mandant_id       uuid not null references mandant(id),
  version          text not null,
  gueltig_ab       date not null,
  titel            text not null,
  inhalt_hash      text not null,
  storage_key      text not null,
  freigegeben_von  uuid references benutzer(id),
  freigegeben_am   timestamptz not null default now(),

  unique (mandant_id, version)
);

create index verfahrensdoku_gueltig_idx
  on verfahrensdokumentation (mandant_id, gueltig_ab desc);

comment on table verfahrensdokumentation is
  'Freigegebene Fassungen der Verfahrensdokumentation (GoBD, Konzept 24.4). '
  'Eine Fassung wird nie geaendert -- wer etwas anderes beschreiben will, '
  'gibt eine neue frei. Der Text selbst liegt in der Ablage; hier steht, '
  'welche Fassung ab wann galt.';

comment on column verfahrensdokumentation.inhalt_hash is
  'SHA256 ueber den freigegebenen Text. Derselbe Nachweis wie beim Beleg: '
  'ohne ihn waere die Versionsnummer eine Behauptung.';

comment on column verfahrensdokumentation.gueltig_ab is
  'Ab wann die Fassung gilt. Eine Fassung galt bis zum Tag vor dem '
  'gueltig_ab der naechsten -- ein eigenes Endedatum waere eine zweite '
  'Wahrheit ueber denselben Sachverhalt.';

alter table verfahrensdokumentation enable row level security;

-- Lesen darf jeder im Mandanten. Die Verfahrensdokumentation ist kein
-- Geheimnis -- sie beschreibt, wie gearbeitet wird, und wer danach arbeitet,
-- soll sie lesen koennen.
--
-- Unkorrelierte Unterabfrage, nicht `app.mein_mandant()` direkt: Im
-- Zeilenfilter ruft PostgreSQL eine `stable`-Funktion sonst je Zeile auf
-- (siehe 20260831210000). Hier sind es wenige Zeilen -- die Schreibweise
-- steht trotzdem so da, weil eine Ausnahme im Schema zur Vorlage wird.
create policy verfahrensdoku_lesen on verfahrensdokumentation for select
  using (mandant_id = (select app.mein_mandant()));

create policy verfahrensdoku_anlegen on verfahrensdokumentation for insert
  with check (mandant_id = (select app.mein_mandant()));

-- Nie aendern, nie loeschen. Eine Fassung, die sich nachtraeglich anpassen
-- laesst, beweist nichts -- und ein Pruefer fragt genau danach.
create trigger verfahrensdoku_unveraenderlich
  before update or delete on verfahrensdokumentation
  for each row execute function app.nur_anfuegen();

grant select, insert on verfahrensdokumentation to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 2: Welche Fassung gilt
-- ---------------------------------------------------------------------------

create or replace function app.verfahrensdoku_gueltig(
  p_mandant  uuid,
  p_stichtag date default current_date
)
returns text
language sql
stable
security definer
set search_path = public, app
as $$
  select v.version
    from verfahrensdokumentation v
   where v.mandant_id = p_mandant
     and v.gueltig_ab <= p_stichtag
   -- Die zuletzt in Kraft getretene gewinnt. Ohne `limit 1` innerhalb der
   -- Funktion materialisiert der Planer erst alle Treffer -- `security
   -- definer` verhindert das Inlining (Konzept 21).
   order by v.gueltig_ab desc, v.freigegeben_am desc
   limit 1;
$$;

comment on function app.verfahrensdoku_gueltig(uuid, date) is
  'Die zum Stichtag geltende Fassung, oder null. `security definer`, weil '
  'das Archivieren sie auch dann braucht, wenn der Handelnde die Tabelle '
  'nicht liest -- und weil eine fehlende Fassung sichtbar bleiben soll '
  'statt an einer Policy zu scheitern.';


create or replace function app.verfahrensdoku_freigeben(
  p_version     text,
  p_gueltig_ab  date,
  p_titel       text,
  p_inhalt_hash text,
  p_storage_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  neu     uuid;
  mandant uuid := app.mein_mandant();
  letzte  date;
begin
  if mandant is null then
    raise exception 'Eine Verfahrensdokumentation gehoert zu einem Mandanten.';
  end if;

  if p_version is null or btrim(p_version) = '' then
    raise exception 'Eine Fassung ohne Versionsbezeichnung ist nicht zuzuordnen.';
  end if;

  if p_inhalt_hash is null or btrim(p_inhalt_hash) = '' then
    raise exception
      'Eine Fassung ohne Hash beweist nichts. Der Hash ist der Nachweis, '
      'dass der vorgelegte Text der freigegebene ist.';
  end if;

  /*
   * Keine Fassung darf vor ihrer Vorgaengerin in Kraft treten.
   *
   * Sonst entstuenden zwei Fassungen, die am selben Tag gelten, und die
   * Frage "nach welchem Verfahren wurde dieser Beleg verarbeitet" haette
   * zwei Antworten. Genau die Frage soll diese Tabelle beantworten.
   */
  select max(v.gueltig_ab) into letzte
    from verfahrensdokumentation v
   where v.mandant_id = mandant;

  if letzte is not null and p_gueltig_ab < letzte then
    raise exception
      'Eine Fassung kann nicht vor der zuletzt freigegebenen in Kraft treten '
      '(zuletzt ab %).', letzte;
  end if;

  insert into verfahrensdokumentation
    (mandant_id, version, gueltig_ab, titel, inhalt_hash, storage_key,
     freigegeben_von)
  values (mandant, p_version, p_gueltig_ab, p_titel, p_inhalt_hash,
          p_storage_key, app.mein_benutzer())
  returning id into neu;

  return neu;
end;
$$;

grant execute on function app.verfahrensdoku_gueltig(uuid, date) to dms_app;
grant execute on function app.verfahrensdoku_freigeben(text, date, text, text, text)
  to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 3: Das Archivieren haelt die geltende Fassung fest
-- ---------------------------------------------------------------------------
--
-- Zwei Aenderungen an `app.dokument_archivieren`, beide sind Korrekturen.
--
-- ERSTENS faellt `p_object_lock_bis` weg. Die Funktion nahm bis hierher ein
-- Sperrdatum entgegen und schrieb es in derselben Transaktion mit -- genau
-- das, was ADR 0006 ausschliesst: Eine Compliance-Sperre fuer eine
-- zurueckgerollte Archivierung nimmt niemand mehr zurueck. Seit
-- 20260902100000 setzt der Durchgang die Sperre *nach* dem Commit; der
-- Parameter war damit ein offener Weg an dieser Regel vorbei. Kein Aufrufer
-- hat ihn je benutzt -- ein ungenutzter Weg ist trotzdem einer.
--
-- ZWEITENS faellt `p_verfahrensdoku` weg und wird abgeleitet. Eine Fassung,
-- die der Aufrufer mitgibt, ist eine Behauptung: Er koennte jede beliebige
-- Nummer eintragen. Abgeleitet ist sie ein Befund.
--
-- `drop` und nicht `create or replace`: Eine geaenderte Parameterliste legt
-- sonst eine zweite Funktion daneben, und die alte bliebe aufrufbar.
drop function if exists app.dokument_archivieren(uuid, date, text);

create function app.dokument_archivieren(p_dokument_id uuid)
returns date
language plpgsql
security definer
set search_path = public, app
as $$
declare
  hash    text;
  mandant uuid;
  frist   record;
begin
  -- Der Hash der Originaldatei ist der Nachweis. Faellt er weg, ist das
  -- Archiv eine Behauptung -- deshalb keine Archivierung ohne ihn.
  select d.inhalt_hash, d.mandant_id into hash, mandant
    from dokument d
   where d.id = p_dokument_id
     and d.mandant_id = app.mein_mandant()
     and d.status not in ('storniert');

  if hash is null then
    return null;
  end if;

  select * into frist from app.aufbewahrung_bis(p_dokument_id);

  /*
   * Die geltende Fassung wird festgehalten, nicht die heutige.
   *
   * Bei einem Beleg aus 2027 muss spaeter beantwortbar sein, nach welchem
   * Verfahren er *damals* verarbeitet wurde. Steht keine Fassung fest,
   * bleibt die Spalte leer -- sichtbar und nachholbar. Das Archivieren daran
   * scheitern zu lassen waere schlimmer: Es hielte den Betrieb wegen einer
   * Luecke in der Dokumentation an, und die Luecke bliebe trotzdem.
   */
  insert into archiv_eintrag (dokument_id, archiviert_durch, hash_sha256,
                              aufbewahrung_bis, aufbewahrungsgrund,
                              verfahrensdoku_version)
  values (p_dokument_id, app.mein_benutzer(), hash,
          frist.bis, frist.grund,
          app.verfahrensdoku_gueltig(mandant, current_date))
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

comment on function app.dokument_archivieren(uuid) is
  'Archiviert einen Beleg und haelt Hash, Frist und die geltende Fassung der '
  'Verfahrensdokumentation fest. Setzt bewusst *keine* Objektsperre -- die '
  'gehoert nach den Commit (ADR 0006).';


-- Belege, die ohne Verfahrensdokumentation archiviert wurden.
--
-- Zwei Faelle, ein Befund: Entweder gab es zum Zeitpunkt noch keine Fassung,
-- oder die Freigabe wurde vergessen. Beides ist eine Luecke im Nachweis, und
-- beides faellt sonst erst in der Pruefung auf -- also dann, wenn es sich
-- nicht mehr beheben laesst.
create or replace function app.archiv_ohne_verfahrensdoku()
returns table (
  dokument_id   uuid,
  archiviert_am date
)
language sql
stable
set search_path = public, app
as $$
  select a.dokument_id, a.archiviert_am::date
    from archiv_eintrag a
   where a.verfahrensdoku_version is null
   order by a.archiviert_am;
$$;

comment on function app.archiv_ohne_verfahrensdoku() is
  'Luecken im GoBD-Nachweis. Bewusst ohne `security definer`: Die Policy '
  'archiv_eintrag_sicht loest die Sichtbarkeit ueber ein exists auf dokument '
  'auf, und diese Unterabfrage laeuft selbst unter RLS -- wer den Beleg nicht '
  'sehen darf, sieht auch die Luecke nicht. Anders als bei '
  'app.loeschkandidaten ist das hier richtig: Eine Luecke im Nachweis fuehrt '
  'zu keiner Frist, die still verstreichen koennte.';
