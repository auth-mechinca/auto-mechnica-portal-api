import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { hashPassword } from '../src/lib/password.js';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { createTestDb } from './helpers/db.js';
import type { Db } from '../src/db/client.js';
import { users } from '../src/db/schema/index.js';

let db: Db;
let close: () => Promise<void>;
let server: Server;

before(async () => {
  ({ db, close } = await createTestDb());
  server = createApp().listen(0);

  // The four demo logins from Section 2.
  const passwordHash = await hashPassword('demo1234');
  await db.insert(users).values([
    { email: 'sales@demo', fullName: 'Ama Sales', role: 'sales', passwordHash },
    { email: 'purchasing@demo', fullName: 'Kofi Purchasing', role: 'purchasing', passwordHash },
    { email: 'accounts@demo', fullName: 'Adjoa Accounts', role: 'accountant', passwordHash },
    { email: 'admin@demo', fullName: 'The Owner', role: 'admin', passwordHash },
    { email: 'former@demo', fullName: 'Left The Company', role: 'sales', passwordHash, isActive: false },
  ]);
});

after(async () => {
  server.close();
  await close();
});

describe('login', () => {
  it('issues a token carrying the account role', async () => {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: 'purchasing@demo', password: 'demo1234' });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'purchasing');
    assert.ok(res.body.token);
    assert.equal(res.body.user.passwordHash, undefined, 'must never return the hash');
  });

  it('accepts the email case-insensitively', async () => {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: 'ADMIN@DEMO', password: 'demo1234' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'admin');
  });

  it('rejects a wrong password', async () => {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: 'sales@demo', password: 'wrong' });
    assert.equal(res.status, 401);
  });

  it('gives an unknown email the same answer as a wrong password', async () => {
    // Otherwise the response tells an attacker which accounts exist.
    const unknown = await request(server)
      .post('/api/auth/login')
      .send({ email: 'nobody@demo', password: 'demo1234' });
    const wrong = await request(server)
      .post('/api/auth/login')
      .send({ email: 'sales@demo', password: 'wrong' });

    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.body, wrong.body);
  });

  it('refuses a deactivated account holding valid credentials', async () => {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: 'former@demo', password: 'demo1234' });
    assert.equal(res.status, 401);
  });

  it('rejects a malformed body without reaching the database', async () => {
    const res = await request(server).post('/api/auth/login').send({ email: 'sales@demo' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});

describe('token to access, end to end', () => {
  const login = async (email: string) =>
    (await request(server).post('/api/auth/login').send({ email, password: 'demo1234' })).body.token;

  it('lets a real sales login into POS but not the backoffice', async () => {
    const token = await login('sales@demo');

    const backoffice = await request(server)
      .get('/api/backoffice/suppliers')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(backoffice.status, 403);

    const pos = await request(server).get('/api/pos/parts').set('Authorization', `Bearer ${token}`);
    assert.notEqual(pos.status, 403);
  });

  it('lets the admin login reach every module', async () => {
    const token = await login('admin@demo');
    for (const path of ['/api/pos/x', '/api/ims/x', '/api/financial/x', '/api/backoffice/x']) {
      const res = await request(server).get(path).set('Authorization', `Bearer ${token}`);
      assert.notEqual(res.status, 403, `admin blocked at ${path}`);
    }
  });

  it('returns the current user from /me', async () => {
    const token = await login('accounts@demo');
    const res = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'accounts@demo');
    assert.equal(res.body.role, 'accountant');
  });
});
