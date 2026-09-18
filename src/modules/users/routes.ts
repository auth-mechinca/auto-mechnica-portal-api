import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody, validateParams } from '../../lib/validate.js';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Admin only, matching the screen. Who may reach what is decided by the
 *  `requireRole` on each router; this module only decides who somebody is. */
export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('admin'));

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await service.listUsers());
  }),
);

usersRouter.get(
  '/:id',
  validateParams(service.userIdParam),
  asyncHandler(async (_req, res) => {
    const { id } = res.locals.params as service.UserIdParam;
    res.json(await service.getUser(id));
  }),
);

usersRouter.post(
  '/',
  validateBody(service.createUserInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createUser(req.body));
  }),
);

usersRouter.patch(
  '/:id',
  validateParams(service.userIdParam),
  validateBody(service.updateUserInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.UserIdParam;
    res.json(await service.updateUser(id, req.body, currentUser(req).sub));
  }),
);
