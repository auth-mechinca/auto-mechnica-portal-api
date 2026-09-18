# auto-mechnica-portal-api

Express + TypeScript API for the Auto Mechanica demo.

| Document | |
|---|---|
| [`docs/demo-scope.md`](docs/demo-scope.md) | The scope of record — what was agreed. Section numbers in code comments point here |
| [`docs/build-progress.md`](docs/build-progress.md) | What actually exists, what is still open, and what is next |

They live in this repo so that a decision and the code implementing it move
together.

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
| `npm run db:setup` | `db:up` + `db:migrate` + `db:grant` + `db:seed` — the one to run first |
| `npm run db:seed` | Demo data: four logins, parts, prices, stock, one open PO |
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
    auth.ts            requireAuth, requireRole, currentUser
    error.ts           ApiError/ZodError -> JSON, everything else -> 500
  lib/
    http.ts            ApiError, asyncHandler
    token.ts           JWT sign/verify and the role list
    password.ts        hashing, and the constant-work verify
    validate.ts        validateBody
  modules/
    auth/ pos/ ims/ financial/ backoffice/
      routes.ts        wiring
      service.ts       logic
seeds/                 demo data; outside src/, so never compiled into dist
  data.ts              the figures — edit here
  money.ts             exact decimal arithmetic
  index.ts             idempotent runner
```

### Module pattern

Every module is two files, and the split is strict:

| File | Holds | Must not hold |
|---|---|---|
| `routes.ts` | The router, role middleware, validation middleware, and the one line that calls the service | Any business rule, any query, any conditional |
| `service.ts` | Business logic, database access, and the module's input schemas | `req`, `res`, `next`, status codes, or anything Express |

```ts
// routes.ts — wiring only
authRouter.post(
  '/login',
  validateBody(service.loginInput),
  asyncHandler(async (req, res) => {
    res.json(await service.login(req.body));
  }),
);
```

A service takes plain values, returns plain values, and signals failure by
throwing `ApiError`. The error middleware turns that into a status code, so the
service never picks one. That is what keeps the logic callable from a seed
script, a test, or a future job runner without faking a request object.

Input schemas live in `service.ts` because they describe what the service
accepts; the route mounts them with `validateBody`, so validation stays
middleware and the handler receives exactly what the schema describes.

Business logic stays off the ORM's happy path where money is involved — anything
touching stock or money takes a `Tx`, not a `Db`, so it cannot run outside a
transaction.

## Signing out

A JWT is valid until it expires, and presenting one asks the server nothing — so
a client-side "logout" is only the client agreeing to forget the token. Anyone
who copied it keeps the session. On a till shared by a shift, that is a real
hole.

`POST /api/auth/logout` therefore records the token's `jti` in `app.revoked_tokens`,
and `requireAuth` checks that list on every request. Only that token is revoked:
signing out at the counter does not sign the same person out on another device.

The cost is one primary-key lookup per authenticated request. That is affordable
because the API runs as a persistent process beside Postgres — the same decision
that kept PgBouncer out of the picture. Revocations are swept when they expire,
on sign-out, since that is the only moment the table grows and it keeps the
process free of a background timer.

## RBAC

Roles: `sales`, `purchasing`, `accountant`, `admin`.

`requireRole(...)` is applied as **router-level** middleware in each module, not
per-handler, so a newly added endpoint inherits the check rather than needing to
remember it. This is what makes the demo's RBAC claim true: a `sales` token
requesting any `/api/backoffice/*` path is refused by the API with a 403, not
merely hidden from the navigation.

## API documentation

```
http://localhost:4000/docs          Swagger UI
http://localhost:4000/openapi.json  the document itself
```

OpenAPI 3.1, **generated from the same zod schemas the API validates and returns**
— `src/openapi.ts` reads the schemas the services already export, so a changed
schema changes the document on the next boot. Response types are inferred from
those schemas (`type Receipt = z.infer<typeof receipt>`), which means a handler
returning the wrong shape fails to compile rather than quietly contradicting the
docs.

Zod 4 emits JSON Schema natively, so there is no conversion library in the
dependency tree. `io: 'input'` and `io: 'output'` are passed separately: a field
with a default is optional to a caller but always present in a response, and one
schema for both would misdescribe one of them.

Both routes are unauthenticated — the document describes the shape of the API,
not its data. Use **Authorize** in the UI with a token from `POST /api/auth/login`
to try the protected endpoints.

Only implemented endpoints are described. The IMS, Financial and Backoffice
routers are mounted and enforce their roles but have no handlers; documenting
them would promise a 404. `test/openapi.test.ts` asserts both halves of that —
every documented path exists, and no unimplemented module appears.

## Demo data

`npm run db:seed` is idempotent — catalogue, users, prices and settings upsert on
their natural keys, so running it twice changes nothing. It connects as the
ordinary application role, not the migration role, so a missing grant fails here
rather than in production.

Four logins, all with password `demo1234`: `sales@demo`, `purchasing@demo`,
`accounts@demo`, `admin@demo`. Plus 8 parts with prices, stock and a price
history row, 2 suppliers, 3 customers, and `PO-2026-0007` left **sent and
unreceived** — the starting point of the demo's central story. Its FX rate is
13.20 against the 12.50 the existing stock was bought at, so receiving it visibly
moves the landed cost and the till price rather than reproducing them.

Landed costs and suggested prices are computed in `seeds/money.ts`, never typed
in, so the seed cannot disagree with what `receiveStock` will later calculate.
That arithmetic runs on scaled integers: `18.40 * 12.5` in floating point is
`229.99999999999997`.

Stock is the one part that is not fully idempotent — balances reset to their
opening figures and the opening movement is written once, so re-seeding a
database that has since recorded sales leaves the ledger and the balance
disagreeing. Run it after `db:reset` for a clean history; that is the normal case.

## Tests

```bash
npm test        # 204 tests
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
| `test/password.test.ts` | Hash cost, and that an unknown account costs the same work as a wrong password |
| `test/money-arithmetic.test.ts` | Exact multiply, add, subtract and compare — every price and balance goes through these |
| `test/pos-sale.test.ts` | The sale transaction: pricing, stock, rollback, payment methods, invoice numbering, due dates |
| `test/pos-search.test.ts` | Part search, and that no cost figure is ever returned to a Sales session |
| `test/openapi.test.ts` | Every documented path exists, every $ref resolves, no unimplemented module is promised |
| `test/receive-stock.test.ts` | The purchase chain, asserted against the exact figures on the wireframes |
| `test/price-review.test.ts` | What an overridden price does when the same part is bought again at a new cost |
| `test/logout.test.ts` | That a signed-out token actually stops working, everywhere, without affecting other sessions |
| `test/price-management.test.ts` | Derived price statuses, cost basis, and that changing the margin does not reprice saved decisions |
| `test/financial-core.test.ts` | Derived balances, ageing by due date, and the cheque lifecycle including a bounce |
| `test/financial-http.test.ts` | The receivables endpoints and who may reach them |
| `test/suppliers-po-create.test.ts` | Supplier deactivation, and a draft PO gaining a rate on its way to being sent |
| `test/po-short-close.test.ts` | Writing off a short delivery without disturbing what arrived |
| `test/ims-catalogue.test.ts` | Parts, filters, and that no path through the catalogue can set stock |
| `test/ims-stock.test.ts` | Adjustments with reasons, the running ledger, and low stock |
| `test/ims-taxonomy.test.ts` | That two spellings of one category cannot both exist, and that renaming reaches every part |
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
