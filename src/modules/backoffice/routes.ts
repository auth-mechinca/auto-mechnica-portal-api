import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 6 — suppliers, purchase orders, price management.
 *
 *  This is the router the RBAC demo points at: logging in as sales@demo and
 *  requesting any path below returns 403 from the API itself. */
export const backofficeRouter = Router();
backofficeRouter.use(requireAuth, requireRole('purchasing', 'admin'));

// Suppliers (6.1)
// TODO GET/POST  /suppliers                    -> service.listSuppliers / createSupplier
// TODO GET/PATCH /suppliers/:id                -> service.getSupplier / updateSupplier

// Purchase orders (6.2)
// TODO GET/POST  /purchase-orders              -> service.listPurchaseOrders / createPurchaseOrder
// TODO POST      /purchase-orders/:id/send     -> service.sendPurchaseOrder
// TODO POST      /purchase-orders/:id/receive  -> service.receiveStock

// Price management (6.3)
// TODO GET       /prices                       -> service.listPrices
// TODO PATCH     /prices/:partId               -> service.setFinalPrice
// TODO GET       /settings                     -> service.getSettings
