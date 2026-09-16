import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/db/schema/index.js';
import { setDb, type Db } from '../../src/db/client.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle/', import.meta.url));

/** A real Postgres, in-process, with the committed migrations applied to it.
 *
 *  Deliberately not a mock: the point of these tests is that the generated SQL
 *  applies cleanly and that the constraints in it actually hold. A stubbed
 *  repository layer would prove neither.
 *
 *  The .sql files are executed directly rather than through Drizzle's migrator,
 *  so the tests assert what is committed in drizzle/ rather than re-deriving the
 *  schema from the TypeScript definitions it was generated from.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = await PGlite.create();

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error('No migrations found — run `npm run db:generate`');

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) await client.exec(statement);
    }
  }

  const db = drizzle(client, { schema }) as unknown as Db;
  setDb(db);

  return {
    db,
    close: async () => {
      setDb(null);
      await client.close();
    },
  };
}
