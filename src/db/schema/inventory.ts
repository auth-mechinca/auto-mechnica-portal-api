import { appSchema } from './schema.js';
import { index, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryKey, qty, timestamps } from './common.js';
import { adjustmentReason, movementType } from './enums.js';
import { locations, parts } from './catalog.js';
import { users } from './auth.js';

/** Current stock, keyed by (part, location). One location exists in the demo, but
 *  the key is composite from the start — see the note on `locations`. */
export const inventoryBalances = appSchema.table(
  'inventory_balances',
  {
    id: primaryKey(),
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
    quantity: qty('quantity').notNull().default('0'),
    ...timestamps,
  },
  (t) => [uniqueIndex('inventory_balances_part_location_idx').on(t.partId, t.locationId)],
);

/** The ledger behind every balance change. A balance is only ever moved by
 *  inserting one of these in the same transaction — receipts, sales and manual
 *  adjustments all land here, so stock history is reconstructable. */
export const stockMovements = appSchema.table(
  'stock_movements',
  {
    id: primaryKey(),
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
    type: movementType('type').notNull(),
    /** Signed: positive on receipt, negative on sale. */
    quantityDelta: qty('quantity_delta').notNull(),
    /** Required by the UI for manual adjustments only (damage / loss / count correction). */
    reason: adjustmentReason('reason'),
    note: text('note'),
    /** The purchase_order_line or sales_invoice_line that caused this, when there is one. */
    referenceId: uuid('reference_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('stock_movements_part_idx').on(t.partId, t.locationId),
    index('stock_movements_reference_idx').on(t.referenceId),
  ],
);
