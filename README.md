# auto-mechnica-portal-api

Express + TypeScript API for the Auto Mechanica demo. Scope lives in
`Demo Scope - Auto-Parts Business System.md` in the parent directory; section
numbers referenced in code comments point at that document.

## Deployment shape

This runs as a **persistent Node process on the same host as Postgres** — not on
Vercel serverless. That decision is load-bearing: it is why `src/db/client.ts`
opens a normal long-lived pool instead of routing through PgBouncer with a pool
size of 1, and it keeps POS queries off a Ghana → Europe round trip. Vercel hosts
the Next.js frontend only.

## Schema ownership

Drizzle owns the schema. The TypeScript definitions in `src/db/schema/` are
authored by hand; the SQL in `drizzle/` is **generated** and committed.

- Never hand-edit a file in `drizzle/`.
- Never copy these migrations into the `migration-scripts` repo. That repo is for
  the Tally data migration and seed data, not a mirror of this one.

```bash
npm run db:generate    # schema change -> new SQL migration
npm run db:migrate     # apply pending migrations
```

Migrations run as `MIGRATION_DATABASE_URL`, a DDL-privileged user. The app's own
`DATABASE_URL` user should have no DDL rights, so the running API structurally
cannot alter the schema.

### Nothing lives in `public`

Every table, enum and index is created in the **`app`** schema, declared once in
`src/db/schema/schema.ts`. `public` stays empty, and drizzle-kit's own bookkeeping
table sits in a separate `drizzle` schema.

`public` is writable by any role by default on older Postgres, sits on every
role's default search_path, and is where extensions and stray psql experiments
land. Keeping application objects in their own namespace means "what belongs to
this app" is one query, and a polluted `public` cannot take the app with it.

Two consequences worth knowing:

- `drizzle.config.ts` sets `schemaFilter: ['app']`. Without it drizzle-kit only
  introspects `public`, decides every table is missing, and regenerates a
  duplicate `CREATE` on every run.
- Database bootstrap (run once, as a superuser, before the first migration):

  ```sql
  CREATE DATABASE auto_mechanica;
  \c auto_mechanica
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  CREATE ROLE auto_mechanica_migrator LOGIN PASSWORD '...';
  CREATE ROLE auto_mechanica_app      LOGIN PASSWORD '...';
  GRANT CREATE, USAGE ON DATABASE auto_mechanica TO auto_mechanica_migrator;
  ALTER ROLE auto_mechanica_app SET search_path = app;
  ```

  The `app` schema itself is created by the first migration, not by hand — it is
  in `drizzle/0000_init_demo_schema.sql`. Grants for `auto_mechanica_app` on the
  tables (SELECT/INSERT/UPDATE, no DDL) belong in the bootstrap script in the
  `migration-scripts` repo alongside the seeds.

### On future multi-tenancy

A named schema is the right shape now, but it is not a commitment to
schema-per-tenant. If this becomes the multi-tenant SaaS, prefer row-level
tenancy — a `tenant_id` column plus RLS — over a schema per customer, which
multiplies every migration by the number of customers. The `app` schema is
compatible with that; it just means "this application's objects".

## Getting started

```bash
cp .env.example .env
npm install
npm run db:setup    # starts Postgres in Docker, migrates, grants
npm run dev
```

The defaults in `.env.example` match `docker-compose.yml`, so this works with no
edits locally. Change `JWT_SECRET` and both passwords for anything that is not
localhost.

## Local database

`docker-compose.yml` runs Postgres 17 for development only — production Postgres
runs directly on the VPS next to the API process, which is the whole point of the
hosting decision. The tests do not use it at all; they run against PGlite
in-process.

| Script | Does |
|---|---|
| `npm run db:up` | Start Postgres, wait until healthy |
| `npm run db:setup` | `db:up` + `db:migrate` + `db:grant` — the one to run first |
| `npm run db:grant` | Grant the app role USAGE on `app` (see below) |
| `npm run db:psql` | psql shell as the migration role |
| `npm run db:down` | Stop the container, keep the data |
| `npm run db:reset` | Drop the volume and rebuild from scratch |

The container mirrors the production role split rather than running everything as
one superuser, so a privilege mistake shows up locally instead of on the VPS:

- The container superuser **is** the migration role. It owns the schema and is the
  only account with DDL rights.
- `docker/initdb/01-roles.sh` runs once on an empty volume: it revokes `public`,
  creates `auto_mechanica_app`, pins its `search_path` to `app`, and sets default
  privileges so future migrations do not need a matching grant remembered by hand.
- `docker/grant-app.sql` runs after the first migration. USAGE on a schema cannot
  be granted before the schema exists, and migration `0000` is what creates `app`
  — so that one grant cannot live in the init script.

Verified on a fresh volume: 17 tables in `app`, none in `public`, and the app role
can SELECT and INSERT but is denied `CREATE TABLE`, `DROP TABLE`, and any write to
`public`.

## Layout

```
src/
  config/env.ts        validated at boot; missing config fails fast
  db/
    client.ts          pool + drizzle instance, exports Db and Tx types
    schema/            one file per domain, all re-exported from index.ts
  middleware/
    auth.ts            requireAuth + requireRole
    error.ts           ApiError/ZodError -> JSON, everything else -> 500
  lib/http.ts          ApiError, asyncHandler
  modules/
    auth/ pos/ ims/ financial/ backoffice/
```

Business logic stays out of route handlers and off the ORM's happy path where
money is involved — anything touching stock or money takes a `Tx`, not a `Db`, so
it cannot run outside a transaction.

## RBAC

Roles: `sales`, `purchasing`, `accountant`, `admin`.

`requireRole(...)` is applied as **router-level** middleware in each module, not
per-handler, so a newly added endpoint inherits the check rather than needing to
remember it. This is what makes the demo's RBAC claim true: a `sales` token
requesting any `/api/backoffice/*` path is refused by the API with a 403, not
merely hidden from the navigation.

## Tests

```bash
npm test        # 43 tests
npm run typecheck
```

Tests run against **PGlite** — a real Postgres compiled to WebAssembly, in
process. No Docker, no server, nothing to install. Each test file gets its own
database with `drizzle/*.sql` applied to it, so the tests assert what is actually
committed in `drizzle/` rather than re-deriving the schema from the TypeScript it
was generated from. Nothing is mocked: a constraint test fails only if the
constraint is genuinely missing.

| File | Covers |
|---|---|
| `test/rbac.test.ts` | Every role against every module router, plus forged tokens, unknown roles, and a role smuggled in a request body |
| `test/auth.test.ts` | Login for the four demo accounts, case-insensitive email, deactivated users, and account enumeration |
| `test/migrations.test.ts` | Migration applies cleanly, 17 tables in `app`, nothing in `public`, no balance column anywhere |
| `test/money.test.ts` | GHS returned as exact strings, FX scale, and landed cost = USD x rate |
| `test/constraints.test.ts` | Duplicate SKU, dangling FK, duplicate balance per part/location |

Two things about the runner, both deliberate:

- `--test-concurrency=1`. Each file starts its own in-process Postgres; running
  several at once is slower and less reliable.
- Database-backed suites are kept in separate files rather than grouped into one.
  A single file holding all three database suites deadlocks `node:test` before it
  runs anything — the module registers fully, then nothing executes. Splitting
  them also gives each suite a clean database, so the tests do not depend on each
  other's leftover rows.

## Known advisory

`npm audit` reports a moderate esbuild advisory reachable only through
`drizzle-kit`. It affects the esbuild dev server, is a devDependency, and is not
present at runtime. The offered fix downgrades drizzle-kit to 0.18.1, which is
far older than the schema syntax used here — not worth taking.
