import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';
import { verifyPassword } from '../../lib/password.js';
import { purgeExpiredRevocations, revokeToken } from '../../db/revocations.js';
import { expiryOf, ROLES, signToken, type AuthUser } from '../../lib/token.js';

/* Input contracts. Declared here because they describe what this service
 * accepts; the route mounts them as validation middleware. */

export const loginInput = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

/** What the API is willing to say about a user. Everything else on the row —
 *  the password hash above all — stays here. Declared as a schema so the
 *  OpenAPI document and the compiler agree on the shape. */
export const publicUser = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(ROLES),
});
export type PublicUser = z.infer<typeof publicUser>;

export const loginResponse = z.object({ token: z.string(), user: publicUser });

const toPublicUser = (user: typeof users.$inferSelect): PublicUser => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
});

export async function login({
  email,
  password,
}: LoginInput): Promise<{ token: string; user: PublicUser }> {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  // Same message and the same work either way, so neither the response nor how
  // long it took can be used to enumerate which accounts exist.
  const ok = await verifyPassword(password, user?.passwordHash);

  if (!user || !ok || !user.isActive) throw ApiError.unauthorized('Invalid email or password');

  // Stamped only on success, so the column means "last got in" rather than
  // "last tried". The Users screen shows it, and an account that has never
  // signed in shows nothing rather than a misleading date.
  await getDb().update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));

  return {
    token: signToken({ sub: user.id, email: user.email, role: user.role }),
    user: toPublicUser(user),
  };
}

/** Re-read from the database rather than trusting the token's claims: a user
 *  deactivated since their token was issued must stop being able to use it. */
export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive) throw ApiError.unauthorized();
  return toPublicUser(user);
}

/** Signing out.
 *
 *  Records this token as revoked so the middleware refuses it from here on. It
 *  does not touch the user's other sessions: a salesperson signing out of the
 *  till should not be signed out on their phone.
 *
 *  Idempotent — signing out twice is not an error, the second is already true.
 *  The sweep of expired revocations rides along here because sign-out is the
 *  only moment the table grows, which keeps the process free of a timer.
 */
export async function logout(user: AuthUser): Promise<{ revokedAt: string }> {
  await revokeToken(user.jti, user.sub, expiryOf(user));
  await purgeExpiredRevocations();
  return { revokedAt: new Date().toISOString() };
}

export const logoutResponse = z.object({ revokedAt: z.string() });
