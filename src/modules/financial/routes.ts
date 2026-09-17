import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody, validateParams, validateQuery } from '../../lib/validate.js';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Section 5. Receivables only — supplier payables are out of scope. */
export const financialRouter = Router();
financialRouter.use(requireAuth, requireRole('accountant', 'admin'));

financialRouter.get(
  '/customers',
  validateQuery(service.listCustomersQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listCustomerAccounts(res.locals.query as service.ListCustomersQuery));
  }),
);

financialRouter.get(
  '/customers/:id',
  validateParams(service.customerIdParam),
  asyncHandler(async (_req, res) => {
    const { id } = res.locals.params as service.CustomerIdParam;
    res.json(await service.getCustomerAccount(id));
  }),
);

financialRouter.post(
  '/payments',
  validateBody(service.recordPaymentInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.recordPayment(req.body, currentUser(req).sub));
  }),
);

financialRouter.get(
  '/cheques',
  validateQuery(service.listChequesQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listCheques(res.locals.query as service.ListChequesQuery));
  }),
);

financialRouter.post(
  '/cheques/:id/clear',
  validateParams(service.paymentIdParam),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PaymentIdParam;
    res.json(await service.clearCheque(id, currentUser(req).sub));
  }),
);

financialRouter.post(
  '/cheques/:id/bounce',
  validateParams(service.paymentIdParam),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PaymentIdParam;
    res.json(await service.bounceCheque(id, currentUser(req).sub));
  }),
);
