import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db.js';
import { baseFixture, purchaseOrderFixture } from './helpers/fixtures.js';
import { tokenFor } from './helpers/auth.js';
import { createApp } from '../src/app.js';
import { signToken } from '../src/lib/token.js';
import type { Db } from '../src/db/client.js';
import { receiveStock } from '../src/modules/backoffice/service.js';
import {
  adjustStock,
  createPart,
  getPart,
  listAdjustments,
  listLowStock,
} from '../src/modules/ims/service.js';

/** Stock is never typed. It moves through a receipt, a sale, or an adjustment
 *  that carries a reason — and every movement leaves a row explaining itself. */

let db: Db;
let close: () => Promise<void>;
let server: Server;
let base: Awaited<ReturnType<typeof baseFixture>>;
let po: Awaited<ReturnType<typeof purchaseOrderFixture>>;
let token: string;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  po = await purchaseOrderFixture(db);
  server = createApp().listen(0);
  token = tokenFor(base, 'purchasing');

  // Reorder points, so "low stock" means something: the fixture parts default to
  // zero, and everything at zero is trivially at its reorder point.
  const { parts } = await import('../src/db/schema/index.js');
  const { inArray } = await import('drizzle-orm');
  await db
    .update(parts)
    .set({ reorderPoint: 6 })
    .where(inArray(parts.id, [po.shock.partId, po.waterPump.partId]));

  // 40 brake pads arrive, so there is a real ledger to adjust against.
  await receiveStock(
    po.orderId,
    { lines: [{ lineId: po.brakePad.lineId, quantityReceived: 40 }] },
    base.sellerId,
  );
});

after(async () => {
  server.close();
  await close();
});

describe('adjusting stock', () => {
  it('moves the balance and records why', async () => {
    const after = await adjustStock(
      po.brakePad.partId,
      { direction: 'decrease', quantity: 3, reason: 'damage', note: 'Crushed in transit' },
      base.sellerId,
    );

    assert.equal(Number(after.onHand), 37);

    const [latest] = after.movements;
    assert.equal(latest!.type, 'adjustment');
    assert.equal(latest!.quantityDelta, '-3.000');
    assert.equal(latest!.reason, 'damage');
    assert.equal(latest!.note, 'Crushed in transit');
    assert.equal(latest!.by, 'Ama Mensah');
  });

  it('increases as well', async () => {
    const after = await adjustStock(
      po.brakePad.partId,
      { direction: 'increase', quantity: 1, reason: 'count_correction' },
      base.sellerId,
    );
    assert.equal(Number(after.onHand), 38);
  });

  it('refuses to take stock below zero', async () => {
    await assert.rejects(
      () =>
        adjustStock(
          po.brakePad.partId,
          { direction: 'decrease', quantity: 999, reason: 'loss' },
          base.sellerId,
        ),
      /only 38.000 on hand/,
    );

    assert.equal(Number((await getPart(po.brakePad.partId)).onHand), 38, 'unchanged');
  });

  it('keeps a running balance that ends at the figure on the part', async () => {
    const part = await getPart(po.brakePad.partId);

    // Movements come back newest first, so the first row is the current balance.
    assert.equal(part.movements[0]!.onHandAfter, part.onHand);

    // And the ledger adds up to it.
    const ledger = part.movements.reduce((n, m) => n + Number(m.quantityDelta), 0);
    assert.equal(ledger, Number(part.onHand));
  });

  it('names the purchase order that delivered the stock', async () => {
    const part = await getPart(po.brakePad.partId);
    const receipt = part.movements.find((m) => m.type === 'po_receipt')!;
    assert.equal(receipt.reference, 'PO-2026-0031');
  });

  it('lists recent adjustments across parts', async () => {
    const adjustments = await listAdjustments();
    assert.equal(adjustments.length, 2);
    assert.equal(adjustments[0]!.sku, 'BP-2042');
    assert.ok(adjustments.every((a) => a.reason));
  });

  it('refuses to adjust an inactive part', async () => {
    const part = await createPart({
      sku: 'OLD-0001',
      name: 'Discontinued thing',
      fitment: [],
      reorderPoint: 0,
      isActive: false,
    });

    await assert.rejects(
      () => adjustStock(part.id, { direction: 'increase', quantity: 1, reason: 'loss' }, base.sellerId),
      /inactive/,
    );
  });
});

describe('low stock', () => {
  it('lists what is at or below its reorder point, worst first', async () => {
    // Water pump was never received, so it sits at zero against a reorder point.
    const low = await listLowStock();
    const skus = low.map((r) => r.sku);

    assert.ok(skus.includes('WP-2290'));
    assert.ok(!skus.includes('BP-2042'), '38 on hand against a reorder point of 0');
  });

  it('says how short, who usually supplies it, and what is already on order', async () => {
    const low = await listLowStock();
    const shock = low.find((r) => r.sku === 'SA-3307')!;

    assert.equal(shock.onHand, '0.000');
    assert.equal(shock.reorderPoint, 6);
    assert.equal(shock.shortBy, '6.000', 'nothing on hand against a reorder point of 6');
    assert.equal(shock.usualSupplier!.name, 'Guangzhou Hongfa Auto Parts Co.');

    // 24 were ordered and none received, so reordering now would double up.
    assert.equal(shock.onOrder!.quantity, '24.000');
    assert.equal(shock.onOrder!.reference, 'PO-2026-0031');
  });

  it('records when a part was last received', async () => {
    const low = await listLowStock();
    const pump = low.find((r) => r.sku === 'WP-2290')!;
    assert.equal(pump.lastReceived, null, 'nothing has ever arrived');
  });
});

describe('over HTTP', () => {
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('adjusts', async () => {
    const res = await request(server)
      .post(`/api/ims/parts/${po.brakePad.partId}/adjust`)
      .set(auth())
      .send({ direction: 'decrease', quantity: 2, reason: 'loss' });

    assert.equal(res.status, 200);
    assert.equal(Number(res.body.onHand), 36);
  });

  it('will not adjust without a reason', async () => {
    const res = await request(server)
      .post(`/api/ims/parts/${po.brakePad.partId}/adjust`)
      .set(auth())
      .send({ direction: 'decrease', quantity: 1 });

    assert.equal(res.status, 400, 'an adjustment with no reason is just editing stock');
  });

  it('serves the low stock list', async () => {
    const res = await request(server).get('/api/ims/low-stock').set(auth());
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('keeps Sales out of the catalogue', async () => {
    const sales = tokenFor(base, 'sales');
    const res = await request(server)
      .get('/api/ims/parts?status=active')
      .set('Authorization', `Bearer ${sales}`);
    assert.equal(res.status, 403);
  });
});
