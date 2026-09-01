-- Eingangskanaele: ueberwachter Ordner und Mailpostfach
--
-- Konzept 13 nennt drei Wege herein: "Eingang (Postfach/Scan/Upload)".
-- Upload und Scan gab es; das Postfach fehlte, und der ueberwachte Ordner --
-- in der Praxis der Weg, ueber den ein Scanner oder ein FTP-Server ablegt --
-- ebenfalls.
--
-- **Warum eine Tabelle und keine Umgebungsvariablen.** Ein Mandant hat
-- womoeglich zwei Postfaecher und drei Ordner, ein anderer keinen. Das ist
-- ein Stammdatum wie ein Zahlungsweg (Projektregel "Konfiguration statt
-- Code"): Ein zusaetzlicher Ordner darf keine Codeaenderung und keinen
-- Neustart kosten.
--
-- **Was hier nicht steht: das Passwort.** In `einstellungen` steht der
-- *Name* einer Umgebungsvariablen, nicht ihr Inhalt. Ein Datenbankauszug
-- gibt damit die Zugangsdaten zum Postfach nicht her -- und wer die Quelle
-- in der Oberflaeche einrichtet, sieht nie ein Geheimnis, das er
-- weiterreichen koennte.

create table eingangsquelle (
  id             uuid primary key default gen_random_uuid(),
  mandant_id     uuid not null references mandant(id),

  art            text not null check (art in ('ordner','mail')),
  bezeichnung    text not null,

  /*
   * Je nach Art:
   *   ordner: { pfad, erledigt_pfad?, muster? }
   *   mail:   { host, port?, benutzer, passwort_variable, ordner?,
   *             tls?, nach_dem_lesen? }
   *
   * `jsonb` und keine Spalten, weil ein dritter Kanal (etwa ein
   * Netzwerkdrucker) sonst eine Migration kostete. Was gueltig ist, prueft
   * die Anwendung -- eine Weissliste im Code, wie bei den Vorlagen.
   */
  einstellungen  jsonb not null default '{}'::jsonb,

  -- Vorbelegung fuer jeden Beleg, der hier hereinkommt. Ein Postfach fuer
  -- Handwerkerrechnungen kann so gleich die richtige Ordnungsgruppe setzen.
  objekt_id            uuid references objekt(id),
  ordnungsgruppe_id    uuid references ordnungsgruppe(id),
  belegart             text not null default 'rechnung',

  aktiv          boolean not null default true,
  -- Wie oft nachgesehen wird. Ein Ordner darf haeufiger als ein Postfach:
  -- Der eine kostet einen Verzeichniseintrag, das andere eine Anmeldung.
  takt_sekunden  integer not null default 300 check (takt_sekunden >= 30),

  zuletzt_geprueft timestamptz,
  zuletzt_erfolg   timestamptz,
  letzter_fehler   text,
  aufgenommen      integer not null default 0,

  angelegt_am    timestamptz not null default now(),
  angelegt_von   uuid references benutzer(id),

  unique (mandant_id, bezeichnung)
);

create index eingangsquelle_faellig_idx on eingangsquelle (zuletzt_geprueft)
  where aktiv;

comment on table eingangsquelle is
  'Woher Belege von selbst hereinkommen: ueberwachte Ordner und '
  'Mailpostfaecher (Konzept 13). Stammdatum, kein Code -- ein zusaetzlicher '
  'Ordner kostet eine Zeile, keinen Neustart.';

comment on column eingangsquelle.einstellungen is
  'Enthaelt **kein** Passwort, sondern unter `passwort_variable` den Namen '
  'einer Umgebungsvariablen. Ein Datenbankauszug gibt damit keinen '
  'Postfachzugang her.';

comment on column eingangsquelle.letzter_fehler is
  'Sichtbar in der Oberflaeche. Eine Quelle, die seit Wochen nichts liefert, '
  'weil das Passwort abgelaufen ist, faellt sonst erst auf, wenn jemand eine '
  'Rechnung vermisst -- und dann ist die Mahnung schon da.';


alter table eingangsquelle enable row level security;

create policy eingangsquelle_lesen on eingangsquelle
  for select using (mandant_id = (select app.mein_mandant()));

-- Einrichten darf, wer den Ablauf konfigurieren darf. Eine Eingangsquelle
-- bestimmt, welche Belege ueberhaupt entstehen -- das ist keine
-- Sachbearbeitung.
create policy eingangsquelle_anlegen on eingangsquelle
  for insert with check (
    mandant_id = (select app.mein_mandant())
    and (select app.darf('prozess_konfigurieren'))
  );

create policy eingangsquelle_aendern on eingangsquelle
  for update using (
    mandant_id = (select app.mein_mandant())
    and (select app.darf('prozess_konfigurieren'))
  );

grant select, insert, update on eingangsquelle to dms_app;


-- Was der Worker abarbeiten soll.
--
-- `security definer`, weil der Worker ohne Benutzerkontext laeuft -- dieselbe
-- Begruendung wie bei `app.ausgang_offen`. Und dieselbe Enge: Die Funktion
-- liefert nur aktive Quellen, deren Takt abgelaufen ist.
create or replace function app.eingangsquellen_faellig(p_grenze integer default 20)
returns table (
  quelle_id         uuid,
  mandant_id        uuid,
  art               text,
  bezeichnung       text,
  einstellungen     jsonb,
  objekt_id         uuid,
  ordnungsgruppe_id uuid,
  belegart          text
)
language sql
stable
security definer
set search_path = public, app
as $$
  select q.id, q.mandant_id, q.art, q.bezeichnung, q.einstellungen,
         q.objekt_id, q.ordnungsgruppe_id, q.belegart
    from eingangsquelle q
   where q.aktiv
     and (q.zuletzt_geprueft is null
          or q.zuletzt_geprueft < now() - make_interval(secs => q.takt_sekunden))
   order by q.zuletzt_geprueft nulls first
   limit p_grenze;
$$;

grant execute on function app.eingangsquellen_faellig(integer) to dms_app;


-- Ergebnis eines Durchgangs festhalten.
--
-- Auch der erfolglose: `zuletzt_geprueft` sagt "es wurde nachgesehen",
-- `zuletzt_erfolg` sagt "es kam etwas an". Der Unterschied ist die Auskunft,
-- auf die es ankommt -- eine Quelle, die laeuft und nichts findet, ist etwas
-- anderes als eine, die gar nicht mehr laeuft.
create or replace function app.eingangsquelle_vermerken(
  p_quelle_id  uuid,
  p_anzahl     integer,
  p_fehler     text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, app
as $$
declare
  betroffen integer;
begin
  update eingangsquelle
     set zuletzt_geprueft = now(),
         zuletzt_erfolg = case when p_fehler is null then now() else zuletzt_erfolg end,
         letzter_fehler = p_fehler,
         aufgenommen = aufgenommen + greatest(coalesce(p_anzahl, 0), 0)
   where id = p_quelle_id;

  get diagnostics betroffen = row_count;
  return betroffen > 0;
end;
$$;

grant execute on function app.eingangsquelle_vermerken(uuid, integer, text) to dms_app;


-- Schon einmal hereingeholt?
--
-- Die Dublettenpruefung ueber den Inhalts-Hash greift erst, wenn die Datei
-- gelesen ist -- und sie greift **nicht** bei einer Mail, deren Anhang schon
-- einmal ankam, aber diesmal um ein Byte anders komprimiert ist. Deshalb
-- zusaetzlich eine Merkliste der bereits abgeholten Herkunftskennungen:
-- Dateiname samt Zeitstempel beim Ordner, `Message-Id` samt Anhangsname beim
-- Postfach.
--
-- Ohne sie holte ein Postfach dieselbe Mail bei jedem Durchgang erneut, und
-- der Posteingang fuellte sich mit Dubletten, die alle rot sind.
create table eingang_geholt (
  quelle_id   uuid not null references eingangsquelle(id) on delete cascade,
  herkunft    text not null,
  geholt_am   timestamptz not null default now(),
  dokument_id uuid references dokument(id) on delete set null,
  primary key (quelle_id, herkunft)
);

create index eingang_geholt_alter_idx on eingang_geholt (geholt_am);

comment on table eingang_geholt is
  'Merkliste der bereits abgeholten Herkunftskennungen. Die '
  'Dublettenpruefung ueber den Hash greift erst nach dem Lesen und nicht bei '
  'einer neu komprimierten Fassung derselben Mail.';

alter table eingang_geholt enable row level security;

create policy eingang_geholt_lesen on eingang_geholt
  for select using (
    quelle_id in (select q.id from eingangsquelle q
                   where q.mandant_id = (select app.mein_mandant()))
  );

grant select on eingang_geholt to dms_app;


-- Fuer den Worker: nachsehen und vormerken, ohne Benutzerkontext.
create or replace function app.eingang_schon_geholt(
  p_quelle_id uuid,
  p_herkunft  text
)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1 from eingang_geholt g
     where g.quelle_id = p_quelle_id and g.herkunft = p_herkunft
  );
$$;

create or replace function app.eingang_vormerken(
  p_quelle_id   uuid,
  p_herkunft    text,
  p_dokument_id uuid default null
)
returns void
language sql
security definer
set search_path = public, app
as $$
  insert into eingang_geholt (quelle_id, herkunft, dokument_id)
  values (p_quelle_id, p_herkunft, p_dokument_id)
  on conflict (quelle_id, herkunft) do nothing;
$$;

grant execute on function app.eingang_schon_geholt(uuid, text) to dms_app;
grant execute on function app.eingang_vormerken(uuid, text, uuid) to dms_app;
