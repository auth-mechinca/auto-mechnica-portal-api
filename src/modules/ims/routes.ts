import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 4. Stock is received through purchase orders, never created here. */
export const imsRouter = Router();
imsRouter.use(requireAuth, requireRole('purchasing', 'admin'));

// TODO GET   /parts            -> service.listParts
// TODO POST  /parts            -> service.createPart
// TODO PATCH /parts/:id        -> service.updatePart
// TODO POST  /parts/:id/adjust -> service.adjustStock
// TODO GET   /low-stock        -> service.listLowStock
