import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db.js';
import { baseFixture } from './helpers/fixtures.js';
import { createApp } from '../src/app.js';
import { signToken } from '../src/lib/token.js';
import type { Db } from '../src/db/client.js';
import { parts } from '../src/db/schema/index.js';
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  getSupplier,
  receiveStock,
} from '../src/modules/backoffice/service.js';

/** Kept in its own file rather than added to the supplier suite: a single file
 *  holding that many database-backed suites deadlocks node:test before it runs
 *  anything. Splitting also gives this one a clean database. */

let db: Db;
let close: () => Promise<void>;
let server: Server;
let base: Awaited<ReturnType<typeof baseFixture>>;
let token: string;
let supplierId: string;
let brakePadId: string;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  server = createApp().listen(0);
  token = signToken({ sub: base.sellerId, email: 'kofi@demo', role: 'purchasing' });

  const [part] = await db
    .insert(parts)
    .values({ sku: 'SA-3307', name: 'Shock absorber, rear' })
    .returning();
  brakePadId = part!.id;

  const supplier = await createSupplier({
    name: 'Guangzhou Hongfa Auto Parts Co.',
    currency: 'USD',
    isActive: true,
  });
  supplierId = supplier.id;
});

after(async () => {
  server.close();
  await close();
});

describe('short-closing a purchase order', () => {
  /** The supplier sent 12 of 24 and discontinued the line. Without this the
   *  order sits partially received for good: the purchasing officer keeps seeing
   *  stock that is not coming, and the outstanding value is wrong forever. */
  async function partiallyReceived() {
    const order = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-02',
      fxRate: '12.400000',
      lines: [{ partId: brakePadId, quantityOrdered: 24, unitCostUsd: '23.5000' }],
      status: 'sent',
    });

    await receiveStock(
      order.id,
      { lines: [{ lineId: order.lines[0]!.id, quantityReceived: 12 }] },
      base.sellerId,
    );

    return order.id;
  }

  it('writes off what is not coming, and leaves what arrived alone', async () => {
    const id = await partiallyReceived();

    const before = await getPurchaseOrder(id);
    assert.equal(before.status, 'partially_received');
    assert.equal(before.outstandingGhs, '3496.80', '12 x 291.40 still expected');

    const closed = await closePurchaseOrder(id, { reason: 'Supplier discontinued the line' }, base.sellerId);

    assert.equal(closed.status, 'closed');
    assert.equal(closed.outstandingGhs, '0.00', 'nothing more is expected');
    assert.equal(closed.writtenOffGhs, '3496.80', 'and the write-off is visible');
    assert.equal(closed.receivedGhs, '3496.80', 'what arrived is untouched');
    assert.equal(closed.lines[0]!.quantityReceived, '12.000');

    // Somebody will ask why 3,496.80 was written off. The answer is on the order.
    assert.equal(closed.resolution!.reason, 'Supplier discontinued the line');
    assert.equal(closed.resolution!.by, 'Ama Mensah');
    assert.ok(closed.resolution!.at);
  });

  it('stops counting against the supplier as an open order', async () => {
    const id = await partiallyReceived();
    const open = (await getSupplier(supplierId)).openPurchaseOrders;

    await closePurchaseOrder(id, { reason: 'Supplier discontinued the line' }, base.sellerId);

    assert.equal(
      (await getSupplier(supplierId)).openPurchaseOrders,
      open - 1,
      'a closed order is no longer in flight',
    );
  });

  it('refuses to receive against it afterwards', async () => {
    const id = await partiallyReceived();
    const order = await getPurchaseOrder(id);
    await closePurchaseOrder(id, { reason: 'Supplier discontinued the line' }, base.sellerId);

    await assert.rejects(
      () =>
        receiveStock(
          id,
          { lines: [{ lineId: order.lines[0]!.id, quantityReceived: 1 }] },
          base.sellerId,
        ),
      /cannot receive stock/,
    );
  });

  it('cannot be cancelled after closing — stock did arrive', async () => {
    const id = await partiallyReceived();
    await closePurchaseOrder(id, { reason: 'Supplier discontinued the line' }, base.sellerId);
    await assert.rejects(() => cancelPurchaseOrder(id, {}, base.sellerId), /closed — stock arrived/);
  });

  it('is refused when nothing arrived — that is a cancellation', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-02',
      lines: [],
      status: 'draft',
    });
    await assert.rejects(() => closePurchaseOrder(draft.id, { reason: 'Not needed' }, base.sellerId), /cancel it instead/);

    const sent = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-02',
      fxRate: '12.400000',
      lines: [{ partId: brakePadId, quantityOrdered: 6, unitCostUsd: '23.5000' }],
      status: 'sent',
    });
    await assert.rejects(
      () => closePurchaseOrder(sent.id, { reason: 'Not needed' }, base.sellerId),
      /Nothing has arrived/,
      'writing off an order that delivered nothing is just a cancellation',
    );
  });

  it('is refused on an order where everything arrived', async () => {
    const order = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-02',
      fxRate: '12.400000',
      lines: [{ partId: brakePadId, quantityOrdered: 4, unitCostUsd: '23.5000' }],
      status: 'sent',
    });
    await receiveStock(
      order.id,
      { lines: [{ lineId: order.lines[0]!.id, quantityReceived: 4 }] },
      base.sellerId,
    );

    await assert.rejects(() => closePurchaseOrder(order.id, { reason: 'Nothing left' }, base.sellerId), /nothing to write off/);
  });

  it('will not write value off without saying why', async () => {
    const id = await partiallyReceived();

    const res = await request(server)
      .post(`/api/backoffice/purchase-orders/${id}/close`)
      .set({ Authorization: `Bearer ${token}` })
      .send({});

    assert.equal(res.status, 400, 'a write-off has to carry a reason');
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('closes over HTTP and can be filtered for', async () => {
    const id = await partiallyReceived();

    const res = await request(server)
      .post(`/api/backoffice/purchase-orders/${id}/close`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ reason: 'Supplier discontinued SPK-NGK-4T' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'closed');
    assert.equal(res.body.resolution.reason, 'Supplier discontinued SPK-NGK-4T');

    const list = await request(server)
      .get('/api/backoffice/purchase-orders?status=closed')
      .set({ Authorization: `Bearer ${token}` });
    assert.ok(list.body.some((o: { id: string }) => o.id === id));
  });
});
