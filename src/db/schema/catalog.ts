import { appSchema } from './schema.js';
import { boolean, index, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ghs, pct, primaryKey, timestamps } from './common.js';

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

export const parts = appSchema.table(
  'parts',
  {
    id: primaryKey(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    partNumber: text('part_number'),
    oemNumber: text('oem_number'),
    brand: text('brand'),
    category: text('category'),
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
 *  the Sales role is ever allowed to read. Section 6.3. */
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

/** Global key/value settings. For the demo this holds exactly one thing that
 *  matters: `default_margin_pct`. Per-category overrides are out of scope. */
export const settings = appSchema.table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ...timestamps,
});
