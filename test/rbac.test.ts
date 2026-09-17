import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { signToken, type Role } from '../src/lib/token.js';

/** Section 2 of the demo scope promises that a restricted role is stopped by the
 *  API, not by a hidden nav item. These tests are that promise, asserted. */

const ID = '11111111-1111-4111-8111-111111111111';
const token = (role: Role) => signToken({ sub: ID, email: `${role}@demo`, role });

let server: Server;
before(() => {
  server = createApp().listen(0);
});
after(() => {
  server.close();
});

/** Every mounted module router, and who the scope document says may reach it. */
const MODULES = [
  { path: '/api/pos/anything', allowed: ['sales', 'admin'] },
  { path: '/api/ims/anything', allowed: ['purchasing', 'admin'] },
  { path: '/api/financial/anything', allowed: ['accountant', 'admin'] },
  { path: '/api/backoffice/anything', allowed: ['purchasing', 'admin'] },
] as const;

const ALL_ROLES: Role[] = ['sales', 'purchasing', 'accountant', 'admin'];

describe('RBAC', () => {
  it('serves health without a token', async () => {
    const res = await request(server).get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  for (const { path, allowed } of MODULES) {
    it(`rejects an anonymous request to ${path}`, async () => {
      const res = await request(server).get(path);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHENTICATED');
    });

    for (const role of ALL_ROLES) {
      const permitted = (allowed as readonly string[]).includes(role);

      it(`${permitted ? 'admits' : 'refuses'} ${role} at ${path}`, async () => {
        const res = await request(server).get(path).set('Authorization', `Bearer ${token(role)}`);

        if (permitted) {
          // Past the role gate. No handler is mounted yet, so 404 is the pass
          // condition — what matters is that it is not 403.
          assert.equal(res.status, 404, `${role} should pass the role gate at ${path}`);
        } else {
          assert.equal(res.status, 403, `${role} must not reach ${path}`);
          assert.equal(res.body.error.code, 'FORBIDDEN');
        }
      });
    }
  }

  it('refuses a token signed with the wrong secret', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEiLCJlbWFpbCI6ImFAYiIsInJvbGUiOiJhZG1pbiJ9.not-a-real-signature';
    const res = await request(server).get('/api/backoffice/x').set('Authorization', `Bearer ${forged}`);
    assert.equal(res.status, 401);
  });

  it('refuses a token carrying a role that does not exist', async () => {
    // Signed correctly, but claims a role outside the enum — must not be trusted.
    const jwt = (await import('jsonwebtoken')).default;
    const bogus = jwt.sign({ sub: ID, email: 'x@y', role: 'superuser' }, process.env.JWT_SECRET!);
    const res = await request(server).get('/api/backoffice/x').set('Authorization', `Bearer ${bogus}`);
    assert.equal(res.status, 401);
  });

  it('ignores a role passed in the request body', async () => {
    const res = await request(server)
      .post('/api/backoffice/suppliers')
      .set('Authorization', `Bearer ${token('sales')}`)
      .send({ role: 'admin' });
    assert.equal(res.status, 403);
  });
});
