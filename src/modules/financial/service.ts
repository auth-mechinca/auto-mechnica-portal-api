import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Tx } from '../../db/client.js';
import {
  cheques,
  customers,
  momoTransactions,
  paymentAllocations,
  payments,
  salesInvoices,
  users,
} from '../../db/schema/index.js';
import { ApiError } from '../../lib/http.js';
import { add, compare, subtract, sum } from '../../lib/money.js';

/** Receivables. Section 5 of the demo scope.
 *
 *  Two rules run through every line of this file, and both are structural rather
 *  than conventions anybody has to remember:
 *
 *    A balance is DERIVED — invoices minus allocations from payments that have
 *    cleared. No table has a balance column, so there is nothing for an endpoint
 *    to set and no way for one to drift.
 *
 *    A bounced cheque REVERSES and stays visible. The payment keeps its row and
 *    its allocations; flipping it out of `cleared` is what puts the invoice back
 *    to outstanding. Nothing is deleted, so the history still shows it happened.
 */

/* ------------------------------------------------------------------ input */

export const customerIdParam = z.object({ id: z.string().uuid() });
export type CustomerIdParam = z.infer<typeof customerIdParam>;

export const paymentIdParam = z.object({ id: z.string().uuid() });
export type PaymentIdParam = z.infer<typeof paymentIdParam>;

export const listCustomersQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuery>;

export const listChequesQuery = z.object({
  status: z.enum(['pending', 'cleared', 'bounced']).optional(),
});
export type ListChequesQuery = z.infer<typeof listChequesQuery>;

const amount = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Expected an amount such as "2200.00"');

export const recordPaymentInput = z.object({
  customerId: z.string().uuid(),
  amount,
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The same union, spelled the same way, as the payment on a sale. A till
   *  taking a cheque and an accountant recording one later are the same event
   *  arriving through two doors, so one mapper should serve both. */
  payment: z.discriminatedUnion('method', [
    z.object({ method: z.literal('cash') }),
    z.object({
      method: z.literal('cheque'),
      chequeNumber: z.string().trim().min(1).max(50),
      bankName: z.string().trim().min(1).max(100).optional(),
    }),
    z.object({
      method: z.literal('momo'),
      network: z.enum(['mtn', 'telecel', 'airteltigo']),
      transactionId: z.string().trim().min(1).max(100),
      phoneNumber: z.string().trim().min(1).max(30),
    }),
  ]),
  /** Empty is "pay against account": the money is recorded and sits against the
   *  customer until somebody applies it to an invoice. */
  allocations: z
    .array(z.object({ invoiceId: z.string().uuid(), amount }))
    .default([]),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentInput>;

/* ----------------------------------------------------------------- output */

const ageing = z.object({
  current: z.string(),
  days1to30: z.string(),
  days31to60: z.string(),
  days61to90: z.string(),
  days90plus: z.string(),
});

export const customerAccountRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  totalAmount: z.string(),
  paid: z.string(),
  balanceDue: z.string(),
  /** The due date of their oldest unpaid invoice — the one you would chase on. */
  oldestUnpaidDueDate: z.string().nullable(),
  /** Days past that date. Negative means not due yet; null means nothing owing. */
  daysLate: z.number().nullable(),
});
export type CustomerAccountRow = z.infer<typeof customerAccountRow>;

export const customerAccountsResponse = z.object({
  customers: z.array(customerAccountRow),
  totals: z.object({ totalAmount: z.string(), paid: z.string(), balanceDue: z.string() }),
  summary: z.object({
    owedAltogether: z.string(),
    accountsOwing: z.number(),
    /** The "start here" tile: outstanding on invoices more than 60 days past due. */
    over60Days: z.string(),
    customersOver60: z.number(),
    /** Recorded but not cleared, so still counted as owed. */
    chequesPending: z.string(),
    chequesPendingCount: z.number(),
  }),
  ageing,
});
export type CustomerAccountsResponse = z.infer<typeof customerAccountsResponse>;

export const customerAccountDetail = customerAccountRow.extend({
  email: z.string().nullable(),
  invoices: z.array(
    z.object({
      id: z.string().uuid(),
      reference: z.string(),
      invoiceDate: z.string(),
      dueDate: z.string(),
      total: z.string(),
      paid: z.string(),
      outstanding: z.string(),
      status: z.enum(['paid', 'part_paid', 'outstanding']),
      daysLate: z.number(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string().uuid(),
      paymentDate: z.string(),
      method: z.enum(['cash', 'cheque', 'momo']),
      status: z.enum(['pending', 'cleared', 'bounced']),
      amount: z.string(),
      cheque: z.object({ chequeNumber: z.string(), bankName: z.string().nullable() }).nullable(),
      momo: z
        .object({
          network: z.enum(['mtn', 'telecel', 'airteltigo']),
          transactionId: z.string(),
          phoneNumber: z.string(),
        })
        .nullable(),
      resolvedAt: z.string().nullable(),
      allocations: z.array(
        z.object({
          invoiceId: z.string().uuid(),
          reference: z.string(),
          amount: z.string(),
          /** What was still owed on that invoice once this payment landed.
           *  A bounced payment leaves the invoice owing its full amount, which is
           *  exactly what the screen should show. */
          outstandingAfter: z.string(),
        }),
      ),
      /** Money not applied to any invoice — sitting against the account. */
      unallocated: z.string(),
    }),
  ),
});
export type CustomerAccountDetail = z.infer<typeof customerAccountDetail>;

export const chequeRow = z.object({
  paymentId: z.string().uuid(),
  chequeNumber: z.string(),
  bankName: z.string().nullable(),
  customer: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  amount: z.string(),
  receivedOn: z.string(),
  status: z.enum(['pending', 'cleared', 'bounced']),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});
export type ChequeRow = z.infer<typeof chequeRow>;

export const chequeQueueResponse = z.object({
  cheques: z.array(chequeRow),
  counts: z.object({ pending: z.number(), cleared: z.number(), bounced: z.number() }),
  pendingValue: z.string(),
});
export type ChequeQueueResponse = z.infer<typeof chequeQueueResponse>;

/* ---------------------------------------------------------------- helpers */

const today = (): string => new Date().toISOString().slice(0, 10);

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Invoice totals with cleared payments applied. Everything else is built on
 *  this, so there is exactly one definition of "paid" in the module. */
const invoicesWithPaid = sql`
  select i.id,
         i.customer_id,
         i.reference,
         i.invoice_date,
         i.due_date,
         i.total_amount,
         coalesce(sum(a.amount) filter (where p.status = 'cleared'), 0) as paid
    from ${salesInvoices} i
    left join ${paymentAllocations} a on a.invoice_id = i.id
    left join ${payments} p on p.id = a.payment_id
   where i.customer_id is not null
   group by i.id
`;

/* -------------------------------------------------------------- customers */

type CustomerQueryRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  totalAmount: string;
  paid: string;
  balanceDue: string;
  oldestUnpaidDueDate: string | null;
};

export async function listCustomerAccounts(
  query: ListCustomersQuery,
): Promise<CustomerAccountsResponse> {
  const db = getDb();
  const pattern = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const now = today();

  const { rows } = await db.execute<CustomerQueryRow>(sql`
    with invoiced as (${invoicesWithPaid})
    select c.id,
           c.name,
           c.phone,
           c.email,
           coalesce(sum(v.total_amount), 0)::text          as "totalAmount",
           coalesce(sum(v.paid), 0)::text                  as "paid",
           coalesce(sum(v.total_amount - v.paid), 0)::text as "balanceDue",
           min(v.due_date) filter (where v.total_amount > v.paid) as "oldestUnpaidDueDate"
      from ${customers} c
      left join invoiced v on v.customer_id = c.id
     where (${pattern}::text is null or c.name ilike ${pattern} or c.phone ilike ${pattern})
     group by c.id
     having coalesce(sum(v.total_amount), 0) > 0
     order by "oldestUnpaidDueDate" asc nulls last, c.name
  `);

  const list = rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    totalAmount: row.totalAmount,
    paid: row.paid,
    balanceDue: row.balanceDue,
    oldestUnpaidDueDate: row.oldestUnpaidDueDate,
    daysLate: row.oldestUnpaidDueDate ? daysBetween(row.oldestUnpaidDueDate, now) : null,
  }));

  // Buckets are per invoice, not per customer: a customer can be 75 days late on
  // one invoice and current on another, and rolling them together would hide it.
  const { rows: buckets } = await db.execute<Record<string, string>>(sql`
    with invoiced as (${invoicesWithPaid}),
         owing as (select due_date, total_amount - paid as outstanding
                     from invoiced where total_amount > paid)
    select coalesce(sum(outstanding) filter (where due_date >= current_date), 0)::text as "current",
           coalesce(sum(outstanding) filter (where current_date - due_date between 1 and 30), 0)::text as "days1to30",
           coalesce(sum(outstanding) filter (where current_date - due_date between 31 and 60), 0)::text as "days31to60",
           coalesce(sum(outstanding) filter (where current_date - due_date between 61 and 90), 0)::text as "days61to90",
           coalesce(sum(outstanding) filter (where current_date - due_date > 90), 0)::text as "days90plus"
      from owing
  `);

  const { rows: over60 } = await db.execute<{ total: string; customers: number }>(sql`
    with invoiced as (${invoicesWithPaid})
    select coalesce(sum(total_amount - paid), 0)::text as total,
           count(distinct customer_id)::int            as customers
      from invoiced
     where total_amount > paid and current_date - due_date > 60
  `);

  const { rows: pending } = await db.execute<{ total: string; count: number }>(sql`
    select coalesce(sum(p.amount), 0)::text as total, count(*)::int as count
      from ${payments} p
      join ${cheques} ch on ch.payment_id = p.id
     where p.status = 'pending'
  `);

  const bucket = buckets[0]!;

  return {
    customers: list,
    totals: {
      totalAmount: sum(list.map((c) => c.totalAmount)),
      paid: sum(list.map((c) => c.paid)),
      balanceDue: sum(list.map((c) => c.balanceDue)),
    },
    summary: {
      owedAltogether: sum(list.map((c) => c.balanceDue)),
      accountsOwing: list.filter((c) => compare(c.balanceDue, '0') > 0).length,
      over60Days: over60[0]!.total,
      customersOver60: over60[0]!.customers,
      chequesPending: pending[0]!.total,
      chequesPendingCount: pending[0]!.count,
    },
    ageing: {
      current: bucket.current!,
      days1to30: bucket.days1to30!,
      days31to60: bucket.days31to60!,
      days61to90: bucket.days61to90!,
      days90plus: bucket.days90plus!,
    },
  };
}

export async function getCustomerAccount(customerId: string): Promise<CustomerAccountDetail> {
  const db = getDb();
  const now = today();

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) throw ApiError.notFound('Customer not found');

  const { rows: invoiceRows } = await db.execute<{
    id: string;
    reference: string;
    invoiceDate: string;
    dueDate: string;
    total: string;
    paid: string;
  }>(sql`
    with invoiced as (${invoicesWithPaid})
    select id,
           reference,
           invoice_date::text  as "invoiceDate",
           due_date::text      as "dueDate",
           total_amount::text  as total,
           paid::text          as paid
      from invoiced
     where customer_id = ${customerId}
     order by invoice_date desc, reference desc
  `);

  const invoices = invoiceRows.map((row) => {
    const outstanding = subtract(row.total, row.paid);
    const settled = compare(outstanding, '0') <= 0;
    return {
      id: row.id,
      reference: row.reference,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      total: row.total,
      paid: row.paid,
      outstanding,
      status: settled
        ? ('paid' as const)
        : compare(row.paid, '0') > 0
          ? ('part_paid' as const)
          : ('outstanding' as const),
      daysLate: daysBetween(row.dueDate, now),
    };
  });

  const paymentRows = await db
    .select({
      id: payments.id,
      paymentDate: payments.paymentDate,
      method: payments.method,
      status: payments.status,
      amount: payments.amount,
      createdAt: payments.createdAt,
      chequeNumber: cheques.chequeNumber,
      bankName: cheques.bankName,
      resolvedAt: cheques.resolvedAt,
      network: momoTransactions.network,
      transactionId: momoTransactions.transactionId,
      phoneNumber: momoTransactions.phoneNumber,
    })
    .from(payments)
    .leftJoin(cheques, eq(cheques.paymentId, payments.id))
    .leftJoin(momoTransactions, eq(momoTransactions.paymentId, payments.id))
    .where(eq(payments.customerId, customerId))
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt));

  const allocationRows = await db
    .select({
      paymentId: paymentAllocations.paymentId,
      invoiceId: paymentAllocations.invoiceId,
      reference: salesInvoices.reference,
      amount: paymentAllocations.amount,
    })
    .from(paymentAllocations)
    .innerJoin(salesInvoices, eq(salesInvoices.id, paymentAllocations.invoiceId))
    .where(eq(salesInvoices.customerId, customerId));

  const byInvoice = new Map(invoices.map((i) => [i.id, i]));

  const paymentsOut = paymentRows.map((payment) => {
    const allocations = allocationRows
      .filter((a) => a.paymentId === payment.id)
      .map((a) => {
        const invoice = byInvoice.get(a.invoiceId);
        return {
          invoiceId: a.invoiceId,
          reference: a.reference,
          amount: a.amount,
          // Derived from the invoice as it stands, so a bounced payment reads as
          // the full amount owing again — which is the truth after a reversal.
          outstandingAfter: invoice?.outstanding ?? '0.00',
        };
      });

    return {
      id: payment.id,
      paymentDate: payment.paymentDate,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      cheque: payment.chequeNumber
        ? { chequeNumber: payment.chequeNumber, bankName: payment.bankName }
        : null,
      momo: payment.network
        ? {
            network: payment.network,
            transactionId: payment.transactionId!,
            phoneNumber: payment.phoneNumber!,
          }
        : null,
      resolvedAt: payment.resolvedAt ? payment.resolvedAt.toISOString() : null,
      allocations,
      unallocated: subtract(payment.amount, sum(allocations.map((a) => a.amount))),
    };
  });

  const totalAmount = sum(invoices.map((i) => i.total));
  const paid = sum(invoices.map((i) => i.paid));
  const oldestUnpaid = invoices
    .filter((i) => i.status !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    totalAmount,
    paid,
    balanceDue: subtract(totalAmount, paid),
    oldestUnpaidDueDate: oldestUnpaid?.dueDate ?? null,
    daysLate: oldestUnpaid ? daysBetween(oldestUnpaid.dueDate, now) : null,
    invoices,
    payments: paymentsOut,
  };
}

/* --------------------------------------------------------------- payments */

/** Outstanding on one invoice, counting cleared payments only. Read inside the
 *  transaction that is about to allocate against it. */
async function outstandingOf(tx: Tx, invoiceId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ outstanding: string; customerId: string }>(sql`
    select (i.total_amount - coalesce(sum(a.amount) filter (where p.status = 'cleared'), 0))::text
             as outstanding,
           i.customer_id as "customerId"
      from ${salesInvoices} i
      left join ${paymentAllocations} a on a.invoice_id = i.id
      left join ${payments} p on p.id = a.payment_id
     where i.id = ${invoiceId}
     group by i.id
  `);
  return rows[0]?.outstanding ?? null;
}

export async function recordPayment(
  input: RecordPaymentInput,
  recordedBy: string,
): Promise<CustomerAccountDetail> {
  const allocated = sum(input.allocations.map((a) => a.amount));
  if (compare(allocated, input.amount) > 0) {
    throw ApiError.badRequest(
      `Allocated ${allocated} is more than the payment of ${input.amount}`,
    );
  }

  await getDb().transaction(async (tx) => {
    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.isActive, true)))
      .limit(1);
    if (!customer) throw ApiError.badRequest('Unknown customer');

    for (const allocation of input.allocations) {
      const [invoice] = await tx
        .select({ customerId: salesInvoices.customerId })
        .from(salesInvoices)
        .where(eq(salesInvoices.id, allocation.invoiceId))
        .limit(1);

      if (!invoice) throw ApiError.badRequest(`Unknown invoice: ${allocation.invoiceId}`);
      if (invoice.customerId !== input.customerId) {
        throw ApiError.badRequest('That invoice belongs to a different customer');
      }

      const outstanding = await outstandingOf(tx, allocation.invoiceId);
      if (outstanding !== null && compare(allocation.amount, outstanding) > 0) {
        throw ApiError.badRequest(
          `Allocating ${allocation.amount} exceeds the ${outstanding} outstanding on that invoice`,
        );
      }
    }

    // Cash and MoMo are money in hand. A cheque is a promise, and stays pending
    // until somebody clears it in the queue.
    const status = input.payment.method === 'cheque' ? 'pending' : 'cleared';

    const [payment] = await tx
      .insert(payments)
      .values({
        customerId: input.customerId,
        method: input.payment.method,
        amount: input.amount,
        status,
        paymentDate: input.paymentDate,
        recordedBy,
      })
      .returning();

    if (input.payment.method === 'cheque') {
      await tx.insert(cheques).values({
        paymentId: payment!.id,
        chequeNumber: input.payment.chequeNumber,
        bankName: input.payment.bankName ?? null,
      });
    }

    if (input.payment.method === 'momo') {
      await tx.insert(momoTransactions).values({
        paymentId: payment!.id,
        network: input.payment.network,
        transactionId: input.payment.transactionId,
        phoneNumber: input.payment.phoneNumber,
      });
    }

    for (const allocation of input.allocations) {
      await tx.insert(paymentAllocations).values({
        paymentId: payment!.id,
        invoiceId: allocation.invoiceId,
        amount: allocation.amount,
      });
    }
  });

  return getCustomerAccount(input.customerId);
}

/* ---------------------------------------------------------------- cheques */

export async function listCheques(query: ListChequesQuery): Promise<ChequeQueueResponse> {
  const db = getDb();

  const rows = await db
    .select({
      paymentId: payments.id,
      chequeNumber: cheques.chequeNumber,
      bankName: cheques.bankName,
      customerId: customers.id,
      customerName: customers.name,
      amount: payments.amount,
      receivedOn: payments.paymentDate,
      status: payments.status,
      resolvedAt: cheques.resolvedAt,
      resolvedBy: users.fullName,
    })
    .from(cheques)
    .innerJoin(payments, eq(payments.id, cheques.paymentId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(users, eq(users.id, cheques.resolvedBy))
    .orderBy(desc(payments.paymentDate));

  const all = rows.map((row) => ({
    paymentId: row.paymentId,
    chequeNumber: row.chequeNumber,
    bankName: row.bankName,
    customer: row.customerId ? { id: row.customerId, name: row.customerName! } : null,
    amount: row.amount,
    receivedOn: row.receivedOn,
    status: row.status,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedBy: row.resolvedBy,
  }));

  return {
    cheques: query.status ? all.filter((c) => c.status === query.status) : all,
    counts: {
      pending: all.filter((c) => c.status === 'pending').length,
      cleared: all.filter((c) => c.status === 'cleared').length,
      bounced: all.filter((c) => c.status === 'bounced').length,
    },
    pendingValue: sum(all.filter((c) => c.status === 'pending').map((c) => c.amount)),
  };
}

async function resolveCheque(
  paymentId: string,
  outcome: 'cleared' | 'bounced',
  resolvedBy: string,
): Promise<ChequeRow> {
  await getDb().transaction(async (tx) => {
    // Locked on its own rather than through the join: Postgres will not accept a
    // schema-qualified name in FOR UPDATE OF, and this schema is named.
    const [payment] = await tx
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update')
      .limit(1);

    const [cheque] = await tx
      .select({ id: cheques.id })
      .from(cheques)
      .where(eq(cheques.paymentId, paymentId))
      .limit(1);

    if (!payment || !cheque) throw ApiError.notFound('No cheque against that payment');
    if (payment.status !== 'pending') {
      throw ApiError.conflict(`That cheque is already marked ${payment.status}`);
    }

    // The balance moves because of this line and nothing else: allocations were
    // written when the payment was taken, and only cleared ones count.
    await tx
      .update(payments)
      .set({ status: outcome, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));

    await tx
      .update(cheques)
      .set({ resolvedAt: new Date(), resolvedBy, updatedAt: new Date() })
      .where(eq(cheques.id, cheque.id));
  });

  const queue = await listCheques({});
  return queue.cheques.find((c) => c.paymentId === paymentId)!;
}

export const clearCheque = (paymentId: string, userId: string) =>
  resolveCheque(paymentId, 'cleared', userId);

/** Reverses without deleting: the payment and its allocations stay on the record,
 *  flagged, and the invoice goes back to owing its full amount. */
export const bounceCheque = (paymentId: string, userId: string) =>
  resolveCheque(paymentId, 'bounced', userId);
