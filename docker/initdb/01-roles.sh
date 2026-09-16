#!/bin/sh
# Runs once, the first time the data directory is initialised.
#
# Mirrors the bootstrap the production VPS needs: the app gets its own role with
# no DDL rights, and `public` is locked down. Passwords here are development-only
# and are set from docker-compose.yml.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  -- Nothing should be created in public; make that true rather than merely intended.
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  CREATE ROLE "$APP_DB_USER" LOGIN PASSWORD '$APP_DB_PASSWORD';

  -- Objects are fully schema-qualified by Drizzle, but this keeps hand-run psql
  -- sessions on this role honest.
  ALTER ROLE "$APP_DB_USER" SET search_path = app;

  -- Applies to tables the migration role creates from here on, in any schema, so
  -- a future migration does not need a matching grant remembered by hand.
  ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER"
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "$APP_DB_USER";
  ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER"
    GRANT USAGE, SELECT ON SEQUENCES TO "$APP_DB_USER";
SQL
