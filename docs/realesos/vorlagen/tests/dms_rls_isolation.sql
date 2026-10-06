-- =============================================================================
-- DMS — RLS- und Invarianten-Test (Vorlage)
-- -----------------------------------------------------------------------------
-- Läuft in einer Transaktion und rollt am Ende zurück — hinterlässt nichts.
-- Ausführen lokal: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/dms_rls_isolation.sql
-- Jede neue dms-Tabelle bekommt hier dieselben Fälle (1–4). Schlägt ein Fall fehl,
-- bricht das Skript mit einer deutschen Meldung ab.
-- =============================================================================
BEGIN;

-- Testdaten (als Datenbank-Owner, umgeht RLS)
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),   -- admin in Mandant A
  ('00000000-0000-0000-0000-0000000000a2'),   -- eigentuemer in Mandant A
  ('00000000-0000-0000-0000-0000000000b1');   -- admin in Mandant B

INSERT INTO public.tenants (id, name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Testmandant A'),
  ('00000000-0000-0000-0000-00000000000b', 'Testmandant B');

INSERT INTO public.profiles (id, tenant_id, name, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Admin A', 'a1@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'Eigentümer A', 'a2@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Admin B', 'b1@example.test');

INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'eigentuemer'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'admin');

INSERT INTO dms.events (tenant_id, entity_type, entity_id, action) VALUES
  ('00000000-0000-0000-0000-00000000000b', 'inbox_item', gen_random_uuid(), 'received');

-- Ab hier als Nutzer: admin in Mandant A
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- Fall 1: Mandant A sieht nichts aus Mandant B
DO $$ BEGIN
  IF (SELECT count(*) FROM dms.events) <> 0 THEN
    RAISE EXCEPTION 'Fall 1: Mandant A sieht Ereignisse aus Mandant B';
  END IF;
END $$;

-- Fall 2: Mandant A kann nicht in Mandant B schreiben
DO $$ BEGIN
  BEGIN
    PERFORM dms.log_event('00000000-0000-0000-0000-00000000000b', 'inbox_item', gen_random_uuid(), 'received');
    RAISE EXCEPTION 'Fall 2: Schreiben in fremden Mandanten war möglich';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Eigener Mandant funktioniert
DO $$ BEGIN
  PERFORM dms.log_event('00000000-0000-0000-0000-00000000000a', 'inbox_item', gen_random_uuid(), 'received');
  IF (SELECT count(*) FROM dms.events) <> 1 THEN
    RAISE EXCEPTION 'Eigener Mandant: Ereignis nicht sichtbar';
  END IF;
END $$;

-- Fall 3: Rolle ohne Schreibrecht (eigentuemer) kann nicht schreiben
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM dms.log_event('00000000-0000-0000-0000-00000000000a', 'inbox_item', gen_random_uuid(), 'received');
    RAISE EXCEPTION 'Fall 3: Eigentümer konnte schreiben';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Fall 4: Protokoll ist unveränderbar — auch für den Owner
RESET ROLE;
DO $$ BEGIN
  BEGIN
    UPDATE dms.events SET action = 'manipuliert';
    RAISE EXCEPTION 'Fall 4: UPDATE auf dms.events war möglich';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%unveränderbar%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM dms.events;
    RAISE EXCEPTION 'Fall 4: DELETE auf dms.events war möglich';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%unveränderbar%' THEN RAISE; END IF;
  END;
END $$;

SELECT 'Alle DMS-RLS-Fälle bestanden' AS ergebnis;
ROLLBACK;
