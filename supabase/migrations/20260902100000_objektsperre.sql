-- ===========================================================================
-- Objektsperre: Was der Speicher selbst schuetzt (Konzept 19)
-- ===========================================================================
--
-- Die zweite Saeule der Revisionssicherheit. Die erste, die Hash-Kette,
-- steht seit 20260831200000: Sie *erkennt* eine Aenderung. Diese hier soll
-- verhindern, dass das Original dabei verlorengeht -- S3 Object Lock im
-- Compliance-Modus.
--
-- WAS OBJECT LOCK WIRKLICH ZUSAGT
--
-- Gemessen gegen MinIO, nicht angenommen. Object Lock schuetzt **Fassungen**,
-- nicht Schluessel:
--
--   * Das Ueberschreiben einer gesperrten Datei gelingt. Es entsteht eine
--     zweite Fassung.
--   * Ein gewoehnliches Lesen liefert ab dann die zweite -- den gefaelschten
--     Inhalt.
--   * Die gesperrte Fassung bleibt daneben liegen und laesst sich nicht
--     loeschen, von niemandem.
--
-- Die Sperre ist also eine Zusage ueber *Erhalt*, nicht ueber *Abweisung*.
-- Eingeloest wird sie erst durch `storage_fassung`: Ohne die festgehaltene
-- Kennung ist das Original unzerstoerbar, aber unerreichbar -- ein Schutz,
-- den niemand einloest.
--
-- WARUM ERST NACH DEM ARCHIVIEREN
--
-- Compliance kann niemand aufheben, auch der Wurzelbenutzer nicht. Eine
-- Sperre, die fuer eine zurueckgerollte Archivierung gesetzt wurde, waere
-- damit ein Fehler, den nie jemand behebt: Die Datei liegt bis zum Datum,
-- und kein Konto kann daran etwas aendern. Eine *fehlende* Sperre dagegen
-- bleibt als leere Spalte sichtbar und wird beim naechsten Durchgang
-- nachgeholt.
--
-- Deshalb ist die Reihenfolge Pflicht und keine Bequemlichkeit: erst
-- archivieren und festschreiben, dann sperren, dann vermerken.
--
-- WARUM KEIN AUFTRAG IN DER WARTESCHLANGE
--
-- Dieselbe Ueberlegung wie beim Ausgangsbuch: Der Archiveintrag entsteht in
-- der Transaktion des Archivierens. Ein zusaetzlicher pg-boss-Auftrag waere
-- ein zweites Fehlerfenster fuer dieselbe Sache -- und ein Auftrag, dessen
-- Transaktion zurueckrollte, wuerde eine Sperre fuer ein Dokument setzen,
-- das gar nicht archiviert ist. Der Archiveintrag **ist** die
-- Warteschlange: `storage_object_lock_bis is null` heisst offen. Damit ist
-- der Wiederholversuch beilaeufig richtig, und Belege, die vor der
-- Einrichtung von S3 archiviert wurden, holt derselbe Durchgang nach.


-- ---------------------------------------------------------------------------
-- Teil 1: Die Fassung
-- ---------------------------------------------------------------------------

alter table archiv_eintrag add column storage_fassung text;

comment on column archiv_eintrag.storage_fassung is
  'Kennung der gesperrten Fassung im Objektspeicher (S3 VersionId). Ohne sie '
  'waere die Sperre wertlos: Object Lock schuetzt Fassungen, nicht '
  'Schluessel -- ein Ueberschreiben gelingt und legt eine zweite Fassung '
  'darueber, und ein gewoehnliches Lesen liefert ab dann diese. Erst mit der '
  'Kennung kommt man wieder an die archivierten Bytes. Bleibt leer bei der '
  'Dateisystem-Ablage der Entwicklung, so wie storage_object_lock_bis.';


-- ---------------------------------------------------------------------------
-- Teil 2: Der Schutz -- einmal setzbar, nie aenderbar
-- ---------------------------------------------------------------------------
--
-- Bisher waren beide Spalten wie alles andere am Eintrag festgeschrieben.
-- Das ging nicht auf: Gesetzt werden koennen sie erst *nach* dem Commit des
-- Archivierens (siehe oben), also zwangslaeufig durch ein spaeteres UPDATE.
--
-- Deshalb nicht "aenderbar", sondern **einmal setzbar**: null -> Wert ja,
-- Wert -> anderer Wert nein. Das ist genau die Zusage des Compliance-Modus,
-- und sie gehoert in die Datenbank gespiegelt. Waeren sie frei aenderbar,
-- koennte jemand ein Sperrdatum eintragen, das im Speicher nie gesetzt
-- wurde -- ein Schutz auf dem Papier ist schlimmer als keiner.
--
-- Verlaengern der Frist bleibt hier bewusst aussen vor. Es waere fachlich
-- zulaessig (S3 laesst es zu), aber es gibt heute keinen Anlass dafuer: Die
-- Frist kommt aus `aufbewahrung_bis` und ist ein Stammdatum. Wer sie
-- verlaengern will, aendert das Stammdatum -- und braucht dann eine eigene
-- Funktion, die auch im Speicher nachzieht. Eine halbe Loesung waere hier
-- schlimmer als gar keine.
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
      new.verfahrensdoku_version)
     is distinct from
     (old.dokument_id, old.archiviert_am, old.hash_sha256,
      old.aufbewahrung_bis, old.aufbewahrungsgrund,
      old.verfahrensdoku_version) then
    raise exception
      'Am Archiveintrag laesst sich nur die Loeschsperre aendern. Die '
      'Aufbewahrungsfrist ist eine Pflicht, keine Einstellung.';
  end if;

  -- Einmal setzbar: Was der Speicher zugesagt hat, wird hier festgehalten und
  -- danach nicht mehr angefasst. Ein zweiter Versuch mit anderem Wert ist
  -- ein Fehler und kein stiller Ueberschreiber.
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
-- Teil 3: Was noch offen ist
-- ---------------------------------------------------------------------------
--
-- `security definer` mit handgeschriebenem Filter, aus demselben Grund wie
-- `app.loeschkandidaten`: Der Worker laeuft ohne Benutzer und ohne Mandant.
-- Eine Sperre, die ausbleibt, weil der Aufrufer das Dokument nicht sehen
-- darf, waere still -- und still ist hier das Schlimmste, was passieren kann.
--
-- Bewusst ueber alle Mandanten: Der Objektspeicher ist einer, der Worker ist
-- einer, und die Aufbewahrungspflicht kennt keine Mandantengrenze. Personen-
-- bezogene Daten gibt die Funktion nicht heraus -- nur Kennungen, den
-- Ablageschluessel und ein Datum.
create or replace function app.objektsperre_offen(p_grenze integer default 200)
returns table (
  dokument_id      uuid,
  storage_key      text,
  aufbewahrung_bis date
)
language sql
stable
security definer
set search_path = public, app
as $$
  select a.dokument_id, f.storage_key, a.aufbewahrung_bis
    from archiv_eintrag a
    join dokument_datei f
      on f.dokument_id = a.dokument_id
     and f.variante = 'original'
   where a.storage_object_lock_bis is null
   order by a.archiviert_am
   limit p_grenze;
$$;

comment on function app.objektsperre_offen(integer) is
  'Archivierte Belege, deren Datei im Objektspeicher noch nicht gesperrt ist. '
  'Der Archiveintrag ist die Warteschlange -- kein eigener Auftrag, weil der '
  'ein zweites Fehlerfenster fuer dieselbe Sache waere. Holt damit auch '
  'nach, was vor der Einrichtung des Speichers archiviert wurde.';


-- Was der Speicher zugesagt hat, wird hier festgehalten -- nicht mehr.
--
-- Die Datenbank kann Object Lock nicht durchsetzen und behauptet es auch
-- nicht. Sie schreibt nur mit, was tatsaechlich gesetzt wurde, und zwar
-- **nachdem** es gesetzt wurde. Andersherum -- erst vermerken, dann sperren --
-- entstuende bei einem Abbruch dazwischen ein Eintrag ueber einen Schutz, den
-- es nicht gibt.
create or replace function app.objektsperre_vermerken(
  p_dokument_id uuid,
  p_bis         date,
  p_fassung     text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if p_bis is null then
    raise exception 'Eine Objektsperre ohne Datum ist keine.';
  end if;

  update archiv_eintrag
     set storage_object_lock_bis = p_bis,
         storage_fassung         = p_fassung
   where dokument_id = p_dokument_id
     and storage_object_lock_bis is null;

  return found;
end;
$$;

comment on function app.objektsperre_vermerken(uuid, date, text) is
  'Haelt fest, dass der Objektspeicher die Datei sperrt -- aufzurufen erst, '
  'nachdem er es getan hat. Nur einmal wirksam; ein zweiter Aufruf trifft '
  'keine Zeile mehr und meldet false.';


-- ---------------------------------------------------------------------------
-- Teil 4: Auch die externe Einsicht liefert die archivierte Fassung
-- ---------------------------------------------------------------------------
--
-- Die Einsicht ist der Weg nach draussen -- an Beiraete, Eigentuemer,
-- Versicherer. Ausgerechnet hier eine Datei herauszugeben, die jemand ueber
-- den archivierten Beleg gelegt hat, waere die schlechteste aller Stellen.
--
-- Neue Rueckgabespalte, deshalb `drop` und nicht `create or replace`: PostgreSQL
-- laesst den Rueckgabetyp einer Funktion nicht aendern. Das `grant` muss
-- danach neu gesetzt werden, sonst laeuft `dms_app` in ein Rechteproblem --
-- und zwar erst beim ersten Aufruf von draussen.
drop function if exists app.einsicht_datei(uuid, uuid, text, integer);

create function app.einsicht_datei(
  p_gewaehrung_id uuid,
  p_dokument_id   uuid,
  p_variante      text,
  p_seite         integer default null
)
returns table (storage_key text, mime text, storage_fassung text)
language sql
stable
security definer
set search_path = public, app
as $$
  select f.storage_key, f.mime, a.storage_fassung
    from dokument_datei f
    -- Linker Join: Ein nicht archivierter Beleg hat keine Fassung und
    -- bekommt trotzdem seine Datei.
    left join archiv_eintrag a on a.dokument_id = f.dokument_id
   where f.dokument_id = p_dokument_id
     and f.variante = p_variante
     and (p_seite is null or f.seite = p_seite)
     and app.einsicht_darf_beleg(p_gewaehrung_id, p_dokument_id)
   -- Bei mehreren Treffern je Seite (Leseansicht und Miniatur liegen beide
   -- als `ansicht_webp` mit seite = 1) gewinnt die Leseansicht.
   order by f.storage_key like '%miniatur%', f.storage_key
   limit 1;
$$;

grant execute on function app.einsicht_datei(uuid, uuid, text, integer) to dms_app;
