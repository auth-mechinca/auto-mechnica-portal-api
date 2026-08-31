import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import { ApiError, asyncHandler } from '../../lib/http.js';
import { requireAuth, signToken } from '../../middleware/auth.js';
import { verifyPassword } from '../../lib/password.js';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);

    const [user] = await getDb()
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    // Same message and the same work either way, so neither the response nor how
    // long it took can be used to enumerate which accounts exist.
    const ok = await verifyPassword(password, user?.passwordHash);

    if (!user || !ok || !user.isActive) throw ApiError.unauthorized('Invalid email or password');

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    res.json({
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    });
  }),
);

/** The frontend calls this on load to decide which navigation to render. The
 *  answer is advisory — every protected route re-checks the role server-side. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await getDb().select().from(users).where(eq(users.id, req.user!.sub)).limit(1);
    if (!user || !user.isActive) throw ApiError.unauthorized();
    res.json({ id: user.id, email: user.email, fullName: user.fullName, role: user.role });
  }),
);
