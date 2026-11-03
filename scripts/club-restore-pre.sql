-- Restore helper (docs/TESTING.md 备份与恢复). Run between roles.sql and schema.sql.
-- Before schema.sql: stop new objects inheriting Supabase's default grants (pg_dump does not write REVOKE ... FROM anon).
-- schema.sql ends by setting the source project's default privileges again.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
