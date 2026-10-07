-- Schriftverkehr: Wer bekommt ein Schreiben, und wann erfaehrt die
-- Geschaeftsleitung davon?
--
-- Beim Bedienen gefragt: "Wie kann beim Schriftverkehr sichergestellt werden,
-- dass der richtige Mitarbeiter das Schreiben erhaelt und bei wichtigen
-- Sachen, z. B. einer Rechtssache, die Geschaeftsleitung informiert wird?"
-- Die Antworten des Hauses (06.10.2026):
--
--   * Empfaenger in dieser Rangfolge: im Schreiben genannte Person, feste
--     Zuordnung des Absenders, Spezialist fuer das Thema, Objektverantwortlicher.
--   * Wichtig ist, was ein Thema mit "GL informieren" traegt oder ein
--     Signalwort enthaelt -- beides einstellbar.
--   * Die GL bekommt bei wichtigen Schreiben eine **eigene, parallele**
--     Kenntnisaufgabe (nachweisbar im Belegweg), keine Mail.
--   * Bleibt die Kenntnisnahme liegen, eskaliert sie an die GL -- 48 h
--     normal, 24 h bei wichtigen Schreiben, beides Ablaufkonfiguration.
--   * Nur fuer Schriftverkehr; Rechnungen haben ihren Weg ueber Betragsgrenzen.
--
-- Was hier entsteht, sind **Stammdaten und ein Feld**, kein Sonderprogramm:
--
--   1. `benutzer.kuerzel` -- damit "z. Hd. AA" im Schreiben eine Person trifft.
--   2. `ordnungsgruppe.gl_informieren` -- ein Thema, das die GL sehen will.
--   3. `schriftverkehr_regel` -- Signalwoerter und Absender mit Thema,
--      Wichtig-Marke und wahlweise einem Empfaenger (Benutzer oder Gruppe).
--   4. `dokument.wichtig` und `dokument.empfaenger_*` -- das Ergebnis der
--      Verteilung am Beleg, mit Begruendung, damit der Belegweg sagen kann,
--      welche Regel griff.
--   5. Zustaendigkeit `ermittelt` an der Stufe: Die Engine nimmt den
--      ermittelten Empfaenger, sonst Spezialgebiet, sonst Objektverantwortliche.
--   6. `wichtig` als Feld fuer Verzweigungen im Ablauf -- die parallele
--      GL-Stufe ist ein "Wenn wichtig / sonst" im Baum, kein Codepfad.
--   7. Eskalation an eine **Rolle** (`eskalation_an_rolle`): Bisher kannte
--      die Eskalation nur eine Person; "an die Geschaeftsleitung" ist eine
--      Rolle, und eine Person im Urlaub waere genau die falsche Adresse.
--
-- Die Verteilung rechnet der Worker nach der Texterkennung
-- (src/schriftverkehr/verteilung.ts) und setzt danach die offenen Aufgaben
-- des Laufs neu auf, solange keine Entscheidung darin liegt -- derselbe
-- Schritt wie beim Wechsel der Belegart.

-- ---------------------------------------------------------------------------
-- Teil 1: Kuerzel am Benutzer
-- ---------------------------------------------------------------------------
alter table dms.benutzer
  add column kuerzel text check (kuerzel is null or kuerzel ~ '^[A-Za-zÄÖÜäöüß]{2,5}$');
comment on column dms.benutzer.kuerzel is
  'Zwei bis fuenf Buchstaben, je Mandant eindeutig. Trifft ein Schreiben, das die '
  'Person mit Kuerzel nennt ("z. Hd. AA").';
create unique index benutzer_kuerzel_idx on dms.benutzer (mandant_id, upper(kuerzel))
  where kuerzel is not null;

-- ---------------------------------------------------------------------------
-- Teil 2: Thema, bei dem die Geschaeftsleitung informiert wird
-- ---------------------------------------------------------------------------
alter table dms.ordnungsgruppe add column gl_informieren boolean not null default false;
comment on column dms.ordnungsgruppe.gl_informieren is
  'Ein Schriftstueck dieses Themas gilt als wichtig (dokument.wichtig) -- der '
  'Ablauf kann darauf verzweigen, z. B. parallele Kenntnisstufe der GL.';

-- ---------------------------------------------------------------------------
-- Teil 3: Regeln -- Signalwoerter und Absender
-- ---------------------------------------------------------------------------
create table dms.schriftverkehr_regel (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references dms.mandant(id),
  -- signalwort: ein Wort im Text (ganzes Wort, Gross/Klein egal).
  -- absender:   ein Teil des Absendernamens (Korrespondent, sonst Kopf der ersten Seite).
  art               text not null check (art in ('signalwort', 'absender')),
  muster            text not null check (length(trim(muster)) between 2 and 80),
  -- Was die Regel bewirkt -- jedes fuer sich wahlweise.
  ordnungsgruppe_id uuid references dms.ordnungsgruppe(id),
  wichtig           boolean not null default false,
  benutzer_id       uuid references dms.benutzer(id),
  gruppe_id         uuid references dms.gruppe(id),
  sortierung        integer not null default 100,
  aktiv             boolean not null default true,
  erstellt_am       timestamptz not null default now(),
  check (benutzer_id is null or gruppe_id is null),
  unique (mandant_id, art, muster)
);
comment on table dms.schriftverkehr_regel is
  'Verteilregeln fuer Schriftverkehr: Signalwoerter und Absender mit Thema, '
  'Wichtig-Marke und wahlweise Empfaenger. Stammdatum; Mitarbeiter nur als Verweis.';

alter table dms.schriftverkehr_regel enable row level security;
create policy schriftverkehr_regel_lesen on dms.schriftverkehr_regel for select
  using (mandant_id = (select dms.mein_mandant()));
create policy schriftverkehr_regel_schreiben on dms.schriftverkehr_regel for all
  using ((select dms.darf_stammdaten()) and mandant_id = (select dms.mein_mandant()))
  with check ((select dms.darf_stammdaten()) and mandant_id = (select dms.mein_mandant()));
grant select, insert, update, delete on dms.schriftverkehr_regel to dms_app;

-- Die Verweise gehoeren zum eigenen Haus. Ein Fremdschluessel prueft nur, dass
-- es die Zeile gibt -- eine Gruppe eines anderen Mandanten bekaeme sonst
-- Aufgaben, die niemand dort lesen kann.
create or replace function dms.schriftverkehr_regel_pruefen()
returns trigger
language plpgsql
security definer
set search_path = dms, public
as $$
begin
  if new.ordnungsgruppe_id is not null and not exists (
    select 1 from ordnungsgruppe g where g.id = new.ordnungsgruppe_id and g.mandant_id = new.mandant_id
  ) then
    raise exception 'Das Thema gehoert nicht zu diesem Mandanten.';
  end if;
  if new.benutzer_id is not null and not exists (
    select 1 from benutzer b where b.id = new.benutzer_id and b.mandant_id = new.mandant_id
  ) then
    raise exception 'Der Empfaenger gehoert nicht zu diesem Mandanten.';
  end if;
  if new.gruppe_id is not null and not exists (
    select 1 from gruppe g where g.id = new.gruppe_id and g.mandant_id = new.mandant_id
  ) then
    raise exception 'Die Empfaengergruppe gehoert nicht zu diesem Mandanten.';
  end if;
  new.muster := trim(new.muster);
  return new;
end;
$$;
create trigger schriftverkehr_regel_pruefen
  before insert or update on dms.schriftverkehr_regel
  for each row execute function dms.schriftverkehr_regel_pruefen();

-- ---------------------------------------------------------------------------
-- Teil 4: Das Ergebnis am Beleg
-- ---------------------------------------------------------------------------
alter table dms.dokument
  add column wichtig                 boolean not null default false,
  add column wichtig_begruendung     text,
  add column empfaenger_benutzer_id  uuid references dms.benutzer(id),
  add column empfaenger_gruppe_id    uuid references dms.gruppe(id),
  add column empfaenger_begruendung  text;
comment on column dms.dokument.wichtig is
  'Aus Thema (gl_informieren) oder Signalwort. Feld fuer Verzweigungen im Ablauf.';
comment on column dms.dokument.empfaenger_benutzer_id is
  'Ermittelter Empfaenger (Person im Schreiben oder Absenderregel). Die Stufe '
  '"ermittelt" nimmt ihn vor Spezialgebiet und Objektverantwortlichem.';

-- ---------------------------------------------------------------------------
-- Teil 5: Zustaendigkeit "ermittelt" und Eskalation an eine Rolle
-- ---------------------------------------------------------------------------
alter table dms.prozessstufe drop constraint prozessstufe_zustaendigkeit_typ_check;
alter table dms.prozessstufe add constraint prozessstufe_zustaendigkeit_typ_check
  check (zustaendigkeit_typ in
    ('objektverantwortlich', 'rolle', 'gruppe', 'spezialgebiet', 'ermittelt', 'extern', 'system'));

alter table dms.prozessstufe add column eskalation_an_rolle uuid references dms.rolle(id);
comment on column dms.prozessstufe.eskalation_an_rolle is
  'Eskalation an eine Rolle statt an eine Person (Geschaeftsleitung). Eines von beiden.';

alter table dms.zuweisung_ereignis
  alter column an_benutzer drop not null,
  add column an_rolle uuid references dms.rolle(id),
  add constraint zuweisung_ereignis_ziel check (an_benutzer is not null or an_rolle is not null);

-- Die Rueckgabe bekommt eine Spalte; eine Funktion mit anderer Rueckgabe
-- laesst sich nicht ersetzen, nur neu anlegen.
drop function dms.eskalation_durchgang();
create function dms.eskalation_durchgang()
returns table (aufgabe_id uuid, dokument_id uuid, an_benutzer uuid, an_rolle uuid)
language sql
security definer
set search_path = dms, public
as $$
  with faellig as (
    select a.id, a.zugewiesen_benutzer, b.id as an_benutzer, r.id as an_rolle, l.dokument_id
      from aufgabe a
      join prozessstufe s on s.id = a.stufe_id
      join dokument_lauf l on l.id = a.lauf_id
      left join benutzer b on b.id = s.eskalation_an and b.aktiv
      left join rolle r on r.id = s.eskalation_an_rolle and r.aktiv
     where a.status in ('offen','in_arbeit')
       and a.eskalationsstufe = 0
       and s.eskalation_nach_stunden is not null
       and (b.id is not null or r.id is not null)
       and coalesce(a.faellig_am, a.erstellt_am)
           + (s.eskalation_nach_stunden * interval '1 hour') < now()
       -- Wer die Aufgabe schon persoenlich hat, bekommt sie nicht noch einmal.
       and (b.id is null or a.zugewiesen_benutzer is distinct from b.id)
  ),
  umgelenkt as (
    -- Eine Aufgabe hat hoechstens einen Traeger (aufgabe_traeger). An eine
    -- Person: wie bisher, sie bekommt die Aufgabe persoenlich. An eine Rolle:
    -- die Rolle bekommt sie, der bisherige Traeger gibt sie ab -- "die
    -- Aufgabe wandert, die Rolle bleibt" (Konzept 8, 17). Wer sie vorher
    -- hatte, steht im Protokoll (von_benutzer).
    update aufgabe a
       set zugewiesen_benutzer = case when f.an_rolle is null then f.an_benutzer else null end,
           zugewiesen_gruppe   = case when f.an_rolle is null then a.zugewiesen_gruppe else null end,
           zugewiesen_rolle    = case when f.an_rolle is null then a.zugewiesen_rolle else f.an_rolle end,
           eskalationsstufe    = 1
      from faellig f
     where a.id = f.id
     returning a.id, f.dokument_id, f.zugewiesen_benutzer as von, f.an_benutzer, f.an_rolle
  ),
  protokoll as (
    insert into zuweisung_ereignis (dokument_id, von_benutzer, an_benutzer, an_rolle, grund)
    select u.dokument_id, u.von, u.an_benutzer, u.an_rolle, 'eskalation' from umgelenkt u
  )
  select u.id, u.dokument_id, u.an_benutzer, u.an_rolle from umgelenkt u;
$$;
comment on function dms.eskalation_durchgang() is
  'Ueberfaellige Aufgaben an die an der Stufe hinterlegte Person oder Rolle -- '
  'einmal, protokolliert in zuweisung_ereignis. Laeuft im Worker ohne Benutzer.';
grant execute on function dms.eskalation_durchgang() to dms_app;
