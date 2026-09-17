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
