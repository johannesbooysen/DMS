-- =============================================================================
-- ROLLBACK zu 20261006120000_create_dms_schema.sql
-- -----------------------------------------------------------------------------
-- Manuell auszuführen. Die Supabase-CLI führt diese Datei nicht aus.
-- NUR in einer Entwicklungsumgebung und NUR, wenn die Vorab-Prüfung leer ist.
-- Eine Instanz mit echten Belegen wird nie zurückgerollt (Aufbewahrungspflicht).
-- =============================================================================

-- Vorab-Prüfung: alle Werte müssen 0 sein, sonst abbrechen.
SELECT
  (SELECT count(*) FROM dms.events)                                   AS events,
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'dms-files') AS files;

-- Umgekehrte Reihenfolge
DROP POLICY IF EXISTS "Admins and Mitarbeiter can upload dms-files" ON storage.objects;
DROP POLICY IF EXISTS "Users can view dms-files in own tenant" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'dms-files'
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'dms-files');

DROP FUNCTION IF EXISTS dms.log_event(UUID, TEXT, UUID, TEXT, JSONB);
DROP TABLE IF EXISTS dms.events;                 -- Trigger fallen mit der Tabelle
DROP FUNCTION IF EXISTS dms.prevent_event_mutation();
DROP SCHEMA IF EXISTS dms;                       -- ohne CASCADE: scheitert, wenn noch Objekte darin liegen
