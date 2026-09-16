import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Section 6 — suppliers, purchase orders, price management.
 *
 *  This is the router the RBAC demo points at: logging in as sales@demo and
 *  requesting any path below returns 403 from the API itself. */
export const backofficeRouter = Router();
backofficeRouter.use(requireAuth, requireRole('purchasing', 'admin'));

// Suppliers — full CRUD (6.1)
// TODO GET/POST /suppliers, GET/PATCH /suppliers/:id, GET /suppliers/:id/purchase-orders

// Purchase orders (6.2)
// TODO GET  /purchase-orders            filter by status and supplier
// TODO POST /purchase-orders            lines in USD + one fx_rate for the order
// TODO POST /purchase-orders/:id/send   draft -> sent
// TODO POST /purchase-orders/:id/receive
//      The centrepiece of the demo, and all of it belongs in one transaction:
//        1. increment quantity_received per line (partial deliveries allowed)
//        2. increment the inventory balance, insert a stock movement
//        3. landed_cost  = unit_cost_usd * purchase_orders.fx_rate   -> GHS
//        4. suggested_price = landed_cost * (1 + default_margin_pct/100)
//        5. upsert into prices; leave final_price alone if already set by hand
//        6. move the PO to partially_received or received

// Price management (6.3)
// TODO GET   /prices          cost, suggested and final side by side
// TODO PATCH /prices/:partId  override final_price. This is the only price the
//                             Sales role ever sees.
