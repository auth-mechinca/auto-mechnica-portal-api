-- Run after the first migration creates the `app` schema.
--
-- USAGE on a schema cannot be granted before the schema exists, and migration
-- 0000 is what creates it — so this one grant cannot live in the init script.
-- The table grants are already covered by ALTER DEFAULT PRIVILEGES; they are
-- repeated here so the script is safe to run against a database migrated before
-- those defaults were in place.
GRANT USAGE ON SCHEMA app TO auto_mechanica_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO auto_mechanica_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO auto_mechanica_app;
