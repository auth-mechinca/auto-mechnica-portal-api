import { pgSchema } from 'drizzle-orm/pg-core';

/** Every table, enum and index in this API lives here — nothing is created in
 *  `public`.
 *
 *  Why: `public` is writable by any role by default on older Postgres, it is on
 *  every role's default search_path, and it is where extensions and stray
 *  psql experiments land. Keeping the application's objects in their own
 *  namespace means "what belongs to this app" is answerable with one query, and
 *  a dropped or polluted `public` cannot take the application with it.
 *
 *  Change the name here and it changes everywhere — no table file names it.
 */
export const appSchema = pgSchema('app');
