import { appSchema } from './schema.js';
import { boolean, date, index, text, uuid } from 'drizzle-orm/pg-core';
import { fxRate, primaryKey, qty, timestamps, usd } from './common.js';
import { poStatus } from './enums.js';
import { parts } from './catalog.js';

export const suppliers = appSchema.table('suppliers', {
  id: primaryKey(),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  /** Defaults to USD: the client buys from third-party suppliers in dollars. */
  currency: text('currency').notNull().default('USD'),
  paymentTerms: text('payment_terms'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

/** One FX rate per PO, confirmed — it applies to every receipt against this order,
 *  including partial deliveries. If the client ever pays a supplier in
 *  installments at differing rates, this moves to a rate-per-payment model, which
 *  is a data-model change, not a UI one. Section 6.2 of the demo scope. */
export const purchaseOrders = appSchema.table(
  'purchase_orders',
  {
    id: primaryKey(),
    reference: text('reference').notNull(),
    supplierId: uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
    status: poStatus('status').notNull().default('draft'),
    orderDate: date('order_date').notNull(),
    /** GHS per USD, entered by hand by the purchasing officer. Not a live feed. */
    fxRate: fxRate('fx_rate').notNull(),
    ...timestamps,
  },
  (t) => [index('purchase_orders_supplier_idx').on(t.supplierId)],
);

export const purchaseOrderLines = appSchema.table(
  'purchase_order_lines',
  {
    id: primaryKey(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'restrict' }),
    quantityOrdered: qty('quantity_ordered').notNull(),
    quantityReceived: qty('quantity_received').notNull().default('0'),
    /** USD — what the supplier actually charges. Stored alongside the PO's
     *  fx_rate and never pre-converted, so the original dollar cost stays
     *  recoverable for supplier reconciliation. Section 6.4. */
    unitCostUsd: usd('unit_cost_usd').notNull(),
    ...timestamps,
  },
  (t) => [index('purchase_order_lines_po_idx').on(t.purchaseOrderId)],
);
