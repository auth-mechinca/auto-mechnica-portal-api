import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { validateBody, validateParams, validateQuery } from '../../lib/validate.js';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './service.js';

/** Section 6 — suppliers, purchase orders, price management.
 *
 *  This is the router the RBAC demo points at: logging in as sales@demo and
 *  requesting any path below returns 403 from the API itself. */
export const backofficeRouter = Router();
backofficeRouter.use(requireAuth, requireRole('purchasing', 'admin'));

backofficeRouter.get(
  '/purchase-orders',
  validateQuery(service.listPurchaseOrdersQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listPurchaseOrders(res.locals.query as service.ListPurchaseOrdersQuery));
  }),
);

backofficeRouter.get(
  '/purchase-orders/:id',
  validateParams(service.purchaseOrderIdParam),
  asyncHandler(async (_req, res) => {
    const { id } = res.locals.params as service.PurchaseOrderIdParam;
    res.json(await service.getPurchaseOrder(id));
  }),
);

backofficeRouter.post(
  '/purchase-orders/:id/receive',
  validateParams(service.purchaseOrderIdParam),
  validateBody(service.receiveStockInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PurchaseOrderIdParam;
    res.status(201).json(await service.receiveStock(id, req.body, currentUser(req).sub));
  }),
);

// Suppliers (6.1) and Price Management (6.3) are still to come.
// TODO GET/POST  /suppliers        -> service.listSuppliers / createSupplier
// TODO GET/PATCH /suppliers/:id    -> service.getSupplier / updateSupplier
// TODO POST      /purchase-orders  -> service.createPurchaseOrder
// TODO GET       /prices           -> service.listPrices
// TODO PATCH     /prices/:partId   -> service.setFinalPrice
