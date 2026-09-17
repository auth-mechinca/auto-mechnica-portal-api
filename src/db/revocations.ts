import { eq, lt } from 'drizzle-orm';
import { getDb } from './client.js';
import { revokedTokens } from './schema/index.js';

/** The list of tokens that have been signed out.
 *
 *  This is the price of being able to sign out at all. A JWT is self-contained:
 *  presenting one asks this server nothing, so without some server-side record
 *  a "logout" is only the client agreeing to forget the token, and anyone who
 *  copied it keeps the session until it expires. On a shared till that is a real
 *  hole, not a theoretical one.
 *
 *  The cost is one primary-key lookup per authenticated request. That is
 *  affordable here precisely because the API runs as a persistent process beside
 *  Postgres — the same decision that removed PgBouncer from the picture.
 */

export async function isRevoked(jti: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ jti: revokedTokens.jti })
    .from(revokedTokens)
    .where(eq(revokedTokens.jti, jti))
    .limit(1);

  return row !== undefined;
}

export async function revokeToken(
  jti: string,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  await getDb()
    .insert(revokedTokens)
    .values({ jti, userId, expiresAt })
    // Signing out twice is not an error; the second is simply already true.
    .onConflictDoNothing({ target: revokedTokens.jti });
}

/** Once a token is past its expiry the signature check refuses it unaided, so
 *  the row has no further work to do. Swept on sign-out rather than on a timer:
 *  it is the only moment the table grows, and it keeps the process free of
 *  background jobs. */
export async function purgeExpiredRevocations(): Promise<number> {
  const deleted = await getDb()
    .delete(revokedTokens)
    .where(lt(revokedTokens.expiresAt, new Date()))
    .returning({ jti: revokedTokens.jti });

  return deleted.length;
}
