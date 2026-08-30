import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Schema is owned here: Drizzle generates the SQL migrations under ./drizzle,
// which are committed and are the single source of truth. Never hand-edit them,
// and never copy them into the migration-scripts repo — that repo is for the
// Tally data migration and seeds only.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
  // Without this, drizzle-kit only introspects `public` and would treat every
  // table in `app` as missing — generating a duplicate CREATE on each run.
  schemaFilter: ['app'],
  // Migration bookkeeping stays out of `public` too.
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
  strict: true,
  verbose: true,
});
