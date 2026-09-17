import { appSchema } from './schema.js';
import { boolean, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

/** Signing out has to be recorded somewhere, because a JWT is valid until it
 *  expires and nothing about presenting it asks this server for permission.
 *  A token listed here is refused even though its signature is still good.
 *
 *  Keyed by the token's own `jti`, so signing out on the till revokes that
 *  session and not the same person's other device.
 *
 *  Rows are only worth keeping until the token would have expired anyway —
 *  after that the signature check refuses it without help — so `expiresAt`
 *  exists to let them be swept up rather than to be read.
 */
export const revokedTokens = appSchema.table(
  'revoked_tokens',
  {
    jti: uuid('jti').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('revoked_tokens_expires_at_idx').on(t.expiresAt)],
);
