import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 4. Stock is received through purchase orders, never created here. */
export const imsRouter = Router();
imsRouter.use(requireAuth, requireRole('purchasing', 'admin'));

// TODO GET   /parts           searchable list with current stock and sell price.
// TODO POST  /parts           create.
// TODO PATCH /parts/:id       edit, including fitment entries and reorder point.
// TODO POST  /parts/:id/adjust  manual adjustment; reason is required. Writes a
//                               stock movement and updates the balance together.
// TODO GET   /low-stock       balances below parts.reorder_point.
