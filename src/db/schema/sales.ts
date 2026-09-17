import { appSchema } from './schema.js';
import { boolean, date, index, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ghs, primaryKey, qty, timestamps } from './common.js';
import { parts } from './catalog.js';
import { users } from './auth.js';

/** Invoice numbers come from a sequence rather than counting existing rows:
 *  `max(reference) + 1` inside a transaction lets two concurrent tills read the
 *  same number, and the unique index above would then reject one sale outright.
 *  A sequence hands out a distinct value without blocking either. */
export const invoiceNumberSeq = appSchema.sequence('invoice_number_seq', {
  startWith: 1,
  increment: 1,
});

export const customers = appSchema.table('customers', {
  id: primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

/** Created by completing a sale in the POS. There is deliberately no
 *  `balance` column anywhere in this file — see `financial.ts`. */
export const salesInvoices = appSchema.table(
  'sales_invoices',
  {
    id: primaryKey(),
    reference: text('reference').notNull(),
    /** Null for a walk-in cash sale with no account. */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    invoiceDate: date('invoice_date').notNull(),
    /** Stamped when the invoice is raised: invoice_date plus the shop's
     *  `default_payment_terms_days` setting. Stored rather
     *  than derived on read, for the same reason as `unit_price` below — later
     *  changing a customer's terms must not silently move the due date of
     *  invoices already issued, and ageing would be rewritten with it.
     *
     *  A walk-in is settled at the till, so its due date is the invoice date. */
    dueDate: date('due_date').notNull(),
    totalAmount: ghs('total_amount').notNull(),
    soldBy: uuid('sold_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('sales_invoices_customer_idx').on(t.customerId),
    // The number printed on the customer's receipt. Two invoices sharing one is
    // a real-world problem, not merely a data one.
    uniqueIndex('sales_invoices_reference_idx').on(t.reference),
    // Every ageing query on the Customer Accounts screen filters on this.
    index('sales_invoices_due_date_idx').on(t.dueDate),
  ],
);

export const salesInvoiceLines = appSchema.table(
  'sales_invoice_lines',
  {
    id: primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesInvoices.id, { onDelete: 'cascade' }),
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'restrict' }),
    quantity: qty('quantity').notNull(),
    /** Copied from `prices.final_price` at the moment of sale, not joined at read
     *  time — a later price change must not rewrite the history of what was sold. */
    unitPrice: ghs('unit_price').notNull(),
    lineTotal: ghs('line_total').notNull(),
    ...timestamps,
  },
  (t) => [index('sales_invoice_lines_invoice_idx').on(t.invoiceId)],
);
