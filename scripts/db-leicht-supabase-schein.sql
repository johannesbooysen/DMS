-- Supabase-Schein fuer die leichte Entwicklungsdatenbank (nur dort!).
--
-- Das RealesOS-Grundschema (docs/realesos/realesos_public_baseline.sql,
-- als Migration 00000000000000) und die Startmigration des Schemas dms
-- setzen voraus, was eine Supabase-Instanz mitbringt und ein nacktes
-- PostgreSQL nicht hat: das Schema auth mit auth.users, auth.uid() und
-- auth.role(), die Rollen anon / authenticated / service_role und das
-- Schema storage mit buckets, objects und foldername().
--
-- Diese Datei stellt genau das nach -- so weit, wie Migrationen und Tests
-- es brauchen, nicht weiter. auth.uid() liest dieselben Sitzungsvariablen
-- wie PostgREST (request.jwt.claim.sub beziehungsweise request.jwt.claims),
-- damit ein Test mit `set local request.jwt.claims = '{"sub": …}'` sich
-- hier genauso verhaelt wie gegen Supabase.
--
-- scripts/db-leicht.mjs spielt sie vor den Migrationen ein. Sie liegt
-- bewusst NICHT unter supabase/migrations: Gegen eine echte Supabase-
-- Instanz wuerde sie deren Schemata ueberschreiben.

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      auth.jwt() ->> 'sub'
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.jwt() ->> 'role', ''),
    'anon'
  )
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to public;

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text not null,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
