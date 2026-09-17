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

/* Price management (6.3). The final price set here is the only price figure the
 * Sales role ever sees — never the cost, never the suggestion. */

backofficeRouter.get(
  '/prices',
  validateQuery(service.listPricesQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listPrices(res.locals.query as service.ListPricesQuery));
  }),
);

backofficeRouter.get(
  '/prices/:partId',
  validateParams(service.partIdParam),
  asyncHandler(async (_req, res) => {
    const { partId } = res.locals.params as service.PartIdParam;
    res.json(await service.getPrice(partId));
  }),
);

backofficeRouter.patch(
  '/prices/:partId',
  validateParams(service.partIdParam),
  validateBody(service.setFinalPriceInput),
  asyncHandler(async (req, res) => {
    const { partId } = res.locals.params as service.PartIdParam;
    res.json(await service.setFinalPrice(partId, req.body, currentUser(req).sub));
  }),
);

backofficeRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await service.getSettings());
  }),
);

backofficeRouter.patch(
  '/settings',
  validateBody(service.updateSettingsInput),
  asyncHandler(async (req, res) => {
    res.json(await service.updateSettings(req.body));
  }),
);

// Suppliers (6.1) and creating a purchase order are still to come.
// TODO GET/POST  /suppliers        -> service.listSuppliers / createSupplier
// TODO GET/PATCH /suppliers/:id    -> service.getSupplier / updateSupplier
// TODO POST      /purchase-orders  -> service.createPurchaseOrder
