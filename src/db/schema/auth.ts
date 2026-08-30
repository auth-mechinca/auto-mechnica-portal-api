import { appSchema } from './schema.js';
import { boolean, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryKey, timestamps } from './common.js';
import { userRole } from './enums.js';

/** Role lives on the user row and is copied into the JWT at login. The token is a
 *  cache, not the authority — `requireRole` re-reads nothing, but any role change
 *  should invalidate outstanding tokens (out of scope for the demo). */
export const users = appSchema.table(
  'users',
  {
    id: primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    role: userRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(t.email)],
);
