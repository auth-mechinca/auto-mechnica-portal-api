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
  '/purchase-orders',
  validateBody(service.createPurchaseOrderInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createPurchaseOrder(req.body));
  }),
);

backofficeRouter.patch(
  '/purchase-orders/:id',
  validateParams(service.purchaseOrderIdParam),
  validateBody(service.updatePurchaseOrderInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PurchaseOrderIdParam;
    res.json(await service.updatePurchaseOrder(id, req.body));
  }),
);

backofficeRouter.post(
  '/purchase-orders/:id/send',
  validateParams(service.purchaseOrderIdParam),
  asyncHandler(async (_req, res) => {
    const { id } = res.locals.params as service.PurchaseOrderIdParam;
    res.json(await service.sendPurchaseOrder(id));
  }),
);

backofficeRouter.post(
  '/purchase-orders/:id/cancel',
  validateParams(service.purchaseOrderIdParam),
  validateBody(service.cancelPurchaseOrderInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PurchaseOrderIdParam;
    res.json(await service.cancelPurchaseOrder(id, req.body, currentUser(req).sub));
  }),
);

backofficeRouter.post(
  '/purchase-orders/:id/close',
  validateParams(service.purchaseOrderIdParam),
  validateBody(service.closePurchaseOrderInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.PurchaseOrderIdParam;
    res.json(await service.closePurchaseOrder(id, req.body, currentUser(req).sub));
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

/* Suppliers (6.1). Never deleted — one you stop using becomes inactive, so its
 * purchase-order history stays intact and past costs remain explicable. */

backofficeRouter.get(
  '/suppliers',
  validateQuery(service.listSuppliersQuery),
  asyncHandler(async (_req, res) => {
    res.json(await service.listSuppliers(res.locals.query as service.ListSuppliersQuery));
  }),
);

backofficeRouter.post(
  '/suppliers',
  validateBody(service.createSupplierInput),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createSupplier(req.body));
  }),
);

backofficeRouter.get(
  '/suppliers/:id',
  validateParams(service.supplierIdParam),
  asyncHandler(async (_req, res) => {
    const { id } = res.locals.params as service.SupplierIdParam;
    res.json(await service.getSupplier(id));
  }),
);

backofficeRouter.patch(
  '/suppliers/:id',
  validateParams(service.supplierIdParam),
  validateBody(service.updateSupplierInput),
  asyncHandler(async (req, res) => {
    const { id } = res.locals.params as service.SupplierIdParam;
    res.json(await service.updateSupplier(id, req.body));
  }),
);
