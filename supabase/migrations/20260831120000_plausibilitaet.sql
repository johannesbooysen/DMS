-- Plausibilitaet: Befunde festhalten
--
-- Grundlage: Konzept 14. Die Ampel hat zwei Werte, und der zweite -- die
-- Plausibilitaet -- ist etwas fachlich anderes als das Extraktionsvertrauen:
-- "IBAN weicht ab" ist ein anderer Fall als "Betrag unscharf gelesen".
--
-- Ohne diese Tabelle waere "orange" eine Farbe ohne Begruendung. Der
-- Bearbeiter muss sehen, WARUM ein Beleg auffaellt, sonst sucht er selbst
-- danach -- und das kostet mehr Zeit als die Pruefung spart.

create table plausibilitaet_befund (
  id            uuid primary key default gen_random_uuid(),
  dokument_id   uuid not null references dokument(id) on delete cascade,
  -- Kennung der Pruefung, nicht ihr Text: Die Formulierung darf sich aendern,
  -- ohne dass Auswertungen brechen.
  pruefung      text not null,
  schwere       text not null check (schwere in ('hart','orange','hinweis')),
  hinweis       text not null,
  erkannt_am    timestamptz not null default now(),

  -- Je Pruefung genau ein Befund. Laeuft die Pruefung erneut, ersetzt sie
  -- ihren eigenen Befund, statt einen zweiten daneben zu legen.
  unique (dokument_id, pruefung)
);

create index on plausibilitaet_befund (dokument_id, schwere);

comment on table plausibilitaet_befund is
  'Je Dokument und Pruefung ein Befund. "hart" stoppt die Bearbeitung '
  '(Konzept 14: IBAN und Dublette faerben nicht nur, sie halten an), '
  '"orange" faerbt die Ampel, "hinweis" steht nur da.';

comment on column plausibilitaet_befund.hinweis is
  'Im Klartext und fuer den Bearbeiter geschrieben -- er soll ohne '
  'Rueckfrage wissen, was zu tun ist. Keine personenbezogenen Daten aus '
  'dem Beleg ueber das hinaus, was ohnehin am Dokument steht.';

alter table plausibilitaet_befund enable row level security;

create policy plausibilitaet_befund_sicht on plausibilitaet_befund for all
  using (exists (select 1 from dokument d where d.id = dokument_id))
  with check (exists (select 1 from dokument d where d.id = dokument_id));

grant select, insert, update, delete on plausibilitaet_befund to dms_app;
