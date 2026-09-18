import { appSchema } from './schema.js';
import { boolean, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryKey, timestamps } from './common.js';
import { userRole } from './enums.js';

/** Role lives on the user row, and the row is the authority. It is copied into
 *  the JWT at login for convenience, but `requireAuth` re-reads it from here on
 *  every request and ignores the claim — so changing somebody's role, or
 *  switching their account off, takes effect on their very next request rather
 *  than whenever their token happens to expire. */
export const users = appSchema.table(
  'users',
  {
    id: primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    role: userRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    /** Stamped on a successful login. Null until they have signed in once, which
     *  is exactly what the Users screen shows for an account just created. */
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
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
