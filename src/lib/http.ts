import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    override readonly message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest = (m: string) => new ApiError(400, m, 'BAD_REQUEST');
  static unauthorized = (m = 'Authentication required') => new ApiError(401, m, 'UNAUTHENTICATED');
  static forbidden = (m = 'You do not have access to this resource') =>
    new ApiError(403, m, 'FORBIDDEN');
  static notFound = (m = 'Not found') => new ApiError(404, m, 'NOT_FOUND');
  static conflict = (m: string) => new ApiError(409, m, 'CONFLICT');
}

/** Express 5 forwards rejected promises to the error handler on its own, but this
 *  keeps the intent explicit at each route and survives a downgrade. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
