-- Entwurf und Aktivierung einer Prozessfassung
--
-- Grundlage: ADR 0002, Abschnitt Mehrbenutzerbetrieb, und Konzept 8.8.
--
-- Eine Prozessdefinition wird nie ueberschrieben, sondern neu versioniert.
-- Was fehlte, war die Arbeitsfassung dazwischen: Wer aendert gerade, und ab
-- wann gilt es? Ohne Eigentuemer am Entwurf arbeiten zwei Leute gleichzeitig
-- an derselben Fassung und ueberschreiben sich gegenseitig.

alter table prozessdefinition
  add column entwurf_von uuid references benutzer(id),
  add column entwurf_seit timestamptz;

comment on column prozessdefinition.entwurf_von is
  'Eigentuemer der Arbeitsfassung. Wer sie oeffnet, waehrend ein anderer '
  'daran arbeitet, bekommt sie lesend -- kein gleichzeitiges Bearbeiten, '
  'sondern eine sichtbare Belegung (ADR 0002).';

-- Hoechstens ein Entwurf je Belegart und Ordnungsgruppe. Zwei parallele
-- Entwuerfe waeren zwei Wahrheiten ueber denselben Ablauf.
create unique index prozessdefinition_ein_entwurf_idx
  on prozessdefinition (mandant_id, belegart, coalesce(ordnungsgruppe_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'entwurf';


create table prozessdefinition_ereignis (
  id            uuid primary key default gen_random_uuid(),
  definition_id uuid not null references prozessdefinition(id) on delete cascade,
  art           text not null check (art in ('angelegt','aktiviert','abgeloest','verworfen')),
  benutzer_id   uuid not null references benutzer(id),
  zeitpunkt     timestamptz not null default now(),
  hinweis       text
);

create index on prozessdefinition_ereignis (definition_id, zeitpunkt);

comment on table prozessdefinition_ereignis is
  'Wer hat wann welche Fassung scharfgeschaltet. Dieselbe Logik wie bei den '
  'Stempeln: Eine Aenderung am Ablauf ist eine Entscheidung und gehoert '
  'protokolliert -- im Pruefungsfall ist sie die Erklaerung dafuer, warum ein '
  'Beleg einen bestimmten Weg genommen hat.';

-- Wie stempel_ereignis: nachtraeglich nicht zu aendern.
create trigger prozessdefinition_ereignis_unveraenderlich
  before update or delete on prozessdefinition_ereignis
  for each row execute function app.nur_anfuegen();

alter table prozessdefinition_ereignis enable row level security;

create policy prozessdefinition_ereignis_lesen on prozessdefinition_ereignis for select
  using (exists (select 1 from prozessdefinition p
                  where p.id = definition_id and p.mandant_id = app.mein_mandant()));

create policy prozessdefinition_ereignis_anlegen on prozessdefinition_ereignis for insert
  with check (
    benutzer_id = app.mein_benutzer()
    and exists (select 1 from prozessdefinition p
                 where p.id = definition_id and p.mandant_id = app.mein_mandant())
  );

grant select, insert on prozessdefinition_ereignis to dms_app;
