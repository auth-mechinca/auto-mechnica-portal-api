import { appSchema } from './schema.js';
import { boolean, date, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { fxRate, primaryKey, qty, timestamps, usd } from './common.js';
import { poStatus } from './enums.js';
import { parts } from './catalog.js';
import { users } from './auth.js';

/** Purchase-order numbers come from a sequence, for the same reason invoice
 *  numbers do: counting existing rows lets two people drafting at once read the
 *  same number, and the unique index would then reject one of them outright. */
export const purchaseOrderNumberSeq = appSchema.sequence('purchase_order_number_seq', {
  startWith: 1,
  increment: 1,
});

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
    /** GHS per USD, entered by hand by the purchasing officer. Not a live feed.
     *
     *  Null while the order is still a draft: nothing has been agreed with anyone
     *  yet, so there is no rate to record and the order has no Cedi value. The
     *  rate becomes required at the moment it is marked sent, which is enforced
     *  in the service — a check constraint cannot express "required in some
     *  states", and spelling it out in code keeps the reason readable. */
    fxRate: fxRate('fx_rate'),

    /* Why an order ended before it was fulfilled. Set when it is cancelled or
     * short-closed — the status says which — and null otherwise, including on a
     * fully received order, which ended by being fulfilled.
     *
     * Same shape as `cheques` uses for cleared and bounced: one resolution
     * triple covering both outcomes, rather than a column set per outcome. Free
     * text rather than an enum because nobody has yet seen the reasons a real
     * purchasing officer writes; a constrained list can come from reading them. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolutionReason: text('resolution_reason'),

    ...timestamps,
  },
  (t) => [
    index('purchase_orders_supplier_idx').on(t.supplierId),
    // The number on the supplier's paperwork. Two orders sharing one is a
    // real-world problem, not merely a data one.
    uniqueIndex('purchase_orders_reference_idx').on(t.reference),
  ],
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
