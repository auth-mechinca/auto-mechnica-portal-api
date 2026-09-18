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
  createPurchaseOrder,
  createSupplier,
  getSupplier,
  listSuppliers,
  receiveStock,
  sendPurchaseOrder,
  updatePurchaseOrder,
  updateSupplier,
} from '../src/modules/backoffice/service.js';

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
    .values({ sku: 'BP-2042', name: 'Brake pad set, front', brand: 'Bosch' })
    .returning();
  brakePadId = part!.id;

  const supplier = await createSupplier({
    name: 'Guangzhou Hongfa Auto Parts Co.',
    contactPerson: 'Li Wei',
    phone: '+86 20 8138 4477',
    email: 'sales@hongfa-parts.cn',
    currency: 'USD',
    paymentTerms: 'Net 30',
    isActive: true,
  });
  supplierId = supplier.id;
});

after(async () => {
  server.close();
  await close();
});

describe('suppliers', () => {
  it('defaults to invoicing in USD', async () => {
    const supplier = await getSupplier(supplierId);
    assert.equal(supplier.currency, 'USD');
    assert.equal(supplier.paymentTerms, 'Net 30');
  });

  it('is deactivated rather than deleted, keeping its history', async () => {
    const retired = await createSupplier({
      name: 'Lagos Auto Imports Ltd',
      currency: 'USD',
      isActive: true,
    });

    await createPurchaseOrder({
      supplierId: retired.id,
      orderDate: '2026-05-09',
      fxRate: '11.400000',
      lines: [{ partId: brakePadId, quantityOrdered: 10, unitCostUsd: '11.8000' }],
      status: 'draft',
    });

    await updateSupplier(retired.id, { isActive: false });

    const after = await getSupplier(retired.id);
    assert.equal(after.isActive, false);
    assert.equal(after.purchaseOrders.length, 1, 'the history survives');

    assert.ok(!(await listSuppliers({ status: 'active' })).some((s) => s.id === retired.id));
    assert.ok((await listSuppliers({ status: 'all' })).some((s) => s.id === retired.id));
  });

  it('will not take a new order for an inactive supplier', async () => {
    const [inactive] = (await listSuppliers({ status: 'inactive' }));
    await assert.rejects(
      () =>
        createPurchaseOrder({
          supplierId: inactive!.id,
          orderDate: '2026-09-02',
          fxRate: '12.400000',
          lines: [{ partId: brakePadId, quantityOrdered: 5, unitCostUsd: '11.8000' }],
          status: 'draft',
        }),
      /inactive and cannot take a new order/,
    );
  });

  it('reports what has been bought from them in the currency they invoice in', async () => {
    const supplier = await createSupplier({ name: 'Korea Parts Trading Ltd', currency: 'USD', isActive: true });

    await createPurchaseOrder({
      supplierId: supplier.id,
      orderDate: '2026-09-09',
      fxRate: '12.350000',
      lines: [{ partId: brakePadId, quantityOrdered: 40, unitCostUsd: '11.8000' }],
      status: 'sent',
    });

    const detail = await getSupplier(supplier.id);
    assert.equal(detail.purchasedToDateUsd, '472.00', '40 x 11.80');
    assert.equal(detail.openPurchaseOrders, 1);
  });
});

describe('drafting a purchase order', () => {
  it('can be saved with no FX rate and no Cedi value', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-14',
      lines: [{ partId: brakePadId, quantityOrdered: 40, unitCostUsd: '11.8000' }],
      status: 'draft',
    });

    assert.equal(draft.status, 'draft');
    assert.equal(draft.fxRate, null, 'nothing has been agreed yet');
    assert.equal(draft.totalGhs, null, 'so there is no Cedi total');
    assert.equal(draft.totalUsd, '472.00', 'the dollar cost is known either way');
  });

  it('generates its own reference', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-14',
      lines: [],
      status: 'draft',
    });
    assert.match(draft.reference, /^PO-2026-\d{4,}$/);
  });

  it('will not go out without a rate', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-14',
      lines: [{ partId: brakePadId, quantityOrdered: 5, unitCostUsd: '11.8000' }],
      status: 'draft',
    });

    await assert.rejects(() => sendPurchaseOrder(draft.id), /needs an FX rate/);
  });

  it('will not go out with no lines', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-14',
      fxRate: '12.400000',
      lines: [],
      status: 'draft',
    });

    await assert.rejects(() => sendPurchaseOrder(draft.id), /at least one line/);
  });

  it('gains a Cedi value the moment the rate is set', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-02',
      lines: [
        { partId: brakePadId, quantityOrdered: 40, unitCostUsd: '11.8000' },
      ],
      status: 'draft',
    });

    const rated = await updatePurchaseOrder(draft.id, { fxRate: '12.400000' });
    assert.equal(rated.totalUsd, '472.00');
    assert.equal(rated.totalGhs, '5852.80', '472.00 x 12.40');
    assert.equal(rated.lines[0]!.landedCost, '146.32', '11.80 x 12.40');

    const sent = await sendPurchaseOrder(rated.id);
    assert.equal(sent.status, 'sent');
  });

  it('is frozen once sent', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-02',
      fxRate: '12.400000',
      lines: [{ partId: brakePadId, quantityOrdered: 4, unitCostUsd: '11.8000' }],
      status: 'sent',
    });

    await assert.rejects(
      () => updatePurchaseOrder(draft.id, { fxRate: '13.000000' }),
      /cannot be edited/,
      'changing the rate would rewrite the cost basis of stock received against it',
    );
    await assert.rejects(() => sendPurchaseOrder(draft.id), /already sent/);
  });
});

describe('cancelling', () => {
  it('cancels a draft', async () => {
    const draft = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-08-04',
      lines: [],
      status: 'draft',
    });

    const cancelled = await cancelPurchaseOrder(draft.id, { reason: 'Ordered by mistake' }, base.sellerId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.resolution!.reason, 'Ordered by mistake');
    await assert.rejects(() => cancelPurchaseOrder(draft.id, { reason: 'Ordered by mistake' }, base.sellerId), /already cancelled/);
  });

  it('refuses once stock has arrived', async () => {
    const order = await createPurchaseOrder({
      supplierId,
      orderDate: '2026-09-02',
      fxRate: '12.400000',
      lines: [{ partId: brakePadId, quantityOrdered: 10, unitCostUsd: '11.8000' }],
      status: 'sent',
    });

    await receiveStock(
      order.id,
      { lines: [{ lineId: order.lines[0]!.id, quantityReceived: 5 }] },
      base.sellerId,
    );

    await assert.rejects(() => cancelPurchaseOrder(order.id, {}, base.sellerId), /already been received/);
  });
});

describe('over HTTP', () => {
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('creates a supplier', async () => {
    const res = await request(server)
      .post('/api/backoffice/suppliers')
      .set(auth())
      .send({ name: 'Dubai Motor Spares FZE', paymentTerms: '50% deposit' });

    assert.equal(res.status, 201);
    assert.equal(res.body.currency, 'USD', 'the default');
  });

  it('drafts then sends an order', async () => {
    const suppliers = await request(server).get('/api/backoffice/suppliers').set(auth());
    const id = suppliers.body[0].id;

    const draft = await request(server)
      .post('/api/backoffice/purchase-orders')
      .set(auth())
      .send({
        supplierId: id,
        orderDate: '2026-09-02',
        lines: [{ partId: brakePadId, quantityOrdered: 24, unitCostUsd: '23.5000' }],
      });

    assert.equal(draft.status, 201);
    assert.equal(draft.body.fxRate, null);

    const blocked = await request(server)
      .post(`/api/backoffice/purchase-orders/${draft.body.id}/send`)
      .set(auth());
    assert.equal(blocked.status, 400);

    await request(server)
      .patch(`/api/backoffice/purchase-orders/${draft.body.id}`)
      .set(auth())
      .send({ fxRate: '12.400000' });

    const sent = await request(server)
      .post(`/api/backoffice/purchase-orders/${draft.body.id}/send`)
      .set(auth());
    assert.equal(sent.status, 200);
    assert.equal(sent.body.status, 'sent');
    assert.equal(sent.body.totalGhs, '6993.60', '564.00 x 12.40');
  });

  it('keeps the accountant out of purchasing', async () => {
    const accountant = signToken({ sub: base.sellerId, email: 'efua@demo', role: 'accountant' });
    const res = await request(server)
      .get('/api/backoffice/suppliers')
      .set('Authorization', `Bearer ${accountant}`);
    assert.equal(res.status, 403);
  });
});
