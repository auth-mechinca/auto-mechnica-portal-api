import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';
import { verifyPassword } from '../../lib/password.js';
import { signToken } from '../../lib/token.js';

/* Input contracts. Declared here because they describe what this service
 * accepts; the route mounts them as validation middleware. */

export const loginInput = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

/** What the API is willing to say about a user. Everything else on the row —
 *  the password hash above all — stays here. */
type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: (typeof users.$inferSelect)['role'];
};

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
