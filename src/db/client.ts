import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

/** The type handed to code running inside `db.transaction(...)`. Anything that
 *  writes money or stock should take this, not `Db`, so it cannot accidentally
 *  run outside the transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let pool: pg.Pool | null = null;
let instance: Db | null = null;

/** Lazily built, so importing a route module does not open a socket. That matters
 *  for tests, and it means a config problem surfaces at first use rather than at
 *  import time in an unrelated file. */
export function getDb(): Db {
  if (instance) return instance;

  // A normal long-lived pool. This API runs as a persistent process on the same
  // host as Postgres — that decision is what lets us skip PgBouncer and a pool
  // size of 1, which is what serverless would have forced.
  pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
  });
  instance = drizzle(pool, { schema });
  return instance;
}

/** Test seam: point the app at an in-process database. Not used in production. */
export function setDb(next: Db | null): void {
  instance = next;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  instance = null;
}
