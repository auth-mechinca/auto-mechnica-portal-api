import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { shopFixture, stockOf } from './helpers/fixtures.js';
import type { Db } from '../src/db/client.js';
import { recordSale } from '../src/modules/pos/service.js';
import { updateSettings } from '../src/modules/settings/service.js';
import { paymentAllocations, payments, salesInvoices, stockMovements } from '../src/db/schema/index.js';

let db: Db;
let close: () => Promise<void>;
let shop: Awaited<ReturnType<typeof shopFixture>>;

before(async () => {
  ({ db, close } = await createTestDb());
  shop = await shopFixture(db);
});
after(() => close());

const termsOf = (receipt: { invoiceDate: string; dueDate: string }): number =>
  (Date.parse(receipt.dueDate) - Date.parse(receipt.invoiceDate)) / 86_400_000;

describe('recording a sale', () => {
  it('prices the sale from the database, not from the request', async () => {
    const receipt = await recordSale(
      {
        customerId: null,
        // A client trying to set its own price has nowhere to put it — the input
        // schema has no price field, and the service reads prices.final_price.
        lines: [{ partId: shop.brakePad.id, quantity: 2 }],
        payment: { method: 'cash' },
      },
      shop.sellerId,
    );

    assert.equal(receipt.lines[0]!.unitPrice, '199.00');
    assert.equal(receipt.lines[0]!.lineTotal, '398.00');
    assert.equal(receipt.total, '398.00');
  });

  it('totals several lines exactly, matching the wireframe', async () => {
    const receipt = await recordSale(
      {
        customerId: shop.customerId,
        lines: [
          { partId: shop.brakePad.id, quantity: 2 },
          { partId: shop.airFilter.id, quantity: 1 },
        ],
        payment: { method: 'cash', cashTendered: '1300.00' },
      },
      shop.sellerId,
    );

    // 199.00 x 2 + 33.50 = 431.50
    assert.equal(receipt.total, '431.50');
    assert.equal(receipt.lines.length, 2);
  });

  it('reduces stock and writes a movement explaining it', async () => {
    const before = await stockOf(db, shop.airFilter.id);

    const receipt = await recordSale(
      {
        customerId: null,
        lines: [{ partId: shop.airFilter.id, quantity: 3 }],
        payment: { method: 'cash' },
      },
      shop.sellerId,
    );

    const after = await stockOf(db, shop.airFilter.id);
    assert.equal(Number(after), Number(before) - 3);

    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, receipt.id));

    assert.equal(movements.length, 1);
    assert.equal(movements[0]!.type, 'sale');
    assert.equal(Number(movements[0]!.quantityDelta), -3);
  });

  it('merges two lines for the same part instead of double-counting', async () => {
    const receipt = await recordSale(
      {
        customerId: null,
        lines: [
          { partId: shop.brakePad.id, quantity: 1 },
          { partId: shop.brakePad.id, quantity: 2 },
        ],
        payment: { method: 'cash' },
      },
      shop.sellerId,
    );

    assert.equal(receipt.lines.length, 1);
    assert.equal(receipt.lines[0]!.quantity, '3.000');
    assert.equal(receipt.total, '597.00');
  });

  it('refuses to sell more than is on hand, and changes nothing', async () => {
    const before = await stockOf(db, shop.scarce.id);

    await assert.rejects(
      () =>
        recordSale(
          {
            customerId: null,
            lines: [{ partId: shop.scarce.id, quantity: 5 }],
            payment: { method: 'cash' },
          },
          shop.sellerId,
        ),
      /Not enough stock/,
    );

    assert.equal(await stockOf(db, shop.scarce.id), before, 'stock must be untouched');
  });

  it('refuses a part with no sell price', async () => {
    await assert.rejects(
      () =>
        recordSale(
          {
            customerId: null,
            lines: [{ partId: shop.unpriced.id, quantity: 1 }],
            payment: { method: 'cash' },
          },
          shop.sellerId,
        ),
      /no sell price/,
    );
  });

  it('rejects cash that does not cover the amount due', async () => {
    await assert.rejects(
      () =>
        recordSale(
          {
            customerId: null,
            lines: [{ partId: shop.brakePad.id, quantity: 1 }],
            payment: { method: 'cash', cashTendered: '100.00' },
          },
          shop.sellerId,
        ),
      /less than the amount due/,
    );
  });

  it('rolls the whole sale back when one line fails', async () => {
    const brakeBefore = await stockOf(db, shop.brakePad.id);
    const invoicesBefore = await db.select({ n: sql<number>`count(*)` }).from(salesInvoices);

    await assert.rejects(() =>
      recordSale(
        {
          customerId: null,
          lines: [
            { partId: shop.brakePad.id, quantity: 1 },
            { partId: shop.scarce.id, quantity: 99 },
          ],
          payment: { method: 'cash' },
        },
        shop.sellerId,
      ),
    );

    const invoicesAfter = await db.select({ n: sql<number>`count(*)` }).from(salesInvoices);
    assert.equal(await stockOf(db, shop.brakePad.id), brakeBefore, 'good line must not persist');
    assert.deepEqual(invoicesAfter[0], invoicesBefore[0], 'no invoice may be left behind');
  });
});

describe('payment handling', () => {
  it('clears cash immediately', async () => {
    const receipt = await recordSale(
      {
        customerId: shop.customerId,
        lines: [{ partId: shop.airFilter.id, quantity: 1 }],
        payment: { method: 'cash' },
      },
      shop.sellerId,
    );
    assert.equal(receipt.payment!.status, 'cleared');
  });

  it('records a cheque as pending so no balance moves yet', async () => {
    const receipt = await recordSale(
      {
        customerId: shop.customerId,
        lines: [{ partId: shop.airFilter.id, quantity: 1 }],
        payment: { method: 'cheque', chequeNumber: '000441', bankName: 'GCB Bank' },
      },
      shop.sellerId,
    );

    assert.equal(receipt.payment!.status, 'pending');
    assert.equal(receipt.payment!.cheque!.chequeNumber, '000441');
  });

  it('refuses a cheque from a walk-in — nobody to chase if it bounces', async () => {
    await assert.rejects(
      () =>
        recordSale(
          {
            customerId: null,
            lines: [{ partId: shop.airFilter.id, quantity: 1 }],
            payment: { method: 'cheque', chequeNumber: '000442' },
          },
          shop.sellerId,
        ),
      /needs a named customer/,
    );
  });

  it('clears MoMo immediately and keeps the transaction id', async () => {
    const receipt = await recordSale(
      {
        customerId: shop.customerId,
        lines: [{ partId: shop.airFilter.id, quantity: 1 }],
        payment: {
          method: 'momo',
          network: 'mtn',
          transactionId: 'MP260917.1422.A88213',
          phoneNumber: '0244118820',
        },
      },
      shop.sellerId,
    );

    assert.equal(receipt.payment!.status, 'cleared');
    assert.equal(receipt.payment!.momo!.transactionId, 'MP260917.1422.A88213');
  });

  it('allocates the payment to the invoice it settles', async () => {
    const receipt = await recordSale(
      {
        customerId: shop.customerId,
        lines: [{ partId: shop.airFilter.id, quantity: 2 }],
        payment: { method: 'cash' },
      },
      shop.sellerId,
    );

    const [allocation] = await db
      .select({ amount: paymentAllocations.amount, customerId: payments.customerId })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(eq(paymentAllocations.invoiceId, receipt.id));

    assert.equal(allocation!.amount, '67.00');
    assert.equal(allocation!.customerId, shop.customerId);
  });
});

describe('invoice numbering and terms', () => {
  it('issues sequential, distinct references', async () => {
    const a = await recordSale(
      { customerId: null, lines: [{ partId: shop.airFilter.id, quantity: 1 }], payment: { method: 'cash' } },
      shop.sellerId,
    );
    const b = await recordSale(
      { customerId: null, lines: [{ partId: shop.airFilter.id, quantity: 1 }], payment: { method: 'cash' } },
      shop.sellerId,
    );

    assert.notEqual(a.reference, b.reference);
    assert.match(a.reference, /^INV-\d{4}-\d{4,}$/);
  });

  it('gives a walk-in a due date of today', async () => {
    const receipt = await recordSale(
      { customerId: null, lines: [{ partId: shop.airFilter.id, quantity: 1 }], payment: { method: 'cash' } },
      shop.sellerId,
    );
    assert.equal(receipt.dueDate, receipt.invoiceDate, 'a walk-in owes nothing on leaving');
  });

  it('gives a named customer the shop payment terms', async () => {
    const receipt = await recordSale(
      { customerId: shop.customerId, lines: [{ partId: shop.airFilter.id, quantity: 1 }], payment: { method: 'cash' } },
      shop.sellerId,
    );

    assert.equal(termsOf(receipt), 30);
  });

  /** The due date is stamped on the invoice, not derived on read. Changing the
   *  terms therefore applies to what is raised next and reaches nothing already
   *  issued — otherwise moving 30 days to 45 would re-age the whole ledger and a
   *  customer ten days late would quietly become five days early. */
  it('applies new terms to the next invoice and leaves issued ones where they are', async () => {
    const before = await recordSale(
      { customerId: shop.customerId, lines: [{ partId: shop.airFilter.id, quantity: 1 }], payment: { method: 'cash' } },
      shop.sellerId,
    );

    await updateSettings({ defaultPaymentTermsDays: 45 });

    const after = await recordSale(
      { customerId: shop.customerId, lines: [{ partId: shop.airFilter.id, quantity: 1 }], payment: { method: 'cash' } },
      shop.sellerId,
    );

    assert.equal(termsOf(after), 45, 'the next invoice takes the new terms');

    const [reread] = await db
      .select({ dueDate: salesInvoices.dueDate })
      .from(salesInvoices)
      .where(eq(salesInvoices.id, before.id));
    assert.equal(reread!.dueDate, before.dueDate, 'the issued invoice keeps the terms of its day');

    await updateSettings({ defaultPaymentTermsDays: 30 });
  });
});
