import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/** Validation is middleware, so it belongs on the route rather than inside the
 *  service. The service still declares the schema — it owns its own input
 *  contract — and the route mounts it here.
 *
 *  On success the parsed (and coerced) value replaces the raw one, so the
 *  handler receives exactly what the schema describes. On failure the ZodError
 *  goes to the error handler, which renders it as a 400 VALIDATION_ERROR. */
export const validateBody =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };

/** Same idea for the query string.
 *
 *  The result goes to `res.locals` rather than back onto `req.query`, which
 *  Express 5 exposes as a getter with no setter. Express's types cannot carry a
 *  generic through middleware, so the handler asserts the type it asked for —
 *  that assertion is the one place this pattern needs a cast, and it is true by
 *  construction because the schema mounted here produced the value. */
export const validateQuery =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    res.locals.query = result.data;
    next();
  };

/** And for route parameters — an id in the path is still untrusted input, and a
 *  malformed uuid should be a 400 from the edge rather than a database error
 *  surfacing from three layers down. */
export const validateParams =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return next(result.error);
    res.locals.params = result.data;
    next();
  };
