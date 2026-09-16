import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 3. Sales only — admin is deliberately included so the owner can
 *  demonstrate the till without a second login. */
export const posRouter = Router();
posRouter.use(requireAuth, requireRole('sales', 'admin'));

// TODO GET  /parts            search by name, part number or fitment; returns
//                             prices.final_price and stock only — never cost.
// TODO POST /sales            create invoice + lines, write stock movements and
//                             decrement balances, all in one db.transaction().
// TODO GET  /sales/:id        receipt-style confirmation.
