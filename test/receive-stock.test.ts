import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, desc, eq } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { baseFixture, purchaseOrderFixture, stockOf } from './helpers/fixtures.js';
import type { Db } from '../src/db/client.js';
import { getPurchaseOrder, receiveStock } from '../src/modules/backoffice/service.js';
import { priceHistory, prices, purchaseOrders, stockMovements } from '../src/db/schema/index.js';

/** The figures below are read straight off the ReceiveStock and PODetail
 *  wireframes, so a failure here means the API and the design disagree. */

let db: Db;
let close: () => Promise<void>;
let base: Awaited<ReturnType<typeof baseFixture>>;
let po: Awaited<ReturnType<typeof purchaseOrderFixture>>;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  po = await purchaseOrderFixture(db);
});
after(() => close());

describe('receiving stock', () => {
  it('turns a USD cost into a Cedi landed cost at the order FX rate', async () => {
    const result = await receiveStock(
      po.orderId,
      {
        lines: [
          { lineId: po.brakePad.lineId, quantityReceived: 40 },
          { lineId: po.shock.lineId, quantityReceived: 12 },
        ],
      },
      base.sellerId,
    );

    const brake = result.received.find((r) => r.sku === 'BP-2042')!;
    const shock = result.received.find((r) => r.sku === 'SA-3307')!;

    // 11.80 x 12.4000 = 146.32 and 23.50 x 12.4000 = 291.40, per the wireframe.
    assert.equal(brake.landedCost, '146.32');
    assert.equal(shock.landedCost, '291.40');

    // 40 x 146.32 + 12 x 291.40 = 9,349.60 — the "Value received" on the screen.
    assert.equal(result.valueReceivedGhs, '9349.60');
  });

  it('suggests a sell price at the shop margin', async () => {
    const [row] = await db
      .select()
      .from(prices)
      .where(eq(prices.partId, po.shock.partId))
      .limit(1);

    // 291.40 x 1.35 = 393.39, exactly as the Prices screen shows.
    assert.equal(row!.suggestedPrice, '393.39');
    assert.equal(row!.landedCost, '291.40');
  });

  it('prices an unpriced part at the suggestion', async () => {
    const [row] = await db
      .select()
      .from(prices)
      .where(eq(prices.partId, po.brakePad.partId))
      .limit(1);

    assert.equal(row!.finalPrice, row!.suggestedPrice, 'nobody had priced it, so take the suggestion');
  });

  it('increases stock and writes a movement for each line', async () => {
    assert.equal(Number(await stockOf(db, po.brakePad.partId)), 40);
    assert.equal(Number(await stockOf(db, po.shock.partId)), 12);

    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.type, 'po_receipt'));

    assert.equal(movements.length, 2);
    assert.ok(movements.every((m) => Number(m.quantityDelta) > 0));
  });

  it('records the cost basis in price history, attributed to no one', async () => {
    const [entry] = await db
      .select()
      .from(priceHistory)
      .where(and(eq(priceHistory.partId, po.shock.partId), eq(priceHistory.source, 'po_receipt')))
      .orderBy(desc(priceHistory.createdAt))
      .limit(1);

    assert.equal(entry!.landedCost, '291.40');
    assert.equal(entry!.changedBy, null, 'the system re-suggested this; nobody typed it');
  });

  it('leaves the order partially received while anything is outstanding', async () => {
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, po.orderId))
      .limit(1);

    assert.equal(order!.status, 'partially_received');
  });

  it('reports the same totals as the PO detail screen', async () => {
    const detail = await getPurchaseOrder(po.orderId);

    assert.equal(detail.totalUsd, '1345.60');
    assert.equal(detail.totalGhs, '16685.44');
    assert.equal(detail.receivedGhs, '9349.60');
    assert.equal(detail.outstandingGhs, '7335.84');
    assert.equal(detail.orderedUnits, 82);
    assert.equal(detail.receivedUnits, 52);
  });

  it('groups the movements of one delivery into a single receipt', async () => {
    const detail = await getPurchaseOrder(po.orderId);

    assert.equal(detail.receipts.length, 1, 'two lines, one delivery');
    assert.equal(detail.receipts[0]!.lines.length, 2);
    assert.equal(detail.receipts[0]!.valueGhs, '9349.60');
    assert.equal(detail.receipts[0]!.receivedBy, 'Ama Mensah');
  });

  it('refuses to receive more than is outstanding', async () => {
    await assert.rejects(
      () =>
        receiveStock(
          po.orderId,
          { lines: [{ lineId: po.shock.lineId, quantityReceived: 99 }] },
          base.sellerId,
        ),
      /would exceed the 12 still outstanding/,
    );
  });

  it('refuses a line belonging to another order', async () => {
    await assert.rejects(
      () =>
        receiveStock(
          po.orderId,
          {
            lines: [
              { lineId: '99999999-9999-4999-8999-999999999999', quantityReceived: 1 },
            ],
          },
          base.sellerId,
        ),
      /is not on this purchase order/,
    );
  });

  it('keeps the original FX rate on a later delivery', async () => {
    const result = await receiveStock(
      po.orderId,
      {
        lines: [
          { lineId: po.shock.lineId, quantityReceived: 12 },
          { lineId: po.waterPump.lineId, quantityReceived: 18 },
        ],
      },
      base.sellerId,
    );

    // The rate does not move with a later delivery — PODetail says so explicitly.
    assert.equal(result.received.find((r) => r.sku === 'SA-3307')!.landedCost, '291.40');
    // 17.20 x 12.4000 = 213.28
    assert.equal(result.received.find((r) => r.sku === 'WP-2290')!.landedCost, '213.28');
    assert.equal(result.statusAfter, 'received', 'everything has now arrived');
  });

  it('will not receive against an order that is already complete', async () => {
    await assert.rejects(
      () =>
        receiveStock(
          po.orderId,
          { lines: [{ lineId: po.brakePad.lineId, quantityReceived: 1 }] },
          base.sellerId,
        ),
      /received purchase order cannot receive stock/,
    );
  });
});
