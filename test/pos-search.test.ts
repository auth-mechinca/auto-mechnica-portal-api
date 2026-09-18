import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { shopFixture } from './helpers/fixtures.js';
import { tokenFor } from './helpers/auth.js';
import { createApp } from '../src/app.js';
import { signToken } from '../src/lib/token.js';
import type { Db } from '../src/db/client.js';
import { parts } from '../src/db/schema/index.js';
import { searchParts } from '../src/modules/pos/service.js';

let db: Db;
let close: () => Promise<void>;
let server: Server;
let shop: Awaited<ReturnType<typeof shopFixture>>;
let salesToken: string;

before(async () => {
  ({ db, close } = await createTestDb());
  shop = await shopFixture(db);
  server = createApp().listen(0);
  salesToken = signToken({ sub: shop.sellerId, email: 'sales@test', role: 'sales' });

  await db
    .update(parts)
    .set({ fitment: ['2014-2019 Toyota Corolla 1.8L'] })
    .where(eq(parts.id, shop.brakePad.id));
});

after(async () => {
  server.close();
  await close();
});

describe('part search', () => {
  it('finds a part by name', async () => {
    const results = await searchParts({ q: 'brake' });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.sku, 'BP-2042');
  });

  it('finds a part by SKU and by vehicle fitment', async () => {
    assert.equal((await searchParts({ q: 'BP-2042' }))[0]!.sku, 'BP-2042');
    assert.equal((await searchParts({ q: 'corolla' }))[0]!.sku, 'BP-2042');
  });

  it('returns the sell price and stock, and nothing about cost', async () => {
    const [result] = await searchParts({ q: 'brake' });

    assert.equal(result!.sellPrice, '199.00');
    assert.equal(Number(result!.inStock), 64);

    // The RBAC promise of Section 6.3, enforced by the query rather than the UI:
    // there is no cost in the payload at all for a Sales session to leak.
    const keys = Object.keys(result!);
    for (const forbidden of ['landedCost', 'landed_cost', 'suggestedPrice', 'suggested_price']) {
      assert.ok(!keys.includes(forbidden), `search must not return ${forbidden}`);
    }
  });

  it('reports an unpriced part rather than hiding it', async () => {
    const [result] = await searchParts({ q: 'Unpriced' });
    assert.equal(result!.sellPrice, null, 'the counter should see it exists but cannot be sold');
  });

  it('treats a wildcard as literal text, not as a pattern', async () => {
    assert.deepEqual(await searchParts({ q: '%' }), []);
  });
});

describe('POS over HTTP', () => {
  const auth = () => ({ Authorization: `Bearer ${salesToken}` });

  it('requires a search term', async () => {
    const res = await request(server).get('/api/pos/parts').set(auth());
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('searches', async () => {
    const res = await request(server).get('/api/pos/parts?q=air').set(auth());
    assert.equal(res.status, 200);
    assert.equal(res.body[0].sku, 'AF-0455');
  });

  it('records a sale and returns the receipt as 201', async () => {
    const res = await request(server)
      .post('/api/pos/sales')
      .set(auth())
      .send({
        customerId: null,
        lines: [{ partId: shop.airFilter.id, quantity: 2 }],
        payment: { method: 'cash', cashTendered: '100.00' },
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.total, '67.00');
    assert.equal(res.body.soldBy.fullName, 'Ama Mensah');
  });

  it('reads the receipt back', async () => {
    const sale = await request(server)
      .post('/api/pos/sales')
      .set(auth())
      .send({
        customerId: shop.customerId,
        lines: [{ partId: shop.airFilter.id, quantity: 1 }],
        payment: { method: 'cash' },
      });

    const res = await request(server).get(`/api/pos/sales/${sale.body.id}`).set(auth());
    assert.equal(res.status, 200);
    assert.equal(res.body.reference, sale.body.reference);
    assert.equal(res.body.customer.name, 'Adom Motors Ltd');
  });

  it('rejects a malformed sale id at the edge', async () => {
    const res = await request(server).get('/api/pos/sales/not-a-uuid').set(auth());
    assert.equal(res.status, 400);
  });

  it('404s an unknown sale', async () => {
    const res = await request(server)
      .get('/api/pos/sales/99999999-9999-4999-8999-999999999999')
      .set(auth());
    assert.equal(res.status, 404);
  });

  it('refuses an accountant at the till', async () => {
    const accountant = tokenFor(shop, 'accountant');
    const res = await request(server)
      .get('/api/pos/parts?q=brake')
      .set('Authorization', `Bearer ${accountant}`);
    assert.equal(res.status, 403);
  });
});
