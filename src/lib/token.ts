import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';

/** Token concerns live here rather than in the auth middleware so that a service
 *  can issue a token without importing an Express middleware module. The
 *  middleware consumes this; it does not own it. */

export const ROLES = ['sales', 'purchasing', 'accountant', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const claims = z.object({
  sub: z.string().uuid(),
  email: z.string(),
  role: z.enum(ROLES),
});

export type AuthUser = z.infer<typeof claims>;

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Throws if the signature is wrong, the token has expired, or the claims are not
 *  the shape we issue — a correctly signed token carrying `role: "superuser"` is
 *  rejected here rather than trusted downstream. */
export function verifyToken(raw: string): AuthUser {
  return claims.parse(jwt.verify(raw, env.JWT_SECRET));
}
