import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody } from '../../lib/validate.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import * as service from './service.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  validateBody(service.loginInput),
  asyncHandler(async (req, res) => {
    res.json(await service.login(req.body));
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.logout(currentUser(req)));
  }),
);

/** The frontend calls this on load to decide which navigation to render. The
 *  answer is advisory — every protected route re-checks the role server-side. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.getCurrentUser(currentUser(req).sub));
  }),
);
