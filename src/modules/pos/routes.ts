import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 3. Sales only — admin is included so the owner can demonstrate the
 *  till without a second login. */
export const posRouter = Router();
posRouter.use(requireAuth, requireRole('sales', 'admin'));

// TODO GET  /parts      -> service.searchParts
// TODO POST /sales      -> service.recordSale
// TODO GET  /sales/:id  -> service.getSale
