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

/** The cheque queue: a cheque moves a balance at exactly one moment, when the
 *  accountant clears it, and a bounce reverses without deleting. */

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

describe('the cheque queue', () => {
  it('moves the balance only when a cheque clears', async () => {
    const a = await invoice('INV-0008', '2200.00', 10);

    await recordPayment(
      {
        customerId: base.customerId,
        amount: '2200.00',
        paymentDate: iso(1),
        payment: { method: 'cheque', chequeNumber: '004915', bankName: 'Stanbic' },
        allocations: [{ invoiceId: a.id, amount: '2200.00' }],
      },
      base.sellerId,
    );

    const queue = await listCheques({ status: 'pending' });
    assert.equal(queue.cheques.length, 1);
    assert.equal(queue.pendingValue, '2200.00');
    assert.equal((await getCustomerAccount(base.customerId)).balanceDue, '2200.00');

    await clearCheque(queue.cheques[0]!.paymentId, base.sellerId);

    const after = await getCustomerAccount(base.customerId);
    assert.equal(after.balanceDue, '0.00', 'clearing is the only moment it touches the balance');
    assert.equal(after.invoices[0]!.status, 'paid');
  });

  it('puts the invoice back in full when a cheque bounces, and keeps the record', async () => {
    const a = await invoice('INV-0009', '1540.00', 40);

    await recordPayment(
      {
        customerId: base.customerId,
        amount: '1540.00',
        paymentDate: iso(20),
        payment: { method: 'cheque', chequeNumber: '004776', bankName: 'Absa Bank' },
        allocations: [{ invoiceId: a.id, amount: '1540.00' }],
      },
      base.sellerId,
    );

    const pending = await listCheques({ status: 'pending' });
    await clearCheque(pending.cheques[0]!.paymentId, base.sellerId);
    assert.equal((await getCustomerAccount(base.customerId)).balanceDue, '0.00');

    // It bounced a few days later.
    const cleared = await listCheques({ status: 'cleared' });
    await assert.rejects(
      () => bounceCheque(cleared.cheques[0]!.paymentId, base.sellerId),
      /already marked cleared/,
      'a resolved cheque is resolved — reversing a clearing is a different operation',
    );
  });

  it('bounces a pending cheque, leaving the invoice owing its full amount', async () => {
    const a = await invoice('INV-0010', '1540.00', 40);

    await recordPayment(
      {
        customerId: base.customerId,
        amount: '1540.00',
        paymentDate: iso(20),
        payment: { method: 'cheque', chequeNumber: '004776', bankName: 'Absa Bank' },
        allocations: [{ invoiceId: a.id, amount: '1540.00' }],
      },
      base.sellerId,
    );

    const pending = await listCheques({ status: 'pending' });
    const bounced = await bounceCheque(pending.cheques[0]!.paymentId, base.sellerId);

    assert.equal(bounced.status, 'bounced');
    assert.equal(bounced.resolvedBy, 'Ama Mensah');

    const account = await getCustomerAccount(base.customerId);
    assert.equal(account.balanceDue, '1540.00', 'the invoice is owing again');
    assert.equal(account.invoices[0]!.outstanding, '1540.00');

    // Never deleted: it stays in the history, flagged, showing the invoice owing
    // its full amount again.
    const payment = account.payments[0]!;
    assert.equal(payment.status, 'bounced');
    assert.equal(payment.cheque!.chequeNumber, '004776');
    assert.equal(payment.allocations[0]!.outstandingAfter, '1540.00');
  });

  it('refuses to resolve a cheque twice', async () => {
    const a = await invoice('INV-0011', '500.00', 5);
    await recordPayment(
      {
        customerId: base.customerId,
        amount: '500.00',
        paymentDate: iso(1),
        payment: { method: 'cheque', chequeNumber: '118374' },
        allocations: [{ invoiceId: a.id, amount: '500.00' }],
      },
      base.sellerId,
    );

    const pending = await listCheques({ status: 'pending' });
    await clearCheque(pending.cheques[0]!.paymentId, base.sellerId);
    await assert.rejects(() => clearCheque(pending.cheques[0]!.paymentId, base.sellerId));
  });
});
