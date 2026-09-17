import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Tx } from '../../db/client.js';
import {
  cheques,
  customers,
  inventoryBalances,
  momoTransactions,
  parts,
  paymentAllocations,
  payments,
  prices,
  salesInvoiceLines,
  salesInvoices,
  stockMovements,
  users,
} from '../../db/schema/index.js';
import { defaultLocationId, settingValue } from '../../db/defaults.js';
import { ApiError } from '../../lib/http.js';
import { compare, multiply, sum } from '../../lib/money.js';

/** Point of sale. Section 3 of the demo scope.
 *
 *  Sales staff never see cost or the suggested price — not because the UI hides
 *  them, but because no query in this file selects them.
 */

/* ------------------------------------------------------------------ input */

export const searchInput = z.object({
  q: z.string().trim().min(1).max(100),
});
export type SearchInput = z.infer<typeof searchInput>;

const cashPayment = z.object({
  method: z.literal('cash'),
  /** What the customer handed over. Used to compute change and to reject a
   *  short payment; deliberately not stored — the till drawer is not a ledger. */
  cashTendered: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

const chequePayment = z.object({
  method: z.literal('cheque'),
  chequeNumber: z.string().trim().min(1).max(50),
  bankName: z.string().trim().min(1).max(100).optional(),
});

const momoPayment = z.object({
  method: z.literal('momo'),
  network: z.enum(['mtn', 'telecel', 'airteltigo']),
  transactionId: z.string().trim().min(1).max(100),
  phoneNumber: z.string().trim().min(1).max(30),
});

export const saleIdParam = z.object({ id: z.string().uuid() });
export type SaleIdParam = z.infer<typeof saleIdParam>;

export const recordSaleInput = z.object({
  /** Null is a walk-in: settled in full at the till, never reaches an account. */
  customerId: z.string().uuid().nullable().default(null),
  lines: z
    .array(
      z.object({
        partId: z.string().uuid(),
        quantity: z.number().int().positive().max(10_000),
      }),
    )
    .min(1),
  payment: z.discriminatedUnion('method', [cashPayment, chequePayment, momoPayment]),
});
export type RecordSaleInput = z.infer<typeof recordSaleInput>;

/* ----------------------------------------------------------------- output */

/* Response shapes are declared as zod schemas and the TypeScript types are
 * inferred from them, so the OpenAPI document and the compiler are reading the
 * same declaration. A handler that returns the wrong shape fails to compile,
 * which is what keeps the published contract honest. */

export const searchResult = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  partNumber: z.string().nullable(),
  fitment: z.array(z.string()),
  /** Null when Price Management has not set one. Such a part cannot be sold. */
  sellPrice: z.string().nullable(),
  inStock: z.string(),
});
export type SearchResult = z.infer<typeof searchResult>;

export const receipt = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  customer: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  soldBy: z.object({ id: z.string().uuid(), fullName: z.string() }).nullable(),
  lines: z.array(
    z.object({
      partId: z.string().uuid(),
      sku: z.string(),
      name: z.string(),
      quantity: z.string(),
      unitPrice: z.string(),
      lineTotal: z.string(),
    }),
  ),
  total: z.string(),
  payment: z
    .object({
      method: z.enum(['cash', 'cheque', 'momo']),
      status: z.enum(['pending', 'cleared', 'bounced']),
      amount: z.string(),
      cheque: z.object({ chequeNumber: z.string(), bankName: z.string().nullable() }).optional(),
      momo: z
        .object({
          network: z.enum(['mtn', 'telecel', 'airteltigo']),
          transactionId: z.string(),
          phoneNumber: z.string(),
        })
        .optional(),
    })
    .nullable(),
});
export type Receipt = z.infer<typeof receipt>;

/* ---------------------------------------------------------------- helpers */

/** Ghana keeps UTC+0 all year, so the UTC date is the shop's date. */
const today = (): string => new Date().toISOString().slice(0, 10);

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/* --------------------------------------------------------------- searching */

export async function searchParts({ q }: SearchInput): Promise<SearchResult[]> {
  const db = getDb();
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  // Note what is absent: landed_cost and suggested_price are never selected, so
  // a Sales session cannot see them even if a future response shape leaked the
  // whole row. Section 6.3.
  const { rows } = await db.execute<SearchResult>(sql`
    select p.id,
           p.sku,
           p.name,
           p.brand,
           p.part_number       as "partNumber",
           p.fitment,
           pr.final_price      as "sellPrice",
           coalesce(b.quantity, '0') as "inStock"
    from ${parts} p
    left join ${prices} pr on pr.part_id = p.id
    left join ${inventoryBalances} b on b.part_id = p.id
    where p.is_active
      and (
        p.name ilike ${pattern}
        or p.sku ilike ${pattern}
        or p.part_number ilike ${pattern}
        or p.oem_number ilike ${pattern}
        or exists (select 1 from unnest(p.fitment) as f where f ilike ${pattern})
      )
    order by p.name
    limit 50
  `);

  return rows;
}

/* ----------------------------------------------------------------- selling */

/** Two lines for the same part are one line. The counter UI increments a row
 *  rather than adding a second, but an API client can do either. */
function mergeLines(lines: RecordSaleInput['lines']) {
  const merged = new Map<string, number>();
  for (const line of lines) {
    merged.set(line.partId, (merged.get(line.partId) ?? 0) + line.quantity);
  }
  // Sorted so that concurrent sales lock rows in the same order. Two tills
  // selling the same two parts in opposite orders would otherwise deadlock.
  return [...merged.entries()]
    .map(([partId, quantity]) => ({ partId, quantity }))
    .sort((a, b) => a.partId.localeCompare(b.partId));
}

export async function recordSale(input: RecordSaleInput, soldBy: string): Promise<Receipt> {
  const lines = mergeLines(input.lines);

  // A bounced cheque has to be chased to somebody, so it cannot belong to a
  // walk-in. Checked before the transaction opens: nothing about this needs the
  // database to answer it.
  if (input.payment.method === 'cheque' && input.customerId === null) {
    throw ApiError.badRequest(
      'A cheque needs a named customer — a walk-in cheque leaves nobody to chase if it bounces',
    );
  }

  return getDb().transaction(async (tx) => {
    const locationId = await defaultLocationId(tx);

    if (input.customerId !== null) {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, input.customerId), eq(customers.isActive, true)))
        .limit(1);
      if (!customer) throw ApiError.badRequest('Unknown customer');
    }

    const priced: {
      partId: string;
      sku: string;
      name: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
    }[] = [];

    for (const line of lines) {
      // Lock the balance for the life of the transaction, so two tills cannot
      // both read the last unit and both sell it. This is its own statement
      // rather than part of the join below for two reasons: Postgres rejects
      // FOR UPDATE against the nullable side of an outer join, and FOR UPDATE OF
      // will not take a schema-qualified name, which is what a join would need.
      const [balance] = await tx
        .select({ quantity: inventoryBalances.quantity })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.partId, line.partId),
            eq(inventoryBalances.locationId, locationId),
          ),
        )
        .for('update')
        .limit(1);

      const [row] = await tx
        .select({
          sku: parts.sku,
          name: parts.name,
          isActive: parts.isActive,
          finalPrice: prices.finalPrice,
        })
        .from(parts)
        .leftJoin(prices, eq(prices.partId, parts.id))
        .where(eq(parts.id, line.partId))
        .limit(1);

      if (!row || !row.isActive) throw ApiError.badRequest(`Unknown part: ${line.partId}`);

      // The price is read here, never taken from the request. A client that
      // posts its own price is ignored, which is the point of Section 6.3.
      if (row.finalPrice === null) {
        throw ApiError.badRequest(`${row.name} has no sell price set — see Price Management`);
      }

      // No balance row at all means the part has never been stocked here.
      const onHand = balance?.quantity ?? '0';
      if (compare(onHand, String(line.quantity)) < 0) {
        throw ApiError.conflict(
          `Not enough stock for ${row.name}: ${onHand} on hand, ${line.quantity} requested`,
        );
      }

      priced.push({
        partId: line.partId,
        sku: row.sku,
        name: row.name,
        quantity: line.quantity,
        unitPrice: row.finalPrice,
        lineTotal: multiply(row.finalPrice, String(line.quantity)),
      });
    }

    const total = sum(priced.map((line) => line.lineTotal));

    if (input.payment.method === 'cash' && input.payment.cashTendered !== undefined) {
      if (compare(input.payment.cashTendered, total) < 0) {
        throw ApiError.badRequest(
          `Cash tendered (${input.payment.cashTendered}) is less than the amount due (${total})`,
        );
      }
    }

    const invoiceDate = today();
    const termsDays = Number(await settingValue(tx, 'default_payment_terms_days', '30'));
    // A walk-in owes nothing after leaving the counter, so it is due the day it
    // is raised. Terms only mean something for a named account.
    const dueDate = input.customerId === null ? invoiceDate : addDays(invoiceDate, termsDays);

    const { rows: numbered } = await tx.execute<{ next: string }>(
      sql`select nextval('app.invoice_number_seq')::text as next`,
    );
    const reference = `INV-${invoiceDate.slice(0, 4)}-${numbered[0]!.next.padStart(4, '0')}`;

    const [invoice] = await tx
      .insert(salesInvoices)
      .values({
        reference,
        customerId: input.customerId,
        invoiceDate,
        dueDate,
        totalAmount: total,
        soldBy,
      })
      .returning();

    for (const line of priced) {
      await tx.insert(salesInvoiceLines).values({
        invoiceId: invoice!.id,
        partId: line.partId,
        quantity: String(line.quantity),
        // Copied, not joined: a later price change must not rewrite what was sold.
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      });

      await tx.insert(stockMovements).values({
        partId: line.partId,
        locationId,
        type: 'sale',
        quantityDelta: `-${line.quantity}`,
        referenceId: invoice!.id,
        createdBy: soldBy,
      });

      await tx
        .update(inventoryBalances)
        .set({
          quantity: sql`${inventoryBalances.quantity} - ${String(line.quantity)}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryBalances.partId, line.partId),
            eq(inventoryBalances.locationId, locationId),
          ),
        );
    }

    // Cash and MoMo are money in hand. A cheque is a promise, so it is recorded
    // pending and moves no balance until the Accountant clears it (Section 5).
    const status = input.payment.method === 'cheque' ? 'pending' : 'cleared';

    const [payment] = await tx
      .insert(payments)
      .values({
        customerId: input.customerId,
        method: input.payment.method,
        amount: total,
        status,
        paymentDate: invoiceDate,
        recordedBy: soldBy,
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

    // Ties the money to this invoice specifically, rather than to the account in
    // general. A pending cheque is allocated too — the allocation is what it
    // will settle once it clears, and every balance query counts cleared only.
    await tx.insert(paymentAllocations).values({
      paymentId: payment!.id,
      invoiceId: invoice!.id,
      amount: total,
    });

    return buildReceipt(tx, invoice!.id);
  });
}

/* ---------------------------------------------------------------- receipts */

async function buildReceipt(tx: Tx, invoiceId: string): Promise<Receipt> {
  const [invoice] = await tx
    .select({
      id: salesInvoices.id,
      reference: salesInvoices.reference,
      invoiceDate: salesInvoices.invoiceDate,
      dueDate: salesInvoices.dueDate,
      totalAmount: salesInvoices.totalAmount,
      customerId: customers.id,
      customerName: customers.name,
      soldById: users.id,
      soldByName: users.fullName,
    })
    .from(salesInvoices)
    .leftJoin(customers, eq(customers.id, salesInvoices.customerId))
    .leftJoin(users, eq(users.id, salesInvoices.soldBy))
    .where(eq(salesInvoices.id, invoiceId))
    .limit(1);

  if (!invoice) throw ApiError.notFound('Sale not found');

  const lines = await tx
    .select({
      partId: salesInvoiceLines.partId,
      sku: parts.sku,
      name: parts.name,
      quantity: salesInvoiceLines.quantity,
      unitPrice: salesInvoiceLines.unitPrice,
      lineTotal: salesInvoiceLines.lineTotal,
    })
    .from(salesInvoiceLines)
    .innerJoin(parts, eq(parts.id, salesInvoiceLines.partId))
    .where(eq(salesInvoiceLines.invoiceId, invoiceId))
    .orderBy(asc(parts.name));

  const [paid] = await tx
    .select({
      method: payments.method,
      status: payments.status,
      amount: payments.amount,
      chequeNumber: cheques.chequeNumber,
      bankName: cheques.bankName,
      network: momoTransactions.network,
      transactionId: momoTransactions.transactionId,
      phoneNumber: momoTransactions.phoneNumber,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .leftJoin(cheques, eq(cheques.paymentId, payments.id))
    .leftJoin(momoTransactions, eq(momoTransactions.paymentId, payments.id))
    .where(eq(paymentAllocations.invoiceId, invoiceId))
    .limit(1);

  return {
    id: invoice.id,
    reference: invoice.reference,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    customer: invoice.customerId ? { id: invoice.customerId, name: invoice.customerName! } : null,
    soldBy: invoice.soldById ? { id: invoice.soldById, fullName: invoice.soldByName! } : null,
    lines,
    total: invoice.totalAmount,
    payment: paid
      ? {
          method: paid.method,
          status: paid.status,
          amount: paid.amount,
          ...(paid.chequeNumber
            ? { cheque: { chequeNumber: paid.chequeNumber, bankName: paid.bankName } }
            : {}),
          ...(paid.network
            ? {
                momo: {
                  network: paid.network,
                  transactionId: paid.transactionId!,
                  phoneNumber: paid.phoneNumber!,
                },
              }
            : {}),
        }
      : null,
  };
}

export async function getSale(invoiceId: string): Promise<Receipt> {
  return getDb().transaction((tx) => buildReceipt(tx, invoiceId));
}
