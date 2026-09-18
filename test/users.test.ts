import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { createTestDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { signToken } from '../src/lib/token.js';
import { hashPassword } from '../src/lib/password.js';
import { users } from '../src/db/schema/index.js';
import type { Db } from '../src/db/client.js';

/** Staff accounts and roles — the Users and Roles screen, admin only. */

let db: Db;
let close: () => Promise<void>;
let server: Server;
let adminId: string;
let adminToken: string;

before(async () => {
  ({ db, close } = await createTestDb());
  const passwordHash = await hashPassword('demo1234');
  const [admin] = await db
    .insert(users)
    .values({ email: 'owner@demo', fullName: 'Nana Owusu', role: 'admin', passwordHash })
    .returning();
  adminId = admin!.id;
  adminToken = signToken({ sub: adminId, email: admin!.email, role: 'admin' });
  server = createApp().listen(0);
});

after(async () => {
  server.close();
  await close();
});

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

describe('adding a user', () => {
  it('creates one and hands back the password exactly once', async () => {
    const res = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Kofi Mensah', email: 'purchasing@demo', role: 'purchasing' });

    assert.equal(res.status, 201);
    assert.equal(res.body.fullName, 'Kofi Mensah');
    assert.equal(res.body.role, 'purchasing');
    assert.equal(res.body.isActive, true);
    assert.equal(res.body.lastSignInAt, null, 'they have never signed in');
    assert.match(res.body.temporaryPassword, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);

    const again = await request(server).get(`/api/users/${res.body.id}`).set(auth());
    assert.equal(again.body.temporaryPassword, undefined, 'never shown a second time');
  });

  it('stores only the hash — the plaintext is not written anywhere', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Efua Sarpong', email: 'accounts@demo', role: 'accountant' });

    const [row] = await db.select().from(users).where(eq(users.id, created.body.id));
    assert.notEqual(row!.passwordHash, created.body.temporaryPassword);
    assert.match(row!.passwordHash, /^\$2[aby]\$/, 'a bcrypt hash');
  });

  it('lets the new account sign in with that password, and stamps the visit', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Ama Darko', email: 'sales@demo', role: 'sales' });

    const login = await request(server)
      .post('/api/auth/login')
      .send({ email: 'sales@demo', password: created.body.temporaryPassword });

    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'sales');

    const after = await request(server).get(`/api/users/${created.body.id}`).set(auth());
    assert.notEqual(after.body.lastSignInAt, null, 'last sign-in is stamped on success');
  });

  it('refuses an email that already has an account, whatever the case', async () => {
    const res = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Someone Else', email: 'PURCHASING@demo', role: 'sales' });

    assert.equal(res.status, 409);
  });

  it('refuses a role that is not one of the four', async () => {
    const res = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Nobody', email: 'nobody@demo', role: 'superuser' });

    assert.equal(res.status, 400);
  });
});

describe('the list', () => {
  it('shows active and inactive together, by name', async () => {
    const res = await request(server).get('/api/users').set(auth());

    assert.equal(res.status, 200);
    const names = res.body.map((u: { fullName: string }) => u.fullName);
    assert.deepEqual(names, [...names].sort(), 'ordered by name');
    assert.ok(names.includes('Nana Owusu'));
  });

  it('never returns a password hash', async () => {
    const res = await request(server).get('/api/users').set(auth());
    for (const user of res.body) {
      assert.equal(user.passwordHash, undefined);
      assert.equal(user.temporaryPassword, undefined);
    }
  });
});

describe('changing a user', () => {
  it('renames and reassigns', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Yaw Asante', email: 'yaw@demo', role: 'sales' });

    const res = await request(server)
      .patch(`/api/users/${created.body.id}`)
      .set(auth())
      .send({ fullName: 'Yaw Asante-Boateng', role: 'accountant' });

    assert.equal(res.status, 200);
    assert.equal(res.body.fullName, 'Yaw Asante-Boateng');
    assert.equal(res.body.role, 'accountant');
  });

  it('deactivates rather than deletes, and sign-in stops', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Gone Away', email: 'gone@demo', role: 'sales' });

    await request(server)
      .patch(`/api/users/${created.body.id}`)
      .set(auth())
      .send({ isActive: false });

    const login = await request(server)
      .post('/api/auth/login')
      .send({ email: 'gone@demo', password: created.body.temporaryPassword });
    assert.equal(login.status, 401, 'deactivating stops sign-in');

    const still = await request(server).get(`/api/users/${created.body.id}`).set(auth());
    assert.equal(still.status, 200, 'the row stays, so their name stays on their sales');
    assert.equal(still.body.isActive, false);
  });

  it('refuses a body that changes nothing', async () => {
    const res = await request(server).patch(`/api/users/${adminId}`).set(auth()).send({});
    assert.equal(res.status, 400);
  });

  it('404s for a user that does not exist', async () => {
    const res = await request(server)
      .patch('/api/users/11111111-1111-4111-8111-111111111111')
      .set(auth())
      .send({ fullName: 'Ghost' });

    assert.equal(res.status, 404);
  });
});

describe('not locking yourself out', () => {
  it('refuses to deactivate your own account', async () => {
    const res = await request(server)
      .patch(`/api/users/${adminId}`)
      .set(auth())
      .send({ isActive: false });

    assert.equal(res.status, 400);
  });

  it('refuses to move yourself off admin', async () => {
    const res = await request(server)
      .patch(`/api/users/${adminId}`)
      .set(auth())
      .send({ role: 'sales' });

    assert.equal(res.status, 400, 'you would lose the screen you are standing on');
  });

  it('lets you rename yourself', async () => {
    const res = await request(server)
      .patch(`/api/users/${adminId}`)
      .set(auth())
      .send({ fullName: 'Nana Owusu Jr' });

    assert.equal(res.status, 200);
  });
});

/** What the UserForm wireframe promises: "Changing someone's role takes effect on
 *  their next request — an open session does not keep the old permissions." */
describe('a change reaches an open session', () => {
  it('takes the new role on the very next request', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Kwame Owusu', email: 'kwame@demo', role: 'sales' });

    // Their token says sales, and it keeps saying sales for the rest of the test.
    const theirToken = signToken({ sub: created.body.id, email: 'kwame@demo', role: 'sales' });
    const theirAuth = { Authorization: `Bearer ${theirToken}` };

    const before = await request(server).get('/api/backoffice/suppliers').set(theirAuth);
    assert.equal(before.status, 403, 'sales cannot reach purchasing');

    await request(server)
      .patch(`/api/users/${created.body.id}`)
      .set(auth())
      .send({ role: 'purchasing' });

    const after = await request(server).get('/api/backoffice/suppliers').set(theirAuth);
    assert.equal(after.status, 200, 'the same token, now carrying the new role from the row');
  });

  it('ends an open session the moment the account is switched off', async () => {
    const created = await request(server)
      .post('/api/users')
      .set(auth())
      .send({ fullName: 'Abena Osei', email: 'abena@demo', role: 'sales' });

    const theirToken = signToken({ sub: created.body.id, email: 'abena@demo', role: 'sales' });
    const theirAuth = { Authorization: `Bearer ${theirToken}` };

    assert.equal((await request(server).get('/api/auth/me').set(theirAuth)).status, 200);

    await request(server)
      .patch(`/api/users/${created.body.id}`)
      .set(auth())
      .send({ isActive: false });

    const after = await request(server).get('/api/auth/me').set(theirAuth);
    assert.equal(after.status, 401, 'a live token is worth nothing once the account is off');
  });
});

describe('who may reach it', () => {
  for (const role of ['sales', 'purchasing', 'accountant'] as const) {
    it(`keeps ${role} out`, async () => {
      const [row] = await db
        .insert(users)
        .values({
          email: `${role}@gate`,
          fullName: `${role} gate`,
          role,
          passwordHash: await hashPassword('demo1234'),
        })
        .returning();
      const theirs = {
        Authorization: `Bearer ${signToken({ sub: row!.id, email: row!.email, role })}`,
      };

      assert.equal((await request(server).get('/api/users').set(theirs)).status, 403);
      assert.equal(
        (await request(server).post('/api/users').set(theirs).send({
          fullName: 'Sneaky',
          email: 'sneaky@demo',
          role: 'admin',
        })).status,
        403,
        'only an admin hands out roles',
      );
    });
  }
});
