import { sql } from 'drizzle-orm';
import { numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/** uuid over serial: this demo is the seed of a multi-tenant SaaS, and ids will
 *  eventually cross tenant boundaries and be exposed in URLs. */
export const primaryKey = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/* ---------------------------------------------------------------------------
 * Money.
 *
 * Never float. Postgres `numeric` is exact, and Drizzle hands these back as
 * strings on purpose — arithmetic belongs in SQL or a decimal library, never in
 * a parseFloat over a customer balance.
 *
 * Everything is GHS except `usd()`, which exists only where the supplier
 * actually invoices in dollars. See Section 6.4 of the demo scope: USD appears
 * at `unit_cost_usd` and nowhere downstream.
 * ------------------------------------------------------------------------ */

/** Ghanaian Cedis. Prices, balances, invoice and payment amounts. */
export const ghs = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** US Dollars. Supplier purchase cost only. */
export const usd = (name: string) => numeric(name, { precision: 14, scale: 4 });

/** GHS per USD. A rate, not a currency amount — extra scale so it isn't rounded. */
export const fxRate = (name: string) => numeric(name, { precision: 12, scale: 6 });

/** Quantities. Scale 3 so a part sold by weight or length isn't forced to integers. */
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

/** Percentages, e.g. margin. 35% is stored as 35.00, not 0.35. */
export const pct = (name: string) => numeric(name, { precision: 6, scale: 2 });
