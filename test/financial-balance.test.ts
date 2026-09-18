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

/** A balance is derived from invoices minus cleared payments. There is no
 *  balance column and no endpoint that can set one — which is the whole point,
 *  so it is asserted rather than assumed. */

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

describe('a balance is derived', () => {
  it('is invoices minus cleared payments, with nothing to type into', async () => {
    const a = await invoice('INV-0001', '6120.00', 40);
    await invoice('INV-0002', '1780.00', 100);

    await recordPayment(
      {
        customerId: base.customerId,
        amount: '2000.00',
        paymentDate: iso(5),
        payment: { method: 'cash' },
        allocations: [{ invoiceId: a.id, amount: '2000.00' }],
      },
      base.sellerId,
    );

    const account = await getCustomerAccount(base.customerId);
    assert.equal(account.totalAmount, '7900.00');
    assert.equal(account.paid, '2000.00');
    assert.equal(account.balanceDue, '5900.00');
  });

  it('does not count a pending cheque', async () => {
    const a = await invoice('INV-0003', '5000.00', 10);

    await recordPayment(
      {
        customerId: base.customerId,
        amount: '5000.00',
        paymentDate: iso(1),
        payment: { method: 'cheque', chequeNumber: '004915', bankName: 'Stanbic' },
        allocations: [{ invoiceId: a.id, amount: '5000.00' }],
      },
      base.sellerId,
    );

    const account = await getCustomerAccount(base.customerId);
    assert.equal(account.paid, '0.00', 'a promise is not a payment');
    assert.equal(account.balanceDue, '5000.00');
    assert.equal(account.invoices[0]!.status, 'outstanding');
  });

  it('chases on the oldest unpaid invoice, not the newest', async () => {
    await invoice('INV-0004', '1000.00', 100); // due 70 days ago
    await invoice('INV-0005', '1000.00', 10); // not due yet

    const account = await getCustomerAccount(base.customerId);
    assert.equal(account.oldestUnpaidDueDate, iso(70));
    assert.equal(account.daysLate, 70);
  });

  it('buckets ageing per invoice, so one late invoice is not hidden by a current one', async () => {
    await invoice('INV-0006', '3780.00', 105); // 75 days late
    await invoice('INV-0007', '5000.00', 10); // not due

    const list = await listCustomerAccounts({});
    assert.equal(list.ageing.days61to90, '3780.00');
    assert.equal(list.ageing.current, '5000.00');
    assert.equal(list.summary.over60Days, '3780.00');
    assert.equal(list.summary.customersOver60, 1);
  });
});
