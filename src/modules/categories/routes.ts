import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody, validateParams, validateQuery } from '../../lib/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Part categories. Requires purchasing or admin, the same as the catalogue they
 *  classify. */
export const categoriesRouter = Router();
categoriesRouter.use(requireAuth, requireRole('purchasing', 'admin'));

categoriesRouter.get(
  '/',
  validateQuery(service.listCategoriesQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listCategories(res.locals.query as service.ListCategoriesQuery));
  }),
);

categoriesRouter.post(
  '/',
  validateBody(service.createCategoryInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createCategory(req.body));
  }),
);

categoriesRouter.patch(
  '/:id',
  validateParams(service.categoryIdParam),
  validateBody(service.updateCategoryInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.CategoryIdParam;
    res.json(await service.updateCategory(id, req.body));
  }),
);
