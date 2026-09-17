import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import type { Db } from '../src/db/client.js';

let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(() => close());

describe('migrations', () => {
  it('applies the committed SQL cleanly', async () => {
    const { rows } = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from information_schema.tables where table_schema = 'app'`,
    );
    assert.equal(rows[0]!.count, '19');
  });

  it('creates nothing in the public schema', async () => {
    const { rows } = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from information_schema.tables where table_schema = 'public'`,
    );
    assert.equal(rows[0]!.count, '0', 'application tables must live in app, not public');
  });

  it('puts the enum types in app as well', async () => {
    const { rows } = await db.execute<{ nspname: string }>(
      sql`select n.nspname from pg_type t
          join pg_namespace n on n.oid = t.typnamespace
          where t.typname = 'user_role'`,
    );
    assert.equal(rows[0]!.nspname, 'app');
  });

  it('has no balance column anywhere', async () => {
    // The derived-balance rule from the discovery phase, enforced structurally:
    // if there is nothing to update, nothing can quietly update it.
    const { rows } = await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'app' and column_name in ('balance', 'current_balance', 'outstanding')
    `);
    assert.deepEqual(rows, []);
  });
});
