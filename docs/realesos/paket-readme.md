# Übergabepaket DMS → RealesOS

| Inhalt | Wohin im DMS-Repo |
|---|---|
| `CLAUDE.md` | Repo-Root (Vorgaben für Claude Code — verbindlich) |
| `INTEGRATION.md` | Repo-Root (Übergabe-Manifest, laufend pflegen) |
| `realesos-snapshot/` | Inhalt ins Repo-Root kopieren, Pfade beibehalten — nie ändern |
| `referenz/` | `package.json`, `tsconfig*`, `vite.config.ts` usw. — mit eigenen Dateien abgleichen |
| `supabase/baseline/…_realesos_public_baseline.sql` | `supabase/migrations/` als erste Migration (nur lokal/eigenes Projekt) |
| `vorlagen/supabase/…` | `supabase/migrations/`, `supabase/rollback/`, `supabase/tests/`, `config.toml` |

## Start in fünf Schritten

1. `CLAUDE.md`, `INTEGRATION.md` und `realesos-snapshot/*` ins Repo-Root kopieren.
2. Abhängigkeiten an `referenz/package.json` angleichen, Alias `@/*` → `./src/*` wie in `referenz/tsconfig.app.json`.
3. `supabase init` (falls nötig), `vorlagen/supabase/config.toml.snippet` in `supabase/config.toml` übernehmen, Basisschema und Startmigration nach `supabase/migrations/` kopieren, dann `supabase start` und `supabase db reset` (nur lokal).
4. Lokalen Nutzer registrieren, Testmandant/Profil/Rolle nach der Vorlage am Ende des Basisschemas anlegen. `.env` nach `referenz/.env.example`.
5. Prüfen: `psql "<lokale DB-URL>" -v ON_ERROR_STOP=1 -f supabase/tests/dms_rls_isolation.sql` muss „Alle DMS-RLS-Fälle bestanden" melden.

**Nie gegen eine RealesOS-Datenbank arbeiten.** Das Basisschema enthält keine Kundendaten.
