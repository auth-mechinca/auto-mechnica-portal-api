import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';

/** Token concerns live here rather than in the auth middleware so that a service
 *  can issue a token without importing an Express middleware module. The
 *  middleware consumes this; it does not own it. */

export const ROLES = ['sales', 'purchasing', 'accountant', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** What a caller asks to have signed. */
export type TokenSubject = {
  sub: string;
  email: string;
  role: Role;
};

const claims = z.object({
  sub: z.string().uuid(),
  email: z.string(),
  role: z.enum(ROLES),
  /** This token's own id. Signing out records it as revoked, which is the only
   *  way to stop a JWT that is otherwise still validly signed. */
  jti: z.string().uuid(),
  /** Seconds since the epoch, added by the signer. Needed so a revocation row
   *  can be swept once the token would have expired anyway. */
  exp: z.number(),
});

export type AuthUser = z.infer<typeof claims>;

export function signToken(subject: TokenSubject): string {
  return jwt.sign(subject, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    jwtid: randomUUID(),
  });
}

/** Throws if the signature is wrong, the token has expired, or the claims are not
 *  the shape we issue — a correctly signed token carrying `role: "superuser"` is
 *  rejected here rather than trusted downstream.
 *
 *  Says nothing about revocation: that needs the database, and this module
 *  deliberately has no opinion about where state lives. */
export function verifyToken(raw: string): AuthUser {
  return claims.parse(jwt.verify(raw, env.JWT_SECRET));
}

/** `exp` as a Date, for storing alongside a revocation. */
export const expiryOf = (user: AuthUser): Date => new Date(user.exp * 1000);
