-- Die Schutzpruefung bewertet nur Tabellen, die dem DMS gehoeren.
--
-- Seit die RealesOS-Grundlage (00000000000000_realesos_public_baseline.sql)
-- vor den eigenen Migrationen liegt (ADR 0010), stehen in `public` 28
-- Tabellen, die nicht dem DMS gehoeren. Vier davon (platform_admins,
-- tenant_limits, tenant_usage_counters, user_roles) haben RLS an und keine
-- Policy -- bei RealesOS Absicht (nur die Service-Rolle liest sie), fuer
-- app.schutz_pruefen() bisher ein harter Befund "policy_fehlt". Die
-- Sicherungsprobe und die Inbetriebnahme meldeten damit Fremdes als eigenes
-- Versaeumnis.
--
-- Was dem DMS gehoert, erkennt die Datenbank selbst: Die Anwendungsrolle
-- `dms_app` hat auf jeder DMS-Tabelle Rechte (grant in der jeweiligen
-- Migration), auf keiner RealesOS-Tabelle. Geprueft wird deshalb, was
-- `dms_app` lesen darf -- in `public` und, fuer den naechsten Schritt des
-- Umzugs, in `dms`. Der Trigger-Teil bleibt unveraendert.

create or replace function app.schutz_pruefen()
returns table (
  gegenstand text,
  art        text,
  befund     text
)
language sql
stable
security definer
set search_path = public, app
as $$
  with eigene as (
    select c.oid, c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'dms')
       and c.relkind = 'r'
       and has_table_privilege('dms_app', c.oid, 'SELECT')
  )
  select e.relname::text, 'rls_aus',
         'Row Level Security ist nicht eingeschaltet.'
    from eigene e
   where not e.relrowsecurity
     and e.relname not in ('schema_migrations','aufbewahrungsfrist')

  union all

  select e.relname::text, 'policy_fehlt',
         'RLS ist an, aber es gibt keine Policy.'
    from eigene e
   where e.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = e.oid)

  union all

  select t.name, 'trigger_fehlt',
         'Der Trigger fuer Unveraenderlichkeit fehlt.'
    from (values
            ('stempel_ereignis_kette'),
            ('stempel_ereignis_unveraenderlich'),
            ('zuweisung_ereignis_unveraenderlich'),
            ('korrektur_ereignis_unveraenderlich'),
            ('prozessdefinition_ereignis_unveraenderlich'),
            ('zugriff_protokoll_unveraenderlich'),
            ('archiv_eintrag_unveraenderlich'),
            ('verfahrensdoku_unveraenderlich'),
            ('dokument_layer_unveraenderlich'),
            ('dokument_archiv_schutz'),
            ('rechnung_fakten_archiv_schutz'),
            ('schriftverkehr_fakten_archiv_schutz'),
            ('kontierung_archiv_schutz'),
            ('sicherungs_probe_unveraenderlich'),
            ('uebernahme_eintrag_unveraenderlich'),
            ('dokument_paginiernummer_fest')
         ) as t(name)
   where not exists (
     select 1 from pg_trigger g
      where g.tgname = t.name and not g.tgisinternal
   )
   order by 2, 1;
$$;


-- Und die Anwendungsrolle verliert ihre Rechte auf den RealesOS-Tabellen.
--
-- Migration 20260828100100 gibt dms_app pauschal Rechte auf *alle* Tabellen
-- in public -- seit der Grundlage also auch auf die 28 RealesOS-Tabellen.
-- Das widerspricht der Vorschrift (kein Schreibzugriff auf public, Lesen
-- nur unter der Sitzung des angemeldeten Nutzers) und liesse die
-- Schutzpruefung oben Fremdes als Eigenes zaehlen. Die Liste ist der
-- Stand der Grundlage; Stammdaten liest spaeter ein security-definer-
-- Durchgang (ADR 0010, Schritt 4), nicht die Anwendungsrolle direkt.
do $$
declare
  t text;
begin
  foreach t in array array['business_partner_contacts', 'business_partner_locations', 'business_partner_objects', 'business_partners', 'company_persons', 'cost_entries', 'event_logs', 'facility_tickets', 'object_owners', 'objects', 'occupancy_tenants', 'ownership_owners', 'person_objects', 'persons', 'platform_admins', 'profiles', 'role_permissions', 'saas_modules', 'service_orders', 'tasks', 'tenant_limits', 'tenant_usage_counters', 'tenants', 'unit_occupancies', 'unit_ownerships', 'units', 'user_permissions', 'user_roles']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from dms_app', t);
    end if;
  end loop;
end
$$;
