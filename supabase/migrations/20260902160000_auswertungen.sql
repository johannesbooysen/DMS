-- ===========================================================================
-- Auswertungen (Konzept 24, Punkt 11)
-- ===========================================================================
--
-- Drei Zahlen, die im Betrieb fehlen. Ohne sie merkt niemand, dass ein Beleg
-- seit fuenf Wochen in einer Stufe steht -- man sieht ihn nur nicht, weil er
-- in einem fremden Postfach liegt.
--
--   1. Durchlaufzeiten je Stufe -- wo bleibt die Arbeit liegen
--   2. Verlorene Skonti        -- was das gekostet hat, in Euro
--   3. Aelteste offene Belege  -- welcher Einzelfall am laengsten wartet
--
-- WARUM KEIN `security definer`
--
-- Anders als `app.loeschkandidaten` oder `app.objektsperre_offen` laufen
-- diese Funktionen unter den Rechten des Fragenden. Das ist hier richtig und
-- kein Versehen: Eine Auswertung ist eine Sicht auf Belege, und wer einen
-- Beleg nicht sehen darf, darf ihn auch nicht in einer Summe wiederfinden.
-- Aus einer Kennzahl laesst sich zurueckrechnen -- bei einem Objekt mit drei
-- Rechnungen im Monat ist "Summe der verlorenen Skonti" fast schon der
-- Einzelbetrag.
--
-- Die RLS erledigt damit auch den Mandantenfilter, und zwar an genau einer
-- Stelle statt in drei Abfragen (Projektregel: keine Datenabfrage ohne
-- Mandantenfilter).
--
-- MESSUNG (250.000 Ereignisse, 50.000 Belege, 5 Stufen)
--
-- Die Fensterfunktion ueber `stempel_ereignis` ist die teure Stelle. Sie
-- muss ueber *alle* Ereignisse des Zeitraums laufen, auch ueber die, die
-- nachher wegfallen -- `lag()` braucht den Vorgaenger, gleich welcher
-- Entscheidung. Eingrenzen laesst sich nur der Zeitraum.
--
--   ohne Zeitraum   665 ms  (temp written=3800 -- der Sortierlauf geht
--                            auf die Platte)
--   90 Tage         188 ms
--
-- Deshalb sind 90 Tage die **Vorgabe** und nicht "alles". Ein Bericht ueber
-- die gesamte Geschichte ist selten das, was jemand wissen will, und es ist
-- die Abfrage, die den Server anhaelt. `null` bleibt zulaessig fuer den, der
-- es ausdruecklich will -- er zahlt es dann auch.
--
-- Ein Index auf `stempel_ereignis (zeitpunkt)` wurde geprueft und
-- **verworfen**: 90 Tage 199 -> 187 ms (im Rauschen), voller Zeitraum
-- 665 -> 742 ms, also schlechter. Derselbe Befund wie beim Index auf
-- `eingang_am` in Konzept 21 -- ein zusaetzlicher Index kann schaden.


-- ---------------------------------------------------------------------------
-- Teil 1: Durchlaufzeiten je Stufe
-- ---------------------------------------------------------------------------
--
-- WAS GEMESSEN WIRD
--
-- Die Zeit vom Eintritt in eine Stufe bis zu dem Stempel, der sie beendet.
-- Der Eintritt ist der Zeitpunkt des vorhergehenden Ereignisses desselben
-- Laufs; beim ersten Stempel ist es der Start des Laufs.
--
-- Gezaehlt werden nur **beendende** Entscheidungen: `freigabe`, `ablehnung`
-- und `uebersprungen`. Bewusst nicht:
--
--   * `klaerung` und `rueckgabe` -- sie beenden die Stufe nicht, sondern
--     halten sie an. Die Wartezeit laeuft weiter und erscheint beim
--     naechsten beendenden Stempel; das ist richtig so, denn die Zeit ist
--     ja vergangen.
--   * `verfallen` -- kein Mensch hat gehandelt. Diese Ereignisse schreibt
--     die Engine, wenn ein Freigabe-Hash bricht. Sie mitzuzaehlen ergaebe
--     Durchlaufzeiten von Sekunden und beschoenigte den Schnitt.
--
-- Der Median steht neben dem Mittel, und er ist die wichtigere Zahl: Ein
-- einzelner Beleg, der ueber den Jahreswechsel liegen blieb, zieht das
-- Mittel so weit hoch, dass die Auswertung unbrauchbar wird. Wer nur eines
-- von beiden zeigt, zeigt das falsche.
create or replace function app.durchlaufzeiten(
  -- Vorgabe 90 Tage, nicht "alles" -- siehe Messung im Kopf. Wer `null`
  -- uebergibt, bekommt die gesamte Geschichte und die volle Laufzeit.
  p_von date default (current_date - 90),
  p_bis date default null
)
returns table (
  stufe_id      uuid,
  bezeichnung   text,
  stufentyp     text,
  anzahl        bigint,
  mittel_stunden numeric,
  median_stunden numeric,
  p90_stunden    numeric
)
language sql
stable
set search_path = public, app
as $$
  with ereignis as (
    select e.stufe_id,
           e.entscheidung,
           e.zeitpunkt,
           -- Der Eintritt in die Stufe: das vorhergehende Ereignis desselben
           -- Laufs, sonst der Start. `folge` und nicht `zeitpunkt` als
           -- Ordnung -- zwei Stempel in derselben Sekunde kaemen sonst in
           -- beliebiger Reihenfolge, und die Differenz waere negativ.
           coalesce(
             lag(e.zeitpunkt) over (partition by e.lauf_id order by e.folge),
             l.gestartet_am
           ) as eintritt
      from stempel_ereignis e
      join dokument_lauf l on l.id = e.lauf_id
     where (p_von is null or e.zeitpunkt >= p_von::timestamptz)
       and (p_bis is null or e.zeitpunkt < (p_bis + 1)::timestamptz)
  )
  select s.id,
         s.bezeichnung,
         s.stufentyp,
         count(*) as anzahl,
         round(avg(extract(epoch from (e.zeitpunkt - e.eintritt)) / 3600)::numeric, 1),
         round(
           (percentile_cont(0.5) within group (
              order by extract(epoch from (e.zeitpunkt - e.eintritt)) / 3600
            ))::numeric, 1),
         round(
           (percentile_cont(0.9) within group (
              order by extract(epoch from (e.zeitpunkt - e.eintritt)) / 3600
            ))::numeric, 1)
    from ereignis e
    join prozessstufe s on s.id = e.stufe_id
   where e.entscheidung in ('freigabe','ablehnung','uebersprungen')
   group by s.id, s.bezeichnung, s.stufentyp, s.reihenfolge
   order by s.reihenfolge;
$$;

comment on function app.durchlaufzeiten(date, date) is
  'Wie lange eine Stufe dauert -- Mittel, Median und 90. Perzentil in '
  'Stunden. Gezaehlt werden nur beendende Entscheidungen; klaerung und '
  'rueckgabe halten die Stufe an, statt sie zu beenden, und verfallen '
  'schreibt die Engine ohne menschliches Zutun. Der Median ist die '
  'wichtigere Zahl: Ein Beleg ueber dem Jahreswechsel verzerrt das Mittel.';


-- ---------------------------------------------------------------------------
-- Teil 2: Verlorene Skonti
-- ---------------------------------------------------------------------------
--
-- Die einzige Auswertung mit einem Betrag daran, und deshalb die, die
-- gelesen wird.
--
-- Verloren ist ein Skonto in zwei Lagen, und sie gehoeren getrennt:
--
--   * `zu_spaet`  -- gezahlt wurde, aber nach Ablauf der Skontofrist. Das
--                    Geld ist weg.
--   * `verfallen` -- die Frist ist vorbei und es ist noch nicht gezahlt.
--                    Das Geld ist auch weg, aber der Beleg liegt noch
--                    irgendwo -- hier ist noch etwas zu retten, naemlich
--                    beim naechsten.
--
-- In einer Spalte zusammengefasst waere die Zahl groesser und die Auskunft
-- kleiner: Man wuesste nicht mehr, ob das Haus zu langsam zahlt oder zu
-- langsam freigibt.
--
-- Der Betrag ist `brutto * skonto_prozent / 100`. Auf zwei Stellen gerundet
-- und nicht abgeschnitten -- es ist Geld.
-- Zwei Funktionen und nicht eine: die Einzelfaelle und die Summe.
--
-- Gemessen ergab der Zeitraum eines Jahres 7.918 Zeilen. Wer die alle an
-- eine Seite gibt, hat keine Auswertung gebaut, sondern einen Datenauszug --
-- und die Frage "was hat uns das gekostet" beantwortet er damit nicht; sie
-- stuende dann in der Summenzeile eines Tabellenprogramms.
--
-- Deshalb liefert `app.skonto_verluste` die groessten Einzelfaelle und
-- `app.skonto_summe` weiter unten die Zahl. Das `limit` steht **in** der
-- Funktion, sonst baut der Planer erst alle Treffer auf und wirft danach
-- weg (Konzept 21).
create or replace function app.skonto_verluste(
  p_von    date default null,
  p_bis    date default null,
  -- `null` heisst alle -- das braucht die Summenfunktion. Eine Oberflaeche
  -- gibt eine Zahl mit.
  p_grenze integer default 50
)
returns table (
  dokument_id     uuid,
  objekt_id       uuid,
  kreditor        text,
  rechnungsnummer text,
  brutto          numeric,
  skonto_prozent  numeric,
  skonto_bis      date,
  gezahlt_am      date,
  lage            text,
  verlust         numeric
)
language sql
stable
set search_path = public, app
as $$
  select d.id,
         d.objekt_id,
         k.name,
         rf.rechnungsnummer,
         rf.brutto,
         rf.skonto_prozent,
         rf.skonto_bis,
         -- Als Datum und nicht als timestamptz: pg macht aus einem `date`
         -- ohnehin ein Date-Objekt in Serverzeitzone; die Anwendung liest
         -- es ueber to_char (Projektregel).
         max(z.uebergeben_am)::date as gezahlt_am,
         case when max(z.uebergeben_am) is not null then 'zu_spaet'
              else 'verfallen' end,
         round(rf.brutto * rf.skonto_prozent / 100, 2)
    from dokument d
    join rechnung_fakten rf on rf.dokument_id = d.id
    left join kreditor k on k.id = rf.kreditor_id
    left join zahlung z on z.dokument_id = d.id and z.uebergeben_am is not null
   where rf.skonto_bis is not null
     and rf.skonto_prozent is not null
     and rf.skonto_prozent > 0
     and rf.brutto is not null
     -- Stornierte Belege zaehlen nicht: Ein Skonto auf eine Rechnung, die
     -- es nicht mehr gibt, ist kein Verlust.
     and d.status <> 'storniert'
     and (p_von is null or rf.skonto_bis >= p_von)
     and (p_bis is null or rf.skonto_bis <= p_bis)
   group by d.id, d.objekt_id, k.name, rf.rechnungsnummer, rf.brutto,
            rf.skonto_prozent, rf.skonto_bis
  having (max(z.uebergeben_am) is not null
          and max(z.uebergeben_am)::date > rf.skonto_bis)
      or (max(z.uebergeben_am) is null and rf.skonto_bis < current_date)
   order by round(rf.brutto * rf.skonto_prozent / 100, 2) desc
   limit p_grenze;
$$;

-- Die Summe steht **nach** den Einzelfaellen, weil sie darauf aufsetzt.
-- Sie ruft dieselbe Funktion ohne Grenze auf -- eine zweite Abfrage mit
-- denselben Bedingungen waere eine zweite Gelegenheit, sie auseinander-
-- laufen zu lassen: Wer die Definition von "verloren" einmal aendert, muss
-- sie sonst an zwei Stellen aendern, und die Summe passte dann nicht mehr
-- zu den Zeilen darunter.
create or replace function app.skonto_summe(
  p_von date default null,
  p_bis date default null
)
returns table (
  lage    text,
  anzahl  bigint,
  verlust numeric
)
language sql
stable
set search_path = public, app
as $$
  select v.lage, count(*), sum(v.verlust)
    from app.skonto_verluste(p_von, p_bis, null) v
   group by v.lage
   order by v.lage;
$$;

comment on function app.skonto_summe(date, date) is
  'Was verfallene Skonti gekostet haben, getrennt nach zu spaet gezahlt und '
  'gar nicht gezahlt. Die Zahl, nach der gefragt wird -- die Einzelfaelle '
  'dazu liefert app.skonto_verluste, und zwar aus derselben Definition.';


comment on function app.skonto_verluste(date, date, integer) is
  'Skonti, die verfallen sind -- getrennt nach zu spaet gezahlt und noch '
  'gar nicht gezahlt. Zusammengefasst waere die Zahl groesser und die '
  'Auskunft kleiner: Man wuesste nicht, ob zu langsam gezahlt oder zu '
  'langsam freigegeben wird.';


-- ---------------------------------------------------------------------------
-- Teil 3: Aelteste offene Belege
-- ---------------------------------------------------------------------------
--
-- Gerechnet ab `eingang_am` und nicht ab dem Start des Laufs. Das ist der
-- Tag, an dem das Haus den Beleg bekommen hat -- und danach fragt der
-- Lieferant, wenn er anruft. Die beiden liegen normalerweise Sekunden
-- auseinander; bei einem Beleg aus einer Altuebernahme oder aus einem
-- Stapel, der Tage in der Pruefung lag, nicht.
--
-- `limit` innerhalb der Funktion, nicht beim Aufrufer: Sonst baut der
-- Planer erst alle offenen Belege auf und wirft danach weg (Konzept 21).
create or replace function app.aelteste_offene(p_grenze integer default 25)
returns table (
  dokument_id  uuid,
  objekt_id    uuid,
  kreditor     text,
  rechnungsnummer text,
  brutto       numeric,
  eingang_am   timestamptz,
  tage         integer,
  stufe        text,
  lauf_status  text
)
language sql
stable
set search_path = public, app
as $$
  select d.id,
         d.objekt_id,
         k.name,
         rf.rechnungsnummer,
         rf.brutto,
         d.eingang_am,
         (current_date - d.eingang_am::date)::integer,
         s.bezeichnung,
         l.status
    from dokument_lauf l
    join dokument d on d.id = l.dokument_id
    left join prozessstufe s on s.id = l.aktuelle_stufe_id
    left join rechnung_fakten rf on rf.dokument_id = d.id
    left join kreditor k on k.id = rf.kreditor_id
   -- `klaerung` gehoert dazu: Ein Beleg in Klaerung ist nicht erledigt, er
   -- ist nur woanders. Wer ihn hier ausblendet, verliert genau die Faelle,
   -- die am laengsten liegen.
   where l.status in ('laufend','klaerung')
   order by d.eingang_am
   limit p_grenze;
$$;

comment on function app.aelteste_offene(integer) is
  'Die aeltesten noch laufenden Belege, gerechnet ab Eingang im Haus -- '
  'nicht ab Start des Laufs, denn danach fragt der Lieferant. Klaerung '
  'zaehlt als offen: Der Beleg ist nicht erledigt, er ist nur woanders.';


grant execute on function app.durchlaufzeiten(date, date) to dms_app;
grant execute on function app.skonto_summe(date, date) to dms_app;
grant execute on function app.skonto_verluste(date, date, integer) to dms_app;
grant execute on function app.aelteste_offene(integer) to dms_app;
