import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody, validateParams, validateQuery } from '../../lib/validate.js';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Section 4. Stock is received through purchase orders, never created here. */
export const imsRouter = Router();
imsRouter.use(requireAuth, requireRole('purchasing', 'admin'));

imsRouter.get(
  '/parts',
  validateQuery(service.listPartsQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listParts(res.locals.query as service.ListPartsQuery));
  }),
);

imsRouter.post(
  '/parts',
  validateBody(service.createPartInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPart(req.body));
  }),
);

imsRouter.get(
  '/parts/:id',
  validateParams(service.partIdParam),
  asyncHandler(async (_req, res) => {
    const { id } = res.locals.params as service.PartIdParam;
    res.json(await service.getPart(id));
  }),
);

imsRouter.patch(
  '/parts/:id',
  validateParams(service.partIdParam),
  validateBody(service.updatePartInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PartIdParam;
    res.json(await service.updatePart(id, req.body));
  }),
);

imsRouter.post(
  '/parts/:id/adjust',
  validateParams(service.partIdParam),
  validateBody(service.adjustStockInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PartIdParam;
    res.json(await service.adjustStock(id, req.body, currentUser(req).sub));
  }),
);

imsRouter.get(
  '/adjustments',
  asyncHandler(async (_req, res) => {
    res.json(await service.listAdjustments());
  }),
);

imsRouter.get(
  '/low-stock',
  asyncHandler(async (_req, res) => {
    res.json(await service.listLowStock());
  }),
);
