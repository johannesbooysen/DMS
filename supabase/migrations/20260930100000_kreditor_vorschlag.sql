-- Kreditorvorschlag: Ein Rechnungssteller, den es nicht gibt, wird
-- vorgeschlagen -- und nach Freigabe ein Kreditor.
--
-- Beim Bedienen gewuenscht: Eine Rechnung eines unbekannten Dienstleisters
-- kam mit Name, USt-IdNr. und IBAN erkannt an, und trotzdem musste jemand
-- den Kreditor von Hand abtippen. Jetzt legt die Aufbereitung einen
-- Vorschlag ab; wer Stammdaten pflegen darf, prueft ihn, aendert ihn
-- gegebenenfalls und uebernimmt ihn mit einem Klick -- oder ordnet den Beleg
-- einem vorhandenen Kreditor zu, oder verwirft ihn.
--
-- Warum nicht gleich anlegen: Ein Kreditor ist ein Stammdatum mit
-- Bankverbindung, und die Bankverbindung ist der Betrugsschutz. Ein Modell
-- legt keine Stammdaten an; ein Mensch gibt frei. Die IBAN kommt als
-- "neu" herein, nie als bestaetigt.
--
-- Geschrieben wird der Vorschlag ueber eine security-definer-Funktion, weil
-- der Worker unter dem Einliefernden laeuft und der meist keine
-- Stammdaten pflegen darf (dieselbe Bauart wie verarbeitungsfehler_melden).
-- Entschieden wird unter der Schreibpolicy: nur mit stammdaten_pflegen.

create table kreditor_vorschlag (
  id              uuid primary key default gen_random_uuid(),
  mandant_id      uuid not null references mandant(id),
  dokument_id     uuid not null references dokument(id) on delete cascade unique,
  name            text not null,
  ust_id          text,
  iban            text,
  status          text not null default 'offen'
                  check (status in ('offen', 'uebernommen', 'zugeordnet', 'verworfen')),
  kreditor_id     uuid references kreditor(id),
  angelegt_am     timestamptz not null default now(),
  entschieden_am  timestamptz,
  entschieden_von uuid references benutzer(id)
);

comment on table kreditor_vorschlag is
  'Rechnungssteller ohne Kreditor: aus der Erkennung vorgeschlagen, von einem Menschen uebernommen, zugeordnet oder verworfen.';

create index on kreditor_vorschlag (mandant_id, status);

alter table kreditor_vorschlag enable row level security;

create policy kreditor_vorschlag_lesen on kreditor_vorschlag for select
  using (mandant_id = (select app.mein_mandant()));
create policy kreditor_vorschlag_entscheiden on kreditor_vorschlag for update
  using ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()))
  with check ((select app.darf_stammdaten()) and mandant_id = (select app.mein_mandant()));

grant select, update on kreditor_vorschlag to dms_app;

-- Der Vorschlag entsteht in der Aufbereitung -- unter dem Einliefernden,
-- der meist keine Stammdaten pflegen darf. Ein zweiter Lauf ueber denselben
-- Beleg frischt einen offenen Vorschlag auf und laesst einen entschiedenen
-- in Ruhe.
create or replace function app.kreditor_vorschlag_melden(
  p_dokument_id uuid,
  p_name        text,
  p_ust_id      text,
  p_iban        text
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  m     uuid;
  neuer uuid;
begin
  select d.mandant_id into m from dokument d where d.id = p_dokument_id;
  if m is null or coalesce(trim(p_name), '') = '' then
    return null;
  end if;

  insert into kreditor_vorschlag (mandant_id, dokument_id, name, ust_id, iban)
  values (m, p_dokument_id, left(trim(p_name), 200), nullif(trim(p_ust_id), ''),
          nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), ''))
  on conflict (dokument_id) do update
    set name   = excluded.name,
        ust_id = coalesce(excluded.ust_id, kreditor_vorschlag.ust_id),
        iban   = coalesce(excluded.iban, kreditor_vorschlag.iban)
    where kreditor_vorschlag.status = 'offen'
  returning id into neuer;

  return neuer;
end;
$$;

grant execute on function app.kreditor_vorschlag_melden(uuid, text, text, text) to dms_app;
