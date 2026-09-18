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
import { ROLES } from '../src/lib/token.js';
import { locations } from '../src/db/schema/index.js';

/** Shop-wide settings, in their own module at /api/settings.
 *
 *  This used to hang off the backoffice router, which gave it that router's
 *  gate — purchasing or admin. The margin here prices the whole catalogue, so
 *  that was a hole, and closing it is the reason this module exists. */

let db: Db;
let close: () => Promise<void>;
let server: Server;
let base: Awaited<ReturnType<typeof baseFixture>>;

before(async () => {
  ({ db, close } = await createTestDb());
  base = await baseFixture(db);
  server = createApp().listen(0);
});

after(async () => {
  server.close();
  await close();
});

const as = (role: (typeof ROLES)[number]) => ({
  Authorization: `Bearer ${signToken({ sub: base.sellerId, email: `${role}@demo`, role })}`,
});

describe('reading settings', () => {
  it('returns what the screen draws', async () => {
    const res = await request(server).get('/api/settings').set(as('admin'));

    assert.equal(res.status, 200);
    assert.equal(res.body.defaultMarginPct, '35');
    assert.equal(res.body.sellingCurrency, 'GHS');
    assert.equal(res.body.location.id, base.locationId);
    assert.equal(res.body.location.name, 'Main Shop');
  });

  it('names the location rather than leaving the UI to hardcode it', async () => {
    await db.update(locations).set({ name: 'Kaneshie Branch' });
    const res = await request(server).get('/api/settings').set(as('admin'));

    assert.equal(res.body.location.name, 'Kaneshie Branch');
    await db.update(locations).set({ name: 'Main Shop' });
  });
});

describe('changing the margin', () => {
  it('saves it and reads it back', async () => {
    const res = await request(server)
      .patch('/api/settings')
      .set(as('admin'))
      .send({ defaultMarginPct: '40' });

    assert.equal(res.status, 200);
    assert.equal(res.body.defaultMarginPct, '40');

    const read = await request(server).get('/api/settings').set(as('admin'));
    assert.equal(read.body.defaultMarginPct, '40', 'the change survives the request');
  });

  it('refuses 100% or more', async () => {
    const res = await request(server)
      .patch('/api/settings')
      .set(as('admin'))
      .send({ defaultMarginPct: '100' });

    assert.equal(res.status, 400, 'a margin is a share of the price; 100% has no price');
  });

  it('refuses anything that is not an amount', async () => {
    const res = await request(server)
      .patch('/api/settings')
      .set(as('admin'))
      .send({ defaultMarginPct: '35.555' });

    assert.equal(res.status, 400);
  });

  it('ignores a read-only field rather than pretending to set it', async () => {
    const res = await request(server)
      .patch('/api/settings')
      .set(as('admin'))
      .send({ defaultMarginPct: '38', sellingCurrency: 'USD' });

    assert.equal(res.status, 200);
    assert.equal(res.body.sellingCurrency, 'GHS', 'the shop still sells in Cedis');
  });
});

describe('who may reach it', () => {
  for (const role of ['sales', 'purchasing', 'accountant'] as const) {
    it(`keeps ${role} out`, async () => {
      const read = await request(server).get('/api/settings').set(as(role));
      const write = await request(server)
        .patch('/api/settings')
        .set(as(role))
        .send({ defaultMarginPct: '5' });

      assert.equal(read.status, 403);
      assert.equal(write.status, 403, 'this is the gate the backoffice router did not apply');
    });
  }

  it('is gone from the backoffice router', async () => {
    const res = await request(server).get('/api/backoffice/settings').set(as('purchasing'));

    assert.equal(res.status, 404, 'left as an alias it would reopen the hole');
  });
});
