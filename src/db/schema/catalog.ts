import { sql } from 'drizzle-orm';
import { appSchema } from './schema.js';
import { boolean, index, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ghs, pct, primaryKey, timestamps } from './common.js';
import { priceChangeSource } from './enums.js';
import { users } from './auth.js';

/** Single location for the demo — one seeded `Main Shop` row, no selector in the UI
 *  and no transfer workflow. The column exists on balances and movements from day
 *  one so that adding multi-location later is UI work, not a backfill across every
 *  historical row. See Section 4 of the demo scope. */
export const locations = appSchema.table('locations', {
  id: primaryKey(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

/** Categories and brands are their own rows rather than free text on a part.
 *
 *  As text they drifted immediately: one person typed "Electrical" and another
 *  "Electrical and Charging", and the filter list simply reported both. Nothing
 *  could tell a new category from a typo of an existing one.
 *
 *  The unique index is on the lowercased name, so "Electrical" and "electrical"
 *  collide rather than becoming two entries that look identical on screen.
 *
 *  Neither is deleted once used — a part points at one, and losing the row would
 *  leave that part uncategorised. They are deactivated instead, the same way
 *  suppliers are. */
export const categories = appSchema.table(
  'categories',
  {
    id: primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('categories_name_lower_idx').on(sql`lower(${t.name})`)],
);

export const brands = appSchema.table(
  'brands',
  {
    id: primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('brands_name_lower_idx').on(sql`lower(${t.name})`)],
);

export const parts = appSchema.table(
  'parts',
  {
    id: primaryKey(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    partNumber: text('part_number'),
    oemNumber: text('oem_number'),
    /** Both are references now, not free text. The text columns they replaced
     *  were backfilled into `brands` and `categories` in migration 0009. */
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    /** Demo-level fitment: free-text Year/Make/Model/Engine entries, not a
     *  normalised cross-reference database. Section 4 of the demo scope. */
    fitment: text('fitment').array().notNull().default([]),
    reorderPoint: integer('reorder_point').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('parts_sku_idx').on(t.sku),
    index('parts_part_number_idx').on(t.partNumber),
    index('parts_name_idx').on(t.name),
  ],
);

/** One row per part. `landedCost` and `suggestedPrice` are written by the PO
 *  receipt; `finalPrice` is the only one a human sets, and it is the only one
 *  the Sales role is ever allowed to read. Section 6.3.
 *
 *  This row is the current working sheet, not a record: a later receipt for the
 *  same part overwrites `landedCost` and `suggestedPrice` in place. Every write
 *  is archived to `priceHistory` below. */
export const prices = appSchema.table(
  'prices',
  {
    id: primaryKey(),
    partId: uuid('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'restrict' }),
    landedCost: ghs('landed_cost'),
    suggestedPrice: ghs('suggested_price'),
    finalPrice: ghs('final_price'),
    marginPctUsed: pct('margin_pct_used'),
    ...timestamps,
  },
  (t) => [uniqueIndex('prices_part_idx').on(t.partId)],
);

/** Append-only archive of every price write — a receipt recomputing the
 *  suggestion, or a person saving a final price. `prices` holds one row per part
 *  and is overwritten in place, so without this the cost a price was set against
 *  is gone the next time that part is bought.
 *
 *  Rows are inserted and never updated or deleted. That is what makes it
 *  answerable later that a final price was set on a cost that has since moved —
 *  see the override question in Section 6.3. */
export const priceHistory = appSchema.table(
  'price_history',
  {
    id: primaryKey(),
    partId: uuid('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'restrict' }),
    /** The four figures as they stood immediately after this write, so a row is
     *  readable on its own without replaying the ones before it. */
    landedCost: ghs('landed_cost'),
    suggestedPrice: ghs('suggested_price'),
    finalPrice: ghs('final_price'),
    marginPctUsed: pct('margin_pct_used'),
    source: priceChangeSource('source').notNull(),
    /** The purchase_order_line whose receipt caused this, when one did.
     *  Deliberately not a foreign key, matching `stock_movements.reference_id`. */
    referenceId: uuid('reference_id'),
    /** Null when a receipt wrote the row — nobody typed it. */
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('price_history_part_idx').on(t.partId, t.createdAt)],
);

/** Global key/value settings. Two keys matter for the demo:
 *  `default_margin_pct`, and `default_payment_terms_days` — how long every
 *  customer gets to pay, which is what an invoice's due date is computed from.
 *  Per-customer terms and per-category margin overrides are both out of scope. */
export const settings = appSchema.table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ...timestamps,
});
