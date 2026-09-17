import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 5. Receivables only — supplier payables are out of scope. */
export const financialRouter = Router();
financialRouter.use(requireAuth, requireRole('accountant', 'admin'));

// TODO GET  /customers          -> service.listCustomerAccounts
// TODO GET  /customers/:id      -> service.getCustomerAccount
// TODO POST /payments           -> service.recordPayment
// TODO GET  /cheques            -> service.listCheques
// TODO POST /cheques/:id/clear  -> service.clearCheque
// TODO POST /cheques/:id/bounce -> service.bounceCheque
