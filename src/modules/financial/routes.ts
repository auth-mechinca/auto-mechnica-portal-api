import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 5. Receivables only — supplier payables are out of scope. */
export const financialRouter = Router();
financialRouter.use(requireAuth, requireRole('accountant', 'admin'));

// TODO GET  /customers                 list with derived balance and ageing buckets
// TODO GET  /customers/:id             invoice history, payment history, balance
// TODO POST /payments                  cash | cheque | momo, with allocations
// TODO GET  /cheques?status=pending    the cheque queue
// TODO POST /cheques/:id/clear
// TODO POST /cheques/:id/bounce
//
// Two rules that are not negotiable here:
//   - A balance is always derived (invoices minus cleared allocations). There is
//     no balance column to update, and no endpoint may ever set one.
//   - A bounce reverses the balance and stays flagged in history. Never delete
//     the payment row.
