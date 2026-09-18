import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody, validateParams, validateQuery } from '../../lib/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Part brands. Requires purchasing or admin, the same as the catalogue they
 *  belong to. */
export const brandsRouter = Router();
brandsRouter.use(requireAuth, requireRole('purchasing', 'admin'));

brandsRouter.get(
  '/',
  validateQuery(service.listBrandsQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listBrands(res.locals.query as service.ListBrandsQuery));
  }),
);

brandsRouter.post(
  '/',
  validateBody(service.createBrandInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createBrand(req.body));
  }),
);

brandsRouter.patch(
  '/:id',
  validateParams(service.brandIdParam),
  validateBody(service.updateBrandInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.BrandIdParam;
    res.json(await service.updateBrand(id, req.body));
  }),
);
