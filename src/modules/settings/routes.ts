import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody } from '../../lib/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Admin only, matching the screen. The margin here prices the whole catalogue,
 *  so purchasing does not get to move it — which it could while this hung off
 *  the backoffice router. */
export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireRole('admin'));

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await service.getSettings());
  }),
);

settingsRouter.patch(
  '/',
  validateBody(service.updateSettingsInput),
  asyncHandler(async (req, res) => {
    res.json(await service.updateSettings(req.body));
  }),
);
