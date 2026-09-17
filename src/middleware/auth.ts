import type { RequestHandler } from 'express';
import { ApiError } from '../lib/http.js';
import { verifyToken, type AuthUser, type Role } from '../lib/token.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(ApiError.unauthorized());

  try {
    req.user = verifyToken(header.slice('Bearer '.length));
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
      return next(ApiError.forbidden(`This area requires one of: ${allowed.join(', ')}`));
    }
    next();
  };

/** The authenticated user, for a handler mounted behind `requireAuth`. Throws
 *  rather than returning undefined, so a route that forgot the middleware fails
 *  loudly instead of silently treating the request as anonymous. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}
