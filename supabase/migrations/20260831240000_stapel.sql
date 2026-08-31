-- Posteingang: Stapelscan mit Belegtrennung
--
-- Konzept 24.1, wortwoertlich: "Aus dem Scanner kommt eine Datei mit zwanzig
-- Belegen. Trennlogik plus Korrekturoberflaeche, bevor die Dokumente einzeln
-- in den Lauf gehen. **Nachtraeglich unangenehm, weil Seiten und Hashes dann
-- schon geschrieben sind.**"
--
-- Der letzte Halbsatz ist die ganze Entwurfsvorgabe. Er verbietet den
-- naheliegenden Weg -- Datei aufnehmen, danach zerlegen. Waere die Scandatei
-- erst ein `dokument`, haette sie einen `inhalt_hash` ueber zwanzig Belege,
-- Seiten in `dokument_seite` und womoeglich schon einen Lauf. Das Zerlegen
-- muesste all das ruecknehmen, und der Hash des ersten Belegs waere nie der
-- Hash der Datei, die tatsaechlich eingegangen ist.
--
-- Deshalb ist ein Stapel **kein Dokument**. Er ist eine eigene Sache mit
-- eigenem Lebenslauf:
--
--   aufbereitung -> pruefung -> uebernommen
--
-- Erst beim Uebernehmen entstehen Dokumente -- je Beleg eine eigene PDF-Datei
-- mit eigenem Hash. Bis dahin ist nichts geschrieben, was zurueckgenommen
-- werden muesste.


-- ---------------------------------------------------------------------------
-- Teil 1: Der Stapel
-- ---------------------------------------------------------------------------

create table stapel (
  id             uuid primary key default gen_random_uuid(),
  mandant_id     uuid not null references mandant(id),
  eingangskanal  text not null check (eingangskanal in ('mail','scan','upload','ftp')),
  dateiname      text not null,
  storage_key    text not null,
  inhalt_hash    text not null,
  seitenzahl     integer,

  status         text not null default 'aufbereitung'
                 check (status in ('aufbereitung','pruefung','uebernommen','verworfen')),

  eingang_am     timestamptz not null default now(),
  erfasst_von    uuid references benutzer(id),
  uebernommen_am timestamptz,
  fehler         text,

  unique (mandant_id, inhalt_hash)
);

create index stapel_offen_idx on stapel (mandant_id, eingang_am desc)
  where status in ('aufbereitung','pruefung');

comment on table stapel is
  'Eine eingegangene Datei, bevor feststeht, wie viele Belege darin stecken. '
  'Bewusst kein `dokument`: Sonst haette der Stapel einen Hash ueber zwanzig '
  'Belege, und das Zerlegen muesste Seiten und Hashes zuruecknehmen '
  '(Konzept 24.1).';

comment on column stapel.inhalt_hash is
  'Ueber die **Scandatei**, nicht ueber die einzelnen Belege. Verhindert, '
  'dass derselbe Stapel zweimal eingelesen wird -- die Dublettenpruefung je '
  'Beleg kommt danach, beim Uebernehmen.';


-- ---------------------------------------------------------------------------
-- Teil 2: Die Seiten und ihre Zuordnung
-- ---------------------------------------------------------------------------

create table stapel_seite (
  stapel_id   uuid not null references stapel(id) on delete cascade,
  seite       integer not null,
  text        text,
  breite      integer,
  hoehe       integer,

  -- Ein Trennblatt gehoert zu keinem Beleg. Es bleibt als Seite stehen,
  -- damit die Korrekturoberflaeche zeigen kann, warum hier getrennt wurde.
  trenner     boolean not null default false,
  -- Welcher Beleg des Stapels. Trennblaetter haben keine Nummer.
  beleg_nr    integer,
  -- Womit die Trennung zustande kam -- fuer die Korrekturoberflaeche und
  -- spaeter fuer die Frage, wie gut die Erkennung ist.
  quelle      text not null default 'automatisch'
              check (quelle in ('automatisch','mensch')),

  primary key (stapel_id, seite),
  check (not trenner or beleg_nr is null)
);

create index stapel_seite_beleg_idx on stapel_seite (stapel_id, beleg_nr);

comment on column stapel_seite.trenner is
  'Erkanntes Trennblatt. Bleibt als Seite erhalten und wandert nicht in den '
  'Beleg -- wer die Trennung nachvollziehen will, muss sehen, woran sie lag.';

comment on column stapel_seite.quelle is
  '`mensch` heisst: In der Korrekturoberflaeche geaendert. Der Unterschied '
  'ist die Grundlage fuer die Frage, wie gut die automatische Trennung ist.';


-- ---------------------------------------------------------------------------
-- Teil 3: Aus Seiten werden Belege
-- ---------------------------------------------------------------------------

-- Nummeriert die Belege eines Stapels neu, ausgehend von den Trennblaettern.
--
-- Als Funktion und nicht in der Anwendung, weil sie nach **jeder** Aenderung
-- an einem Trenner laufen muss: Wer eine Trennung setzt oder aufhebt,
-- verschiebt alle folgenden Belegnummern. Zwei Stellen, die das koennen,
-- waeren eine zu viel.
create or replace function app.stapel_gruppieren(p_stapel_id uuid)
returns integer
language plpgsql
set search_path = public, app
as $$
declare
  anzahl integer;
begin
  -- Zwei Schritte, und der zweite ist der wichtige.
  --
  -- `gruppen` zaehlt die vorangegangenen Trennblaetter -- daraus ergibt sich,
  -- welche Seiten zusammengehoeren. Die Zahl taugt aber nicht als
  -- Belegnummer: Beginnt der Stapel mit einem Trennblatt oder stehen zwei
  -- hintereinander, entstuenden Luecken und ein Beleg 1, den es nicht gibt.
  --
  -- `dense_rank` ueber **nur die Nicht-Trennblaetter** vergibt deshalb
  -- fortlaufende Nummern ohne Luecken.
  with gruppen as (
    select s.seite, s.trenner,
           sum(case when s.trenner then 1 else 0 end)
             over (order by s.seite rows between unbounded preceding and current row) as g
      from stapel_seite s
     where s.stapel_id = p_stapel_id
  ),
  nummeriert as (
    select seite, dense_rank() over (order by g) as nr
      from gruppen
     where not trenner
  )
  update stapel_seite z
     set beleg_nr = n.nr
    from nummeriert n
   where z.stapel_id = p_stapel_id and z.seite = n.seite
     and z.beleg_nr is distinct from n.nr;

  -- Trennblaetter gehoeren zu keinem Beleg -- auch dann nicht, wenn sie
  -- vorher einem zugeordnet waren.
  update stapel_seite
     set beleg_nr = null
   where stapel_id = p_stapel_id and trenner and beleg_nr is not null;

  select count(distinct beleg_nr) into anzahl
    from stapel_seite where stapel_id = p_stapel_id and beleg_nr is not null;

  return coalesce(anzahl, 0);
end;
$$;

comment on function app.stapel_gruppieren(uuid) is
  'Die Belegnummern ergeben sich aus den Trennblaettern, sie werden nicht '
  'gespeichert und fortgeschrieben. Nach jeder Aenderung an einem Trenner '
  'neu rechnen -- eine verschobene Trennung verschiebt alle folgenden Belege.';


-- Setzt oder loescht eine Trennung und nummeriert neu.
create or replace function app.stapel_trennen(
  p_stapel_id uuid,
  p_seite     integer,
  p_trenner   boolean
)
returns integer
language plpgsql
set search_path = public, app
as $$
begin
  update stapel_seite
     set trenner = p_trenner,
         beleg_nr = case when p_trenner then null else beleg_nr end,
         quelle = 'mensch'
   where stapel_id = p_stapel_id and seite = p_seite;

  if not found then
    return -1;
  end if;

  return app.stapel_gruppieren(p_stapel_id);
end;
$$;


-- ---------------------------------------------------------------------------
-- Teil 4: RLS und Rechte
-- ---------------------------------------------------------------------------

alter table stapel       enable row level security;
alter table stapel_seite enable row level security;

-- Ein Stapel gehoert noch keinem Objekt -- die Zuordnung entsteht erst am
-- fertigen Beleg. Sichtbar ist er deshalb mandantenweit, wie ein Dokument
-- ohne Objekt (Migration 20260831140000).
create policy stapel_sicht on stapel for all
  using (mandant_id = (select app.mein_mandant()))
  with check (mandant_id = (select app.mein_mandant()));

create policy stapel_seite_sicht on stapel_seite for all
  using (exists (select 1 from stapel s where s.id = stapel_id))
  with check (exists (select 1 from stapel s where s.id = stapel_id));

grant select, insert, update, delete on stapel to dms_app;
grant select, insert, update, delete on stapel_seite to dms_app;
grant execute on function app.stapel_gruppieren(uuid) to dms_app;
grant execute on function app.stapel_trennen(uuid, integer, boolean) to dms_app;
