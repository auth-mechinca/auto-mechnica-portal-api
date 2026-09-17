import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody, validateParams, validateQuery } from '../../lib/validate.js';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Section 3. Sales only — admin is included so the owner can demonstrate the
 *  till without a second login. */
export const posRouter = Router();
posRouter.use(requireAuth, requireRole('sales', 'admin'));

posRouter.get(
  '/parts',
  validateQuery(service.searchInput),
  asyncHandler(async (_req, res) => {
    res.json(await service.searchParts(res.locals.query as service.SearchInput));
  }),
);

posRouter.post(
  '/sales',
  validateBody(service.recordSaleInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.recordSale(req.body, currentUser(req).sub));
  }),
);

posRouter.get(
  '/sales/:id',
  validateParams(service.saleIdParam),
  asyncHandler(async (_req, res) => {
    const { id } = res.locals.params as service.SaleIdParam;
    res.json(await service.getSale(id));
  }),
);
