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

/** The two rules this module exists to keep:
 *    a balance is derived from invoices minus cleared payments, and
 *    a bounce reverses without deleting.
 */

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
        method: { kind: 'cash' },
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
        method: { kind: 'cheque', chequeNumber: '004915', bankName: 'Stanbic' },
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

describe('the cheque queue', () => {
  it('moves the balance only when a cheque clears', async () => {
    const a = await invoice('INV-0008', '2200.00', 10);

    await recordPayment(
      {
        customerId: base.customerId,
        amount: '2200.00',
        paymentDate: iso(1),
        method: { kind: 'cheque', chequeNumber: '004915', bankName: 'Stanbic' },
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
        method: { kind: 'cheque', chequeNumber: '004776', bankName: 'Absa Bank' },
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
        method: { kind: 'cheque', chequeNumber: '004776', bankName: 'Absa Bank' },
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
        method: { kind: 'cheque', chequeNumber: '118374' },
        allocations: [{ invoiceId: a.id, amount: '500.00' }],
      },
      base.sellerId,
    );

    const pending = await listCheques({ status: 'pending' });
    await clearCheque(pending.cheques[0]!.paymentId, base.sellerId);
    await assert.rejects(() => clearCheque(pending.cheques[0]!.paymentId, base.sellerId));
  });
});

describe('recording a payment', () => {
  it('allows part of it to sit unallocated against the account', async () => {
    const a = await invoice('INV-0012', '2000.00', 10);

    const account = await recordPayment(
      {
        customerId: base.customerId,
        amount: '3000.00',
        paymentDate: iso(1),
        method: { kind: 'cash' },
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
            method: { kind: 'cash' },
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
            method: { kind: 'cash' },
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
        method: {
          kind: 'momo',
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
