import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../lib/http.js';

export const ROLES = ['sales', 'purchasing', 'accountant', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const claims = z.object({
  sub: z.string().uuid(),
  email: z.string(),
  role: z.enum(ROLES),
});

export type AuthUser = z.infer<typeof claims>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(ApiError.unauthorized());

  try {
    const decoded = jwt.verify(header.slice('Bearer '.length), env.JWT_SECRET);
    req.user = claims.parse(decoded);
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'));
  }
};

/** The whole point of the RBAC demo: this runs on the server for every request,
 *  so a Sales account typing /backoffice/... into the URL bar is refused by the
 *  API, not merely by a hidden nav item. Mount it on the router, not per-handler,
 *  so a new route cannot be added without inheriting a role check.
 *
 *  Admin is not special-cased here — it is listed explicitly wherever it applies,
 *  so that reading a router tells you exactly who can reach it. */
export const requireRole =
  (...allowed: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden(`This area requires one of: ${allowed.join(', ')}`),
      );
    }
    next();
  };
