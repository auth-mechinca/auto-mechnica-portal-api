import './helpers/env.js';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { baseFixture } from './helpers/fixtures.js';
import type { Db } from '../src/db/client.js';
import { salesInvoices } from '../src/db/schema/index.js';
import {
  bounceCheque,
  clearCheque,
  getCustomerAccount,
  listCheques,
  listCustomerAccounts,
  recordPayment,
} from '../src/modules/financial/service.js';

/** Recording a payment that arrives after the counter — allocation rules, and
 *  what the API refuses. */

let db: Db;
let close: () => Promise<void>;
let base: Awaited<ReturnType<typeof baseFixture>>;

const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** An invoice raised `daysAgo`, due 30 days after that. */
async function invoice(reference: string, total: string, daysAgo: number) {
  const [row] = await db
    .insert(salesInvoices)
    .values({
      reference,
      customerId: base.customerId,
      invoiceDate: iso(daysAgo),
      dueDate: iso(daysAgo - 30),
      totalAmount: total,
      soldBy: base.sellerId,
    })
    .returning();
  return row!;
}

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
});
after(() => close());

/** Each test starts from no invoices and no payments. The suites here assert
 *  totals, so a row left behind by the previous test would show up inside the
 *  next one's arithmetic. */
beforeEach(async () => {
  await db.execute(sql`truncate table app.payment_allocations, app.cheques,
                                      app.momo_transactions, app.payments,
                                      app.sales_invoices cascade`);
});

describe('recording a payment', () => {
  it('allows part of it to sit unallocated against the account', async () => {
    const a = await invoice('INV-0012', '2000.00', 10);

    const account = await recordPayment(
      {
        customerId: base.customerId,
        amount: '3000.00',
        paymentDate: iso(1),
        payment: { method: 'cash' },
        allocations: [{ invoiceId: a.id, amount: '2000.00' }],
      },
      base.sellerId,
    );

    assert.equal(account.payments[0]!.unallocated, '1000.00');
  });

  it('refuses to allocate more than the payment', async () => {
    const a = await invoice('INV-0013', '5000.00', 10);
    await assert.rejects(
      () =>
        recordPayment(
          {
            customerId: base.customerId,
            amount: '1000.00',
            paymentDate: iso(1),
            payment: { method: 'cash' },
            allocations: [{ invoiceId: a.id, amount: '2000.00' }],
          },
          base.sellerId,
        ),
      /more than the payment/,
    );
  });

  it('refuses to allocate more than an invoice still owes', async () => {
    const a = await invoice('INV-0014', '1000.00', 10);
    await assert.rejects(
      () =>
        recordPayment(
          {
            customerId: base.customerId,
            amount: '5000.00',
            paymentDate: iso(1),
            payment: { method: 'cash' },
            allocations: [{ invoiceId: a.id, amount: '1500.00' }],
          },
          base.sellerId,
        ),
      /exceeds the 1000.00 outstanding/,
    );
  });

  it('records MoMo as cleared straight away', async () => {
    const a = await invoice('INV-0015', '4850.00', 10);

    const account = await recordPayment(
      {
        customerId: base.customerId,
        amount: '4850.00',
        paymentDate: iso(1),
        payment: {
          method: 'momo',
          network: 'mtn',
          transactionId: 'MP260915.1102.B77410',
          phoneNumber: '0244810192',
        },
        allocations: [{ invoiceId: a.id, amount: '4850.00' }],
      },
      base.sellerId,
    );

    assert.equal(account.payments[0]!.status, 'cleared');
    assert.equal(account.balanceDue, '0.00');
    assert.equal(account.payments[0]!.momo!.network, 'mtn');
  });
});
