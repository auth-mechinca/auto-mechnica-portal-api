import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { createTestDb } from './helpers/db.js';
import { baseFixture } from './helpers/fixtures.js';
import { tokenFor } from './helpers/auth.js';
import { createApp } from '../src/app.js';
import { signToken } from '../src/lib/token.js';
import type { Db } from '../src/db/client.js';
import { salesInvoices } from '../src/db/schema/index.js';

let db: Db;
let close: () => Promise<void>;
let server: Server;
let base: Awaited<ReturnType<typeof baseFixture>>;
let token: string;
let invoiceId: string;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  server = createApp().listen(0);
  token = tokenFor(base, 'accountant');

  const [invoice] = await db
    .insert(salesInvoices)
    .values({
      reference: 'INV-2026-0427',
      customerId: base.customerId,
      invoiceDate: '2026-08-21',
      dueDate: '2026-09-20',
      totalAmount: '6120.00',
      soldBy: base.sellerId,
    })
    .returning();
  invoiceId = invoice!.id;
});

after(async () => {
  server.close();
  await close();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('financial core over HTTP', () => {
  it('lists customer accounts with ageing and the summary tiles', async () => {
    const res = await request(server).get('/api/financial/customers').set(auth());

    assert.equal(res.status, 200);
    assert.equal(res.body.customers[0].name, 'Adom Motors Ltd');
    assert.equal(res.body.totals.balanceDue, '6120.00');
    assert.ok(res.body.ageing);
    assert.equal(res.body.summary.chequesPendingCount, 0);
  });

  it('opens one account', async () => {
    const res = await request(server)
      .get(`/api/financial/customers/${base.customerId}`)
      .set(auth());

    assert.equal(res.status, 200);
    assert.equal(res.body.invoices.length, 1);
    assert.equal(res.body.invoices[0].reference, 'INV-2026-0427');
  });

  it('records a cheque and puts it in the queue', async () => {
    const res = await request(server)
      .post('/api/financial/payments')
      .set(auth())
      .send({
        customerId: base.customerId,
        amount: '2000.00',
        paymentDate: '2026-09-03',
        payment: { method: 'cheque', chequeNumber: '004821', bankName: 'GCB Bank' },
        allocations: [{ invoiceId, amount: '2000.00' }],
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.balanceDue, '6120.00', 'a pending cheque moves nothing');

    const queue = await request(server).get('/api/financial/cheques?status=pending').set(auth());
    assert.equal(queue.body.cheques.length, 1);
    assert.equal(queue.body.pendingValue, '2000.00');
  });

  it('clears it, and the balance drops', async () => {
    const queue = await request(server).get('/api/financial/cheques?status=pending').set(auth());
    const paymentId = queue.body.cheques[0].paymentId;

    const res = await request(server)
      .post(`/api/financial/cheques/${paymentId}/clear`)
      .set(auth());
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'cleared');

    const account = await request(server)
      .get(`/api/financial/customers/${base.customerId}`)
      .set(auth());
    assert.equal(account.body.balanceDue, '4120.00');
    assert.equal(account.body.invoices[0].status, 'part_paid');
  });

  it('404s an unknown customer and 400s a malformed id', async () => {
    const missing = await request(server)
      .get('/api/financial/customers/99999999-9999-4999-8999-999999999999')
      .set(auth());
    assert.equal(missing.status, 404);

    const malformed = await request(server).get('/api/financial/customers/nope').set(auth());
    assert.equal(malformed.status, 400);
  });

  it('rejects an allocation to another customer’s invoice', async () => {
    const { customers } = await import('../src/db/schema/index.js');
    const [other] = await db.insert(customers).values({ name: 'Osu Garage Ltd' }).returning();

    const res = await request(server)
      .post('/api/financial/payments')
      .set(auth())
      .send({
        customerId: other!.id,
        amount: '100.00',
        paymentDate: '2026-09-15',
        payment: { method: 'cash' },
        allocations: [{ invoiceId, amount: '100.00' }],
      });

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /different customer/);
  });

  it('keeps Sales and Purchasing out', async () => {
    for (const role of ['sales', 'purchasing'] as const) {
      const other = tokenFor(base, role);
      const res = await request(server)
        .get('/api/financial/customers')
        .set('Authorization', `Bearer ${other}`);
      assert.equal(res.status, 403, `${role} must not see receivables`);
    }
  });

  it('lets an admin in', async () => {
    const admin = tokenFor(base, 'admin');
    const res = await request(server)
      .get('/api/financial/customers')
      .set('Authorization', `Bearer ${admin}`);
    assert.equal(res.status, 200);
  });
});
