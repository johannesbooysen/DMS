-- ===========================================================================
-- Schriftverkehr als zweite Belegart (Konzept 24, Punkt 3)
-- ===========================================================================
--
-- CLAUDE.md behauptet seit dem ersten Tag einen generischen Dokumentenkern:
-- "dokument traegt alles Gemeinsame, fachliche Daten liegen in
-- Satellitentabellen. Kein zweites Modul fuer Schriftverkehr -- ein
-- Posteingang, ein Rechtemodell, ein Audit-Log."
--
-- Diese Behauptung war bis hierher **ungeprueft**: Es gab genau eine
-- Belegart. Die zweite ist der Test dafuer, und sie hat ein Loch gefunden.
--
-- WAS SICH ALS TRAGFAEHIG ERWIESEN HAT
--
-- Mehr, als zu erwarten war. `dokument.belegart` kennt 'schriftverkehr'
-- bereits, die Engine waehlt die Prozessdefinition ohnehin ueber
-- `p.belegart = d.belegart`, saemtliche Verknuepfungen auf `rechnung_fakten`
-- sind `left join`, und `app.aufbewahrung_bis` liest die Frist ueber
-- `aufbewahrungsfrist.belegart`. Die Stufenfolge fuer Schriftverkehr ist
-- damit tatsaechlich reine Konfiguration -- kein Codepfad kennt sie.
--
-- WAS NICHT TRUG
--
-- `app.freigabe_hash` verband **inner join** auf `rechnung_fakten`. Fuer
-- einen Beleg ohne Rechnungsdaten lieferte die Funktion damit `null`, und
-- das ist kein leeres Ergebnis, sondern ein falsches: Ein Freigabestempel
-- traegt dann einen leeren Hash und ist an **nichts** gebunden. Man haette
-- den Beleg einem anderen Objekt zuordnen koennen, ohne dass eine Freigabe
-- verfaellt -- genau die Zusicherung, um derentwillen es den Hash gibt.
--
-- Gefunden nicht durch Lesen, sondern durch Ausprobieren: ein Schriftstueck
-- angelegt und die Funktion gefragt. Sie sagte `null`.


-- ---------------------------------------------------------------------------
-- Teil 1: Die Faktentabelle
-- ---------------------------------------------------------------------------
--
-- 1:1 zum Dokument, wie `rechnung_fakten`. Was hier steht, ist das, was ein
-- Schriftstueck von einer Rechnung unterscheidet -- und nur das: Wer
-- geschrieben hat, worum es geht, und bis wann geantwortet sein muss.
--
-- Kein Betrag, keine Kontierung, kein Zahlungsweg. Ein Schriftstueck wird
-- nicht gezahlt; die Stufenfolge dafuer hat gar keine Zahlungsstufe, und
-- deshalb kommt es nie in die Naehe von `app.zahlung_moeglich`.

create table schriftverkehr_fakten (
  dokument_id     uuid primary key references dokument(id) on delete cascade,

  -- Eingehend oder ausgehend. Die Unterscheidung traegt mehr als sie
  -- aussieht: Ein eingehendes Schreiben braucht eine Antwort, ein
  -- ausgehendes ist eine. Danach richtet sich, ob eine Frist ueberhaupt
  -- sinnvoll ist.
  richtung        text not null check (richtung in ('eingehend','ausgehend')),

  -- Der Korrespondent als Text und nicht nur als Fremdschluessel:
  -- Schriftverkehr kommt auch von Aemtern, Gerichten, Versicherungen und
  -- Nachbarn -- also von Beteiligten, fuer die es keinen Stammsatz gibt und
  -- geben soll. Wo es einen gibt, steht er zusaetzlich in `kreditor_id`;
  -- ein leeres Feld dort heisst nicht "unbekannt", sondern "kein Stammsatz
  -- noetig".
  korrespondent   text,
  kreditor_id     uuid references kreditor(id),

  betreff         text,
  schreiben_datum date,

  -- Bis wann geantwortet sein muss. Fachlich das wichtigste Feld dieser
  -- Tabelle: Eine versaeumte Frist im Schriftverkehr kostet mehr als ein
  -- verfallenes Skonto, und sie faellt niemandem von selbst auf.
  frist_am        date,

  aktenzeichen    text
);

create index on schriftverkehr_fakten (frist_am) where frist_am is not null;
create index on schriftverkehr_fakten (kreditor_id);

comment on table schriftverkehr_fakten is
  'Fachliche Daten zu einem Schriftstueck -- die zweite Belegart neben der '
  'Rechnung (Konzept 24.3). 1:1 zum Dokument, wie rechnung_fakten. Kein '
  'Betrag und keine Kontierung: Ein Schriftstueck wird nicht gezahlt.';

comment on column schriftverkehr_fakten.korrespondent is
  'Wer geschrieben hat, als Text. Schriftverkehr kommt auch von Aemtern, '
  'Gerichten und Nachbarn -- Beteiligte, fuer die es keinen Stammsatz gibt '
  'und geben soll. Ein Fremdschluessel allein zwaenge dazu, fuer jeden '
  'Absender einen Kreditor anzulegen -- und der Kreditorenstamm waere nach '
  'einem Jahr unbrauchbar.';

comment on column schriftverkehr_fakten.frist_am is
  'Bis wann geantwortet sein muss. Eine versaeumte Frist im Schriftverkehr '
  'kostet mehr als ein verfallenes Skonto -- und faellt niemandem von '
  'selbst auf.';

alter table schriftverkehr_fakten enable row level security;

-- Dieselbe Policy wie bei rechnung_fakten: Sichtbarkeit erbt sich vom
-- Dokument. Das `exists` laeuft selbst unter RLS -- wer den Beleg nicht
-- sieht, sieht auch seine Fakten nicht.
create policy schriftverkehr_fakten_sicht on schriftverkehr_fakten for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

-- Nach der Archivierung fest, wie die Rechnungsdaten. Aenderung nur ueber
-- Storno und Neuerfassung.
create trigger schriftverkehr_fakten_archiv_schutz
  before insert or update or delete on schriftverkehr_fakten
  for each row execute function app.archiv_satellit_schutz();

grant select, insert, update, delete on schriftverkehr_fakten to dms_app;


-- ---------------------------------------------------------------------------
-- Teil 2: Der Freigabe-Hash bindet jetzt jede Belegart
-- ---------------------------------------------------------------------------
--
-- DAS GEFUNDENE LOCH
--
-- Bisher `join rechnung_fakten` -- ein innerer Verbund. Ein Beleg ohne
-- Rechnungsdaten bekam damit `null`, der Stempel einen leeren Hash, und
-- `app.freigaben_nachpruefen` verglich null gegen null und fand nichts.
-- Ergebnis: Freigaben, die nichts festhalten.
--
-- WARUM DIE FORMEL TROTZDEM DIESELBE BLEIBT
--
-- Ein geaenderter Hash haette **jede bestehende Freigabe im System
-- entwertet** -- die Engine haette bei der naechsten Nachpruefung je Stempel
-- ein Ereignis `verfallen` geschrieben und alle laufenden Belege auf die
-- erste Stufe zurueckgeworfen. Das waere eine Migration, die den Betrieb
-- anhaelt, und zwar wegen einer Verbesserung.
--
-- Deshalb zwei Regeln, die zusammen dafuer sorgen, dass sich fuer eine
-- Rechnung **nichts** aendert:
--
--   1. Aus `join` wird `left join`. Fuer eine Rechnung greift der Verbund
--      wie bisher -- gleiche Werte, gleicher Hash.
--   2. Die neuen Felder werden **hinten angehaengt**. Fuer eine Rechnung
--      sind sie null, `coalesce(..., '')` macht daraus den leeren String,
--      und ein angehaengter leerer String aendert die Zeichenkette nicht.
--
-- Dass das wirklich so ist und nicht nur so aussieht, prueft ein Test --
-- eine Zusicherung dieser Groesse gehoert nicht auf eine Ueberlegung
-- gestuetzt.
create or replace function app.freigabe_hash(p_dokument_id uuid)
returns text
language sql
stable
set search_path = public, app
as $$
  select encode(sha256(convert_to(
      coalesce(f.kreditor_id::text, '')
      || coalesce(f.rechnungsnummer, '')
      || coalesce(f.rechnungsdatum::text, '')
      || coalesce(f.brutto::text, '')
      || coalesce(d.objekt_id::text, '')
      -- Ab hier neu. Fuer eine Rechnung sind alle drei null und die
      -- Zeichenkette bleibt unveraendert.
      || coalesce(s.korrespondent, '')
      || coalesce(s.betreff, '')
      || coalesce(s.frist_am::text, ''),
    'UTF8')), 'hex')
    from dokument d
    left join rechnung_fakten f on f.dokument_id = d.id
    left join schriftverkehr_fakten s on s.dokument_id = d.id
   where d.id = p_dokument_id;
$$;

comment on function app.freigabe_hash(uuid) is
  'Bindet die Stempel an den Datenstand. Aendert sich ein freigaberelevantes '
  'Feld, verfallen die Stempel (Konzept 8.4). Gilt fuer jede Belegart: Der '
  'Verbund auf die Satellitentabellen ist ein left join, sonst bekaeme ein '
  'Beleg ohne Rechnungsdaten null -- und ein Stempel mit leerem Hash haelt '
  'nichts fest. Bewusst OHNE die Kontierung: die liegt nach den Freigaben '
  'und wuerde sie sonst jedes Mal entwerten -- dafuer gibt es den '
  'getrennten kontierungs_hash.';


-- ---------------------------------------------------------------------------
-- Teil 3: Was bewusst NICHT geaendert wurde
-- ---------------------------------------------------------------------------
--
-- `app.kontierung_summe_stimmt` liest aus `rechnung_fakten` und liefert fuer
-- einen Beleg ohne Rechnungsdaten keine Zeile, also `null`. In
-- `app.zahlung_moeglich` wird daraus ueber `coalesce(..., false)` ein Nein.
--
-- Im Ergebnis richtig -- ein Schriftstueck wird nicht gezahlt --, in der
-- Begruendung schief: Es hiesse "Die Kontierung ergibt nicht den
-- Rechnungsbetrag", und das schickt jemanden in die Kontierungsmaske eines
-- Belegs, der gar keinen Betrag hat.
--
-- Trotzdem bleibt beides unveraendert, aus zwei Gruenden:
--
--   * Die Meldung ist praktisch unerreichbar. `app.zahlung_moeglich` wird
--     nur an einer Zahlungsstufe gefragt, und die Stufenfolge fuer
--     Schriftverkehr hat keine.
--   * `kontierung_summe_stimmt` traegt eine der harten Regeln. An denen
--     wird nicht wegen einer Formulierung gedreht.
--
-- Eine Hilfsfunktion fuer eine bessere Meldung stand hier schon und ist
-- wieder entfernt worden: Sie haette niemand aufgerufen. Festgehalten wird
-- das Verhalten stattdessen in einem Test -- damit es eine Entscheidung
-- bleibt und nicht zu einem Zufall wird, den beim naechsten Mal jemand
-- "repariert".
