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
import {
  getPrice,
  listPrices,
  receiveStock,
  setFinalPrice,
} from '../src/modules/backoffice/service.js';
import { updateSettings } from '../src/modules/settings/service.js';

let db: Db;
let close: () => Promise<void>;
let server: Server;
let base: Awaited<ReturnType<typeof baseFixture>>;
let po: Awaited<ReturnType<typeof purchaseOrderFixture>>;
let purchasingToken: string;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  po = await purchaseOrderFixture(db);
  server = createApp().listen(0);
  purchasingToken = tokenFor(base, 'purchasing');

  // Prices only exist once stock has been received against a cost.
  await receiveStock(
    po.orderId,
    {
      lines: [
        { lineId: po.brakePad.lineId, quantityReceived: 40 },
        { lineId: po.shock.lineId, quantityReceived: 24 },
      ],
    },
    base.sellerId,
  );
});

after(async () => {
  server.close();
  await close();
});

describe('listing prices', () => {
  it('shows a freshly received part as confirmed', async () => {
    const rows = await listPrices({});
    const brake = rows.find((r) => r.sku === 'BP-2042')!;

    // 11.80 x 12.40 = 146.32 landed; 146.32 / 0.65 = 225.11 at a 35% margin.
    assert.equal(brake.landedCost, '146.32');
    assert.equal(brake.suggestedPrice, '225.11');
    assert.equal(brake.finalPrice, '225.11', 'nobody had priced it, so it took the suggestion');
    assert.equal(brake.status, 'confirmed');
  });

  it('omits parts that have never been priced', async () => {
    const rows = await listPrices({});
    assert.ok(!rows.some((r) => r.sku === 'WP-2290'), 'the water pump has not been received');
  });

  it('searches by name, SKU and brand', async () => {
    assert.equal((await listPrices({ q: 'brake' })).length, 1);
    assert.equal((await listPrices({ q: 'SA-3307' })).length, 1);
    assert.equal((await listPrices({ q: 'nothing-matches' })).length, 0);
  });
});

describe('setting a final price', () => {
  it('records who set it, and against which cost', async () => {
    const detail = await setFinalPrice(po.shock.partId, { finalPrice: '430.00' }, base.sellerId);

    assert.equal(detail.finalPrice, '430.00');
    assert.equal(detail.status, 'overridden', 'it differs from the suggestion');

    const manual = detail.history.find((h) => h.source === 'manual')!;
    assert.equal(manual.changedBy, 'Ama Mensah');
    assert.equal(manual.landedCost, '291.40', 'the cost it was set against is what makes review derivable');
  });

  it('shows where the cost came from', async () => {
    const detail = await getPrice(po.shock.partId);

    assert.equal(detail.costBasis!.reference, 'PO-2026-0031');
    assert.equal(detail.costBasis!.unitCostUsd, '23.5000');
    assert.equal(detail.costBasis!.fxRate, '12.400000');
    assert.equal(detail.landedCost, '291.40', '23.50 x 12.40');
  });

  it('flips to needs review when the part is next bought at a different cost', async () => {
    // A second order for the same part, at a weaker cedi.
    const { purchaseOrders, purchaseOrderLines } = await import('../src/db/schema/index.js');
    const [second] = await db
      .insert(purchaseOrders)
      .values({
        reference: 'PO-2026-0040',
        supplierId: po.supplierId,
        status: 'sent',
        orderDate: '2026-09-20',
        fxRate: '13.100000',
      })
      .returning();
    const [line] = await db
      .insert(purchaseOrderLines)
      .values({
        purchaseOrderId: second!.id,
        partId: po.shock.partId,
        quantityOrdered: '10',
        unitCostUsd: '23.5000',
      })
      .returning();

    const result = await receiveStock(
      second!.id,
      { lines: [{ lineId: line!.id, quantityReceived: 10 }] },
      base.sellerId,
    );

    // 23.50 x 13.10 = 307.85, against the 291.40 the price was set at.
    assert.equal(result.received[0]!.landedCost, '307.85');
    assert.equal(result.received[0]!.finalPrice, '430.00', 'the override survives');
    assert.equal(result.received[0]!.needsReview, true);

    const rows = await listPrices({ status: 'needs_review' });
    assert.deepEqual(
      rows.map((r) => r.sku),
      ['SA-3307'],
    );
  });

  it('clears the flag once someone confirms a price against the new cost', async () => {
    await setFinalPrice(po.shock.partId, { finalPrice: '474.00' }, base.sellerId);

    const detail = await getPrice(po.shock.partId);
    assert.notEqual(detail.status, 'needs_review', 'it has now been looked at');
    assert.equal((await listPrices({ status: 'needs_review' })).length, 0);
  });

  it('refuses a part that has no price yet', async () => {
    await assert.rejects(
      () => setFinalPrice(po.waterPump.partId, { finalPrice: '100.00' }, base.sellerId),
      /no price yet/,
    );
  });
});

describe('the shop margin', () => {
  it('changes what is suggested next, without repricing what is already saved', async () => {
    const before = await getPrice(po.brakePad.partId);

    await updateSettings({ defaultMarginPct: '40' });

    const after = await getPrice(po.brakePad.partId);
    assert.equal(after.finalPrice, before.finalPrice, 'saved prices are decisions, not derivations');

    await updateSettings({ defaultMarginPct: '35' });
  });
});

describe('over HTTP', () => {
  const auth = () => ({ Authorization: `Bearer ${purchasingToken}` });

  it('lists and filters', async () => {
    const all = await request(server).get('/api/backoffice/prices').set(auth());
    assert.equal(all.status, 200);
    assert.ok(all.body.length >= 2);

    const filtered = await request(server)
      .get('/api/backoffice/prices?status=overridden')
      .set(auth());
    assert.equal(filtered.status, 200);
  });

  it('sets a price', async () => {
    const res = await request(server)
      .patch(`/api/backoffice/prices/${po.brakePad.partId}`)
      .set(auth())
      .send({ finalPrice: '240.00' });

    assert.equal(res.status, 200);
    assert.equal(res.body.finalPrice, '240.00');
    assert.equal(res.body.status, 'overridden');
  });

  it('rejects a price that is not an amount', async () => {
    const res = await request(server)
      .patch(`/api/backoffice/prices/${po.brakePad.partId}`)
      .set(auth())
      .send({ finalPrice: '240.0000' });

    assert.equal(res.status, 400);
  });

  it('keeps Sales out', async () => {
    const sales = tokenFor(base, 'sales');
    const res = await request(server)
      .get('/api/backoffice/prices')
      .set('Authorization', `Bearer ${sales}`);

    assert.equal(res.status, 403, 'cost and suggested price are not for the till');
  });
});
