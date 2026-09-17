import { appSchema } from './schema.js';
import { date, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ghs, primaryKey, timestamps } from './common.js';
import { momoNetwork, paymentMethod, paymentStatus } from './enums.js';
import { customers, salesInvoices } from './sales.js';
import { users } from './auth.js';

/** A customer's balance is DERIVED — sum of invoices minus cleared allocations —
 *  and is never stored or edited, not even by an admin. That is a hard rule from
 *  the discovery phase, which is why no table here has a `balance` column. */
export const payments = appSchema.table(
  'payments',
  {
    id: primaryKey(),
    /** Null for a walk-in sale settled at the till, matching
     *  sales_invoices.customer_id — the two must agree about what a walk-in is.
     *  A null-customer payment never reaches receivables, because every balance
     *  is derived per customer. A cheque is the exception and the service
     *  refuses one without a customer: a bounced cheque with nobody attached
     *  would be a debt with no one to chase. */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    method: paymentMethod('method').notNull(),
    amount: ghs('amount').notNull(),
    /** Cash and MoMo are inserted already 'cleared'. Cheques start 'pending' and
     *  contribute nothing to the balance until someone clears them. */
    status: paymentStatus('status').notNull(),
    paymentDate: date('payment_date').notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('payments_customer_idx').on(t.customerId), index('payments_status_idx').on(t.status)],
);

export const cheques = appSchema.table(
  'cheques',
  {
    id: primaryKey(),
    paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
    chequeNumber: text('cheque_number').notNull(),
    bankName: text('bank_name'),
    /** Set when someone marks the cheque cleared or bounced. A bounce reverses the
     *  balance and stays visible in history — the row is never deleted. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('cheques_payment_idx').on(t.paymentId)],
);

export const momoTransactions = appSchema.table('momo_transactions', {
  id: primaryKey(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  network: momoNetwork('network').notNull(),
  transactionId: text('transaction_id').notNull(),
  phoneNumber: text('phone_number').notNull(),
  ...timestamps,
});

/** Ties money to invoices. A payment can be split across several invoices, or
 *  left unallocated ("pay against account"), in which case it has no rows here. */
export const paymentAllocations = appSchema.table(
  'payment_allocations',
  {
    id: primaryKey(),
    paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'restrict' }),
    amount: ghs('amount').notNull(),
    ...timestamps,
  },
  (t) => [
    index('payment_allocations_payment_idx').on(t.paymentId),
    index('payment_allocations_invoice_idx').on(t.invoiceId),
  ],
);
