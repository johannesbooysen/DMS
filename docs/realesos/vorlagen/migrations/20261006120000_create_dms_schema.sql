-- =============================================================================
-- DMS: Schema einrichten, Ereignisprotokoll (nur anhängend), Dateiablage
-- -----------------------------------------------------------------------------
-- Spec:     CLAUDE.md (RealesOS-Vorgaben) §5.1, §5.5, §5.6, §6
-- Rollback: supabase/rollback/20261006120000_rollback_create_dms_schema.sql
-- Muster:   RealesOS public.commission_ledger (nur anhängend, Trigger-Sperre),
--           RealesOS Bucket aufmass-media (privater Bucket, Mandant als erster Pfadordner)
--
-- Bewusste Abweichungen vom RealesOS-Standard:
--   * dms.events hat kein updated_at — die Tabelle ist unveränderbar.
--   * dms.events.tenant_id mit ON DELETE RESTRICT statt CASCADE — Aufbewahrungspflicht
--     (§ 147 AO). Den Lösch-Wächter auf public.tenants ergänzt RealesOS bei der Integration.
--   * dms.events.actor_id ohne Fremdschlüssel — ein ON DELETE SET NULL wäre ein UPDATE
--     und würde an der Unveränderbarkeits-Sperre scheitern. Stattdessen actor_name als
--     Momentaufnahme.
--
-- Tut NICHT: keine Fachtabellen (Rechnungen, Posteingang, Dateien) — die folgen in
-- eigenen Migrationen nach demselben Muster. Keine Änderung an Objekten in `public`.
-- =============================================================================

-- 1. Schema und Grundrechte ----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS dms;
COMMENT ON SCHEMA dms IS
  'DMS-Zusatzmodul: Eingangsrechnungen, Posteingang, Schriftverkehr. Verweist auf public, nie umgekehrt.';

GRANT USAGE ON SCHEMA dms TO authenticated, service_role;

-- Neue Tabellen und Funktionen in dms sind nicht automatisch für anon/PUBLIC offen.
-- Rechte an authenticated werden je Tabelle ausdrücklich vergeben.
ALTER DEFAULT PRIVILEGES IN SCHEMA dms REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA dms REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA dms GRANT ALL ON TABLES TO service_role;

-- 2. Ereignisprotokoll -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dms.events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL,
  actor_id    UUID,
  actor_name  TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE dms.events IS
  'Unveränderbares Ereignisprotokoll des DMS (GoBD): wer hat wann was an welchem Dokument getan. Schreiben nur über dms.log_event(); UPDATE, DELETE und TRUNCATE sind gesperrt.';
COMMENT ON COLUMN dms.events.entity_type IS 'Art des betroffenen Datensatzes, z. B. incoming_invoice, inbox_item, stored_file.';
COMMENT ON COLUMN dms.events.action IS 'Ereignis, z. B. received, assigned, verified, approved, retention_locked.';
COMMENT ON COLUMN dms.events.actor_id IS 'auth.users.id des Handelnden; NULL bei Systemereignissen (Edge Function). Bewusst ohne Fremdschlüssel.';
COMMENT ON COLUMN dms.events.actor_name IS 'Name des Handelnden zum Zeitpunkt des Ereignisses (Momentaufnahme).';
COMMENT ON COLUMN dms.events.payload IS 'Vorher/Nachher oder Zusatzangaben. Keine Dateiinhalte, keine Secrets.';

CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON dms.events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_entity ON dms.events (entity_type, entity_id);

-- 2a. Sperre gegen Änderung und Löschung
CREATE OR REPLACE FUNCTION dms.prevent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Das DMS-Ereignisprotokoll ist unveränderbar (GoBD). Korrekturen erfolgen als neuer Eintrag.'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE TRIGGER trg_events_no_update_delete
  BEFORE UPDATE OR DELETE ON dms.events
  FOR EACH ROW EXECUTE FUNCTION dms.prevent_event_mutation();

CREATE OR REPLACE TRIGGER trg_events_no_truncate
  BEFORE TRUNCATE ON dms.events
  FOR EACH STATEMENT EXECUTE FUNCTION dms.prevent_event_mutation();

-- 2b. Schreiben ausschließlich über diese Funktion
CREATE OR REPLACE FUNCTION dms.log_event(
  p_tenant_id   UUID,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_action      TEXT,
  p_payload     JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := (select auth.uid());
  v_name TEXT;
  v_id   UUID;
BEGIN
  -- Edge Functions rufen mit service_role auf und haben keinen Nutzer; alle anderen
  -- dürfen nur im eigenen Mandanten und nur als admin/mitarbeiter protokollieren.
  IF auth.role() <> 'service_role' THEN
    IF v_uid IS NULL OR p_tenant_id IS DISTINCT FROM public.get_user_tenant_id(v_uid) THEN
      RAISE EXCEPTION 'Kein Zugriff auf diesen Mandanten' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.has_role(v_uid, p_tenant_id, 'admin'::app_role)
         OR public.has_role(v_uid, p_tenant_id, 'mitarbeiter'::app_role)) THEN
      RAISE EXCEPTION 'Keine Berechtigung für diese Aktion' USING ERRCODE = '42501';
    END IF;
    SELECT name INTO v_name FROM public.profiles WHERE id = v_uid;
  END IF;

  INSERT INTO dms.events (tenant_id, entity_type, entity_id, action, actor_id, actor_name, payload)
  VALUES (p_tenant_id, p_entity_type, p_entity_id, p_action, v_uid, v_name, coalesce(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION dms.log_event(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dms.log_event(UUID, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION dms.prevent_event_mutation() FROM PUBLIC, anon, authenticated;

-- 2c. RLS: nur Lesen im eigenen Mandanten, keine Schreib-Policy
ALTER TABLE dms.events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'dms' AND tablename = 'events'
                 AND policyname = 'Users can view events in own tenant') THEN
    CREATE POLICY "Users can view events in own tenant" ON dms.events
      FOR SELECT
      USING (tenant_id = public.get_user_tenant_id((select auth.uid())));
  END IF;
END $$;

GRANT SELECT ON dms.events TO authenticated;

-- 3. Dateiablage -------------------------------------------------------------------
-- Pfad: {tenant_id}/{yyyy}/{mm}/{uuid}.{ext}. Originale sind unveränderbar: keine
-- UPDATE- oder DELETE-Policy für authenticated. Auslieferung nur über Signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dms-files', 'dms-files', false, 26214400,
  ARRAY['application/pdf', 'application/xml', 'text/xml', 'image/jpeg', 'image/png', 'image/tiff', 'message/rfc822']
)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets SET public = false WHERE id = 'dms-files' AND public = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'Users can view dms-files in own tenant') THEN
    CREATE POLICY "Users can view dms-files in own tenant" ON storage.objects
      FOR SELECT
      USING (bucket_id = 'dms-files'
        AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::TEXT);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'Admins and Mitarbeiter can upload dms-files') THEN
    CREATE POLICY "Admins and Mitarbeiter can upload dms-files" ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'dms-files'
        AND (storage.foldername(name))[1] = public.get_user_tenant_id((select auth.uid()))::TEXT
        AND (public.has_role((select auth.uid()), public.get_user_tenant_id((select auth.uid())), 'admin'::app_role)
          OR public.has_role((select auth.uid()), public.get_user_tenant_id((select auth.uid())), 'mitarbeiter'::app_role)));
  END IF;
END $$;
