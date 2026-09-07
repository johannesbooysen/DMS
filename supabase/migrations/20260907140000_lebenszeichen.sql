-- ===========================================================================
-- Lebenszeichen der Dienste (Betriebsumgebung, ADR 0007)
-- ===========================================================================
--
-- WARUM DIESE TABELLE UEBERHAUPT NOETIG IST
--
-- Am Worker haengen nicht nur die Warteschlangen, sondern drei Durchgaenge,
-- die sonst niemand ausfuehrt: die Objektsperre, das Abraeumen geloeschter
-- Dateien und die taegliche Sammelmail (siehe `src/worker/index.ts`).
--
-- Stirbt er, hoert das System **still** auf zu sperren, zu loeschen und zu
-- benachrichtigen. Die Oberflaeche sieht dabei voellig normal aus: Belege
-- kommen herein, Stempel werden gesetzt, Listen laden. Auffallen wuerde es
-- erst, wenn jemand nach einer Objektsperre sucht, die nie gesetzt wurde --
-- also im Pruefungsfall.
--
-- Ein Gesundheitsendpunkt, der nur die Anwendung prueft, wuerde bei einem
-- toten Worker **gruen** melden. Das waere schlechter als kein Endpunkt,
-- weil es Entwarnung gibt, wo keine ist -- dieselbe Regel wie bei
-- `sicherung:pruefen`: Eine Pruefung, die nichts vorfindet, gibt keine
-- Entwarnung.
--
-- WARUM DIE ANWENDUNG IHR EIGENES LEBENSZEICHEN NICHT SCHREIBT
--
-- Nur der Worker traegt hier ein. Wuerde der Webprozess seinen eigenen
-- Eintrag schreiben und ihn anschliessend selbst pruefen, bestaetigte er
-- sich selbst -- er antwortet ja bereits, sonst waere die Frage nicht
-- angekommen. Der Wert der Tabelle liegt genau darin, ueber einen **anderen**
-- Prozess Auskunft zu geben.
--
-- WAS EIN LEBENSZEICHEN BEWEIST -- UND WAS NICHT
--
-- Es beweist: Der Prozess laeuft, und seine Ereignisschleife kommt zum Zug.
-- Es beweist **nicht**, dass jede einzelne Aufgabe gelingt -- ein Durchgang
-- kann scheitern, waehrend der Takt weiterlaeuft. Dafuer gibt es die
-- fachlichen Sichten (`app.aufbereitung_haengt`, `verarbeitungsfehler`,
-- `app.objektsperre_offen`). Beides zusammen, nicht eines statt des anderen.

-- ---------------------------------------------------------------------------
-- Die Tabelle
-- ---------------------------------------------------------------------------
--
-- **Ohne `mandant_id`, und das ist hier richtig.** Sie traegt keine
-- fachlichen Daten, sondern eine Aussage ueber einen Betriebssystemprozess.
-- Ein Mandantenfilter waere nicht nur ueberfluessig, er waere falsch: Der
-- Worker bedient alle Mandanten, und ein Lebenszeichen "je Mandant" gaebe es
-- gar nicht. Die Projektregel "keine Abfrage ohne Mandantenfilter" gilt
-- Daten mit Mandantenbezug; diese Tabelle hat keinen -- deshalb steht es hier
-- ausdruecklich, statt stillschweigend ueberlesen zu werden.
--
-- Es sind **keine personenbezogenen Daten**: ein Dienstname, ein Zeitpunkt,
-- eine Programmfassung. Deshalb darf der Endpunkt ohne Anmeldung antworten.

create table betrieb_lebenszeichen (
  dienst     text primary key,
  zeitpunkt  timestamptz not null default now(),
  fassung    text
);

comment on table betrieb_lebenszeichen is
  'Letztes Lebenszeichen je Hintergrunddienst. Betriebsdaten, kein '
  'Mandantenbezug, keine personenbezogenen Daten.';

alter table betrieb_lebenszeichen enable row level security;

-- Lesen darf jeder Angemeldete: Es steht nichts darin, was jemand nicht
-- wissen duerfte, und die Aussage ist fuer alle dieselbe.
create policy betrieb_lebenszeichen_lesen on betrieb_lebenszeichen
  for select using (true);

-- **Geschrieben wird nur ueber die Funktion.** Ohne Schreibpolicy laeuft
-- jedes direkte `insert`/`update` unter `dms_app` ins Leere -- eine Policy
-- weist nicht ab, sie laesst die Zeile verschwinden. Genau deshalb gibt es
-- hier keine: Ein zweiter Weg, ein Lebenszeichen zu setzen, waere ein Weg,
-- eines vorzutaeuschen.
grant select on betrieb_lebenszeichen to dms_app;


-- ---------------------------------------------------------------------------
-- Setzen
-- ---------------------------------------------------------------------------
--
-- `security definer`, weil der Worker keinen angemeldeten Benutzer hat -- und
-- weil das der einzige Weg an der fehlenden Schreibpolicy vorbei ist.

create or replace function app.lebenszeichen_setzen(
  p_dienst  text,
  p_fassung text default null
) returns void
language sql
security definer
set search_path = public, app
as $$
  insert into betrieb_lebenszeichen (dienst, zeitpunkt, fassung)
  values (p_dienst, now(), p_fassung)
  on conflict (dienst)
  do update set zeitpunkt = now(), fassung = excluded.fassung;
$$;

grant execute on function app.lebenszeichen_setzen(text, text) to dms_app;


-- ---------------------------------------------------------------------------
-- Lesen
-- ---------------------------------------------------------------------------
--
-- Das Alter rechnet die Datenbank, nicht der Aufrufer. Ein `timestamptz`,
-- das durch Node geht, wird zu einem `Date` in Serverzeitzone -- dieselbe
-- Falle, die im Projekt schon dreimal zugeschlagen hat. Eine Zahl in
-- Sekunden hat dieses Problem nicht.

create or replace function app.lebenszeichen()
returns table (dienst text, alter_s integer, fassung text)
language sql
stable
as $$
  select dienst,
         extract(epoch from (now() - zeitpunkt))::integer as alter_s,
         fassung
    from betrieb_lebenszeichen
   order by dienst;
$$;

grant execute on function app.lebenszeichen() to dms_app;
