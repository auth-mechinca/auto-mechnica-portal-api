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

/* Categories and brands. The UI filters a dropdown against these as the officer
 * types, and offers to create one when nothing matches — which is a UI flow over
 * these two endpoints, not a special mode on either of them. */

imsRouter.get(
  '/categories',
  validateQuery(service.listTaxonomyQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listCategories(res.locals.query as service.ListTaxonomyQuery));
  }),
);

imsRouter.post(
  '/categories',
  validateBody(service.createTaxonomyInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createCategory(req.body));
  }),
);

imsRouter.patch(
  '/categories/:id',
  validateParams(service.taxonomyIdParam),
  validateBody(service.updateTaxonomyInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.TaxonomyIdParam;
    res.json(await service.updateCategory(id, req.body));
  }),
);

imsRouter.get(
  '/brands',
  validateQuery(service.listTaxonomyQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listBrands(res.locals.query as service.ListTaxonomyQuery));
  }),
);

imsRouter.post(
  '/brands',
  validateBody(service.createTaxonomyInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createBrand(req.body));
  }),
);

imsRouter.patch(
  '/brands/:id',
  validateParams(service.taxonomyIdParam),
  validateBody(service.updateTaxonomyInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.TaxonomyIdParam;
    res.json(await service.updateBrand(id, req.body));
  }),
);

imsRouter.get(
  '/low-stock',
  asyncHandler(async (_req, res) => {
    res.json(await service.listLowStock());
  }),
);
