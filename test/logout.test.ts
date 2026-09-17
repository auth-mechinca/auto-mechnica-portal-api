import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { signToken } from '../src/lib/token.js';
import { purgeExpiredRevocations } from '../src/db/revocations.js';
import type { Db } from '../src/db/client.js';
import { revokedTokens, users } from '../src/db/schema/index.js';

/** A JWT is valid until it expires and presenting one asks this server nothing,
 *  so "logout" is only real if the server keeps a record. These tests are what
 *  makes that claim checkable. */

let db: Db;
let close: () => Promise<void>;
let server: Server;
let userId: string;

const login = async () =>
  (
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'sales@demo', password: 'demo1234' })
  ).body.token as string;

before(async () => {
  ({ db, close } = await createTestDb());
  server = createApp().listen(0);

  const [user] = await db
    .insert(users)
    .values({
      email: 'sales@demo',
      fullName: 'Ama Mensah',
      role: 'sales',
      passwordHash: await hashPassword('demo1234'),
    })
    .returning();
  userId = user!.id;
});

after(async () => {
  server.close();
  await close();
});

describe('signing out', () => {
  it('stops the token it was called with', async () => {
    const token = await login();

    const before = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(before.status, 200);

    const out = await request(server)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(out.status, 200);

    const after = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(after.status, 401, 'the signature is still good — the session is not');
    assert.match(after.body.error.message, /signed out/);
  });

  it('stops it everywhere, not just on the route that revoked it', async () => {
    const token = await login();
    await request(server).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    const pos = await request(server)
      .get('/api/pos/parts?q=brake')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(pos.status, 401, 'revocation is checked in requireAuth, so it covers every route');
  });

  it('leaves the same user other sessions alone', async () => {
    // Signing out of the till must not sign the same person out on their phone.
    const till = await login();
    const phone = await login();

    await request(server).post('/api/auth/logout').set('Authorization', `Bearer ${till}`);

    const stillIn = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${phone}`);
    assert.equal(stillIn.status, 200);
  });

  it('is idempotent', async () => {
    const token = await login();
    const first = await request(server).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    const second = await request(server).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    assert.equal(first.status, 200);
    // The second is refused because the token is already revoked — not because
    // signing out twice is an error.
    assert.equal(second.status, 401);
  });

  it('requires a token of its own', async () => {
    const res = await request(server).post('/api/auth/logout');
    assert.equal(res.status, 401);
  });

  it('gives every token a distinct id, so revoking one cannot revoke another', async () => {
    const a = signToken({ sub: userId, email: 'sales@demo', role: 'sales' });
    const b = signToken({ sub: userId, email: 'sales@demo', role: 'sales' });
    assert.notEqual(a, b);
  });

  it('keeps a revocation only until the token would have expired anyway', async () => {
    await db.insert(revokedTokens).values({
      jti: '11111111-1111-4111-8111-111111111111',
      userId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await db.insert(revokedTokens).values({
      jti: '22222222-2222-4222-8222-222222222222',
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const purged = await purgeExpiredRevocations();
    assert.ok(purged >= 1, 'the expired row should be swept');

    const remaining = await db
      .select({ jti: revokedTokens.jti })
      .from(revokedTokens)
      .where(eq(revokedTokens.jti, '22222222-2222-4222-8222-222222222222'));
    assert.equal(remaining.length, 1, 'the live one must survive');

    const gone = await db
      .select({ jti: revokedTokens.jti })
      .from(revokedTokens)
      .where(eq(revokedTokens.jti, '11111111-1111-4111-8111-111111111111'));
    assert.equal(gone.length, 0);
  });
});
