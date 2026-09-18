import type { RequestHandler } from 'express';
import { loadSession } from '../db/session.js';
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

  let claims: AuthUser;
  try {
    claims = verifyToken(header.slice('Bearer '.length));
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }

  // A valid signature is not the same as a live session, so the database is
  // asked on every request. It answers three things at once: has this token been
  // signed out, does the account still exist and is it still switched on, and —
  // the one that matters most — what is this person's role *now*.
  loadSession(claims.sub, claims.jti)
    .then(({ revoked, user }) => {
      if (revoked) return next(ApiError.unauthorized('This session has been signed out'));
      if (!user) return next(ApiError.unauthorized('This account no longer exists'));
      if (!user.isActive) return next(ApiError.unauthorized('This account has been deactivated'));

      // The role comes from the row, never from the claim. An admin who changes
      // somebody's role has changed it by their next request, which is what the
      // Users screen says happens — a token signed an hour ago cannot carry the
      // old permissions past this point.
      req.user = { ...claims, email: user.email, role: user.role };
      next();
    })
    .catch(next);
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
