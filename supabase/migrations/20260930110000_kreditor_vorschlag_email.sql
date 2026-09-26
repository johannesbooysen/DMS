-- Kreditorvorschlag: die E-Mail-Adresse aus dem Beleg mitnehmen.
--
-- Beim Bedienen gefragt, warum die E-Mail nicht erkannt wurde: Sie wurde
-- gar nicht gesucht. Jetzt liest eine Regel sie aus dem Text, und der
-- Vorschlag traegt sie -- der Kreditor braucht sie fuer Systemaktionen.

alter table kreditor_vorschlag add column email text;

drop function if exists app.kreditor_vorschlag_melden(uuid, text, text, text);

create or replace function app.kreditor_vorschlag_melden(
  p_dokument_id uuid,
  p_name        text,
  p_ust_id      text,
  p_iban        text,
  p_email       text default null
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

  insert into kreditor_vorschlag (mandant_id, dokument_id, name, ust_id, iban, email)
  values (m, p_dokument_id, left(trim(p_name), 200), nullif(trim(p_ust_id), ''),
          nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), ''),
          nullif(lower(trim(p_email)), ''))
  on conflict (dokument_id) do update
    set name   = excluded.name,
        ust_id = coalesce(excluded.ust_id, kreditor_vorschlag.ust_id),
        iban   = coalesce(excluded.iban, kreditor_vorschlag.iban),
        email  = coalesce(excluded.email, kreditor_vorschlag.email)
    where kreditor_vorschlag.status = 'offen'
  returning id into neuer;

  return neuer;
end;
$$;

grant execute on function app.kreditor_vorschlag_melden(uuid, text, text, text, text) to dms_app;
