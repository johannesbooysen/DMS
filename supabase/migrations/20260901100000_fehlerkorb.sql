-- Fehlerkorb der Verarbeitungsqueue
--
-- Konzept 24, Punkt 8: "Was passiert mit einem Dokument, dessen OCR dreimal
-- scheitert". Das Konzept laesst die Antwort offen; hier steht sie.
--
-- Die Warteschlange hat den Korb bereits: `dokument-aufbereiten` hat ein
-- `deadLetter` und schiebt nach drei Versuchen dorthin. Was fehlte, war die
-- **Sicht** darauf. Ein Korb, in den niemand hineinsieht, ist ein Muelleimer.
--
-- Warum nicht einfach die pg-boss-Tabellen anzeigen?
--
--   * Sie haben keine RLS. Eine Ansicht darauf waere die erste Abfrage im
--     System ohne Mandantenfilter aus der Datenbank heraus -- genau das, was
--     die Projektregel verbietet.
--   * Sie sind ein Implementierungsdetail. Wer die Warteschlange austauscht,
--     taeuscht sonst die Oberflaeche mit aus.
--   * Sie kennen keine Erledigung. "Wiederholt", "von Hand uebernommen",
--     "verworfen" sind fachliche Ausgaenge, keine Auftragszustaende.
--
-- Deshalb dieselbe Teilung wie beim Postausgang: Die Technik bleibt in der
-- Warteschlange, die fachliche Spur steht in einer eigenen Tabelle.
--
-- **Was ein gescheitertes Dokument nicht ist: verschwunden.** Der Lauf
-- startet schon beim Eingang, nicht nach der Aufbereitung -- die Aufgabe
-- liegt also im Postfach, auch wenn die Aufbereitung scheitert. Was fehlt,
-- sind Vorschau, Seitentext und erkannte Felder. Der Beleg ist nicht weg,
-- er ist unvollstaendig. Der Fehlerkorb sagt, warum.

create table verarbeitungsfehler (
  id             uuid primary key default gen_random_uuid(),
  mandant_id     uuid not null references mandant(id),

  -- Genau eines von beiden. Ein Stapel ist kein Dokument (Konzept 24.1), und
  -- der Fehler trifft ihn vor der Uebernahme -- da gibt es noch keinen Beleg,
  -- an den man ihn haengen koennte.
  dokument_id    uuid references dokument(id) on delete cascade,
  stapel_id      uuid references stapel(id) on delete cascade,

  /*
   * Fuer die Sichtbarkeit, denormalisiert.
   *
   * Die Policy hat dieselbe Form wie `dokument_lesen`. Ein Join dorthin
   * liefe im Zeilenfilter je Zeile -- die Falle aus Konzept 21, die den Feed
   * einmal 92 Sekunden gekostet hat.
   *
   * Momentaufnahme: Wird das Dokument spaeter einem Objekt zugeordnet, bleibt
   * hier NULL stehen. Das ist richtig herum falsch -- NULL heisst
   * mandantenweit sichtbar, und ein Eintrag im Fehlerkorb soll eher zu viele
   * Augen sehen als zu wenige. Der haeufige Fall ist ohnehin NULL: Ein Beleg,
   * dessen Aufbereitung scheitert, hat meist noch kein Objekt.
   */
  objekt_id      uuid references objekt(id),

  warteschlange  text not null,
  -- Die Auftragskennung aus pg-boss. Nur zum Nachschlagen im Betrieb; die
  -- Anwendung liest sie nicht.
  auftrag_id     text,
  grund          text not null,
  versuche       integer not null default 0,
  aufgetreten_am timestamptz not null default now(),

  erledigt_am    timestamptz,
  erledigt_von   uuid references benutzer(id),
  erledigung     text check (erledigung in ('wiederholt','manuell','verworfen')),

  constraint verarbeitungsfehler_genau_eine_quelle
    check (num_nonnulls(dokument_id, stapel_id) = 1),
  constraint verarbeitungsfehler_erledigung_vollstaendig
    check ((erledigt_am is null) = (erledigung is null))
);

-- Ein offener Eintrag je Quelle. Scheitert dieselbe Aufbereitung nach einer
-- Wiederholung erneut, ist der alte Eintrag erledigt und der neue offen --
-- die Geschichte bleibt, der Korb bleibt lesbar.
create unique index verarbeitungsfehler_offen_dokument_idx
  on verarbeitungsfehler (dokument_id) where erledigt_am is null and dokument_id is not null;
create unique index verarbeitungsfehler_offen_stapel_idx
  on verarbeitungsfehler (stapel_id) where erledigt_am is null and stapel_id is not null;

create index verarbeitungsfehler_korb_idx
  on verarbeitungsfehler (mandant_id, aufgetreten_am desc) where erledigt_am is null;

comment on table verarbeitungsfehler is
  'Was die Warteschlange nach drei Versuchen aufgegeben hat (Konzept 24, '
  'Punkt 8). Fachliche Spur neben der technischen: pg-boss haelt den Auftrag, '
  'diese Tabelle haelt den Vorgang -- mit Grund, Sichtbarkeit und Ausgang.';

comment on column verarbeitungsfehler.grund is
  'Die Fehlermeldung, gekuerzt. Kein Dokumentinhalt, keine Namen -- dieselbe '
  'Regel wie fuer Logs. Wer mehr braucht, oeffnet den Beleg.';

comment on column verarbeitungsfehler.erledigung is
  'wiederholt = noch einmal in die Warteschlange. manuell = ohne Aufbereitung '
  'weiterarbeiten, die Erfassung erfolgt von Hand. verworfen = storniert, '
  'weil die Datei nicht zu gebrauchen ist.';


alter table verarbeitungsfehler enable row level security;

-- Dieselbe Form wie `dokument_lesen`: unkorrelierte Unterabfrage, damit der
-- Planer einen InitPlan bildet und die Funktion einmal je Statement laeuft
-- statt einmal je Zeile (Migration 20260831210000).
create policy verarbeitungsfehler_lesen on verarbeitungsfehler
  for select using (
    mandant_id = (select app.mein_mandant())
    and (objekt_id is null
         or objekt_id = any ((select app.meine_objekte())::uuid[]))
  );

-- Erledigen laeuft ueber `app.verarbeitungsfehler_erledigen`, das unter der
-- RLS arbeitet -- deshalb braucht es die Policy. Angelegt wird dagegen nur
-- ueber die `security definer`-Funktion des Workers: kein INSERT hier, damit
-- niemand einen Fehler erfindet oder wegschreibt.
create policy verarbeitungsfehler_erledigen on verarbeitungsfehler
  for update using (
    mandant_id = (select app.mein_mandant())
    and (objekt_id is null
         or objekt_id = any ((select app.meine_objekte())::uuid[]))
  );

grant select, update on verarbeitungsfehler to dms_app;


-- ---------------------------------------------------------------------------
-- Melden
-- ---------------------------------------------------------------------------

-- `security definer`, weil der Worker meldet.
--
-- Er hat zwar einen technischen Benutzer, aber dessen Sichtbarkeit ist eine
-- Konfigurationsfrage -- und ein Fehler, der nicht gemeldet werden kann,
-- weil der meldende Benutzer das Dokument nicht sieht, ist der schlechteste
-- aller Faelle: Er waere still. Mandant und Objekt kommen deshalb aus der
-- Quelle selbst, nicht aus dem Aufrufer.
create or replace function app.verarbeitungsfehler_melden(
  p_dokument_id   uuid,
  p_stapel_id     uuid,
  p_warteschlange text,
  p_grund         text,
  p_versuche      integer default 0,
  p_auftrag_id    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  m      uuid;
  o      uuid;
  neuer  uuid;
begin
  if num_nonnulls(p_dokument_id, p_stapel_id) <> 1 then
    raise exception 'Genau eine Quelle: Dokument oder Stapel.';
  end if;

  if p_dokument_id is not null then
    select d.mandant_id, d.objekt_id into m, o
      from dokument d where d.id = p_dokument_id;
  else
    select s.mandant_id, null::uuid into m, o
      from stapel s where s.id = p_stapel_id;
  end if;

  -- Die Quelle kann inzwischen storniert und geloescht sein. Dann gibt es
  -- nichts zu melden, und das ist kein Fehler.
  if m is null then
    return null;
  end if;

  insert into verarbeitungsfehler (mandant_id, dokument_id, stapel_id, objekt_id,
                                   warteschlange, grund, versuche, auftrag_id)
  values (m, p_dokument_id, p_stapel_id, o,
          p_warteschlange, left(coalesce(p_grund, 'Unbekannter Fehler'), 500),
          coalesce(p_versuche, 0), p_auftrag_id)
  -- Zweimal derselbe offene Eintrag waere Rauschen: Der Korb soll die Zahl
  -- der Vorgaenge zeigen, nicht die Zahl der Meldungen.
  on conflict do nothing
  returning id into neuer;

  return neuer;
end;
$$;

grant execute on function
  app.verarbeitungsfehler_melden(uuid, uuid, text, text, integer, text) to dms_app;


-- ---------------------------------------------------------------------------
-- Erledigen
-- ---------------------------------------------------------------------------

-- Laeuft unter der RLS: Wer den Eintrag nicht sieht, erledigt ihn auch nicht.
-- Die Wirkung auf das Dokument steht **nicht** hier, sondern in der Anwendung
-- -- sie ruft je nach Ausgang `app.dokument_stornieren` oder reiht neu ein.
-- Diese Funktion schliesst nur den Eintrag.
create or replace function app.verarbeitungsfehler_erledigen(
  p_id         uuid,
  p_erledigung text
)
returns boolean
language plpgsql
set search_path = public, app
as $$
declare
  betroffen integer;
begin
  if p_erledigung not in ('wiederholt','manuell','verworfen') then
    raise exception 'Unbekannter Ausgang: %', p_erledigung;
  end if;

  update verarbeitungsfehler
     set erledigt_am = now(),
         erledigt_von = app.mein_benutzer(),
         erledigung = p_erledigung
   where id = p_id and erledigt_am is null;

  get diagnostics betroffen = row_count;
  return betroffen > 0;
end;
$$;

grant execute on function app.verarbeitungsfehler_erledigen(uuid, text) to dms_app;


-- ---------------------------------------------------------------------------
-- Haengengebliebene ohne Meldung
-- ---------------------------------------------------------------------------

-- Der Fehlerkorb faengt, was die Warteschlange aufgegeben hat. Er faengt
-- **nicht**, was nie dort ankam: Stirbt der Worker mitten in der
-- Aufbereitung, bleibt das Dokument in `in_aufbereitung` liegen, ohne Auftrag
-- und ohne Meldung.
--
-- Deshalb diese zweite, unabhaengige Quelle. Sie fragt nicht die
-- Warteschlange, sondern den Zustand: Was steht seit laengerem in
-- `in_aufbereitung` und hat keinen offenen Eintrag im Korb?
--
-- Bewusst kein `security definer`: Die Abfrage laeuft ueber `dokument` und
-- damit unter dessen Policy. Wer den Beleg nicht sieht, sieht auch nicht,
-- dass er haengt.
create or replace function app.aufbereitung_haengt(p_minuten integer default 30)
-- Zur Kennzeichnung dient `storage_praefix` und der Eingangskanal. Einen
-- Dateinamen fuehrt `dokument` nicht, und Kreditor oder Rechnungsnummer gibt
-- es hier per Definition noch nicht -- sie entstehen erst in der Extraktion,
-- die ja gescheitert ist. Mehr Identitaet hat ein solcher Beleg nicht.
returns table (
  dokument_id     uuid,
  storage_praefix text,
  eingangskanal   text,
  objekt_id       uuid,
  eingang_am      timestamptz
)
language sql
stable
set search_path = public, app
as $$
  select d.id, d.storage_praefix, d.eingangskanal, d.objekt_id, d.eingang_am
    from dokument d
   where d.status = 'in_aufbereitung'
     and d.eingang_am < now() - make_interval(mins => greatest(p_minuten, 1))
     and not exists (
       select 1 from verarbeitungsfehler v
        where v.dokument_id = d.id and v.erledigt_am is null
     )
   order by d.eingang_am
   limit 200;
$$;

comment on function app.aufbereitung_haengt(integer) is
  'Zweite Quelle neben dem Fehlerkorb: Was liegen blieb, ohne dass die '
  'Warteschlange es gemeldet hat -- etwa weil der Worker mitten in der '
  'Aufbereitung gestorben ist.';

grant execute on function app.aufbereitung_haengt(integer) to dms_app;
