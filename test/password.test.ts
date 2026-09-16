import './helpers/env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BCRYPT_COST, hashPassword, verifyPassword } from '../src/lib/password.js';

const timeOf = async (fn: () => Promise<unknown>): Promise<number> => {
  const started = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

describe('password verification', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('demo1234');
    assert.equal(await verifyPassword('demo1234', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
  });

  it('rejects when there is no stored hash', async () => {
    assert.equal(await verifyPassword('demo1234', undefined), false);
  });

  it('produces hashes at the configured cost', async () => {
    const hash = await hashPassword('demo1234');
    assert.equal(hash.length, 60, 'a bcrypt hash is 60 characters');
    // $<algorithm>$<cost>$<salt+digest>
    const [, algorithm, cost] = hash.split('$');
    assert.ok(['2a', '2b', '2y'].includes(algorithm!), `unexpected algorithm ${algorithm}`);
    assert.equal(Number(cost), BCRYPT_COST);
  });

  it('spends the same work on an unknown account as on a wrong password', async () => {
    // The account-enumeration defence. An earlier version compared against a
    // hand-written placeholder that was not a valid bcrypt hash; bcrypt rejected
    // it in microseconds, so "no such user" answered ~600x faster than a real
    // user and the timing gave the answer away. The ratio bound is deliberately
    // loose — the failure this guards against is orders of magnitude, not noise.
    const hash = await hashPassword('demo1234');

    const known = await timeOf(() => verifyPassword('wrong', hash));
    const unknown = await timeOf(() => verifyPassword('wrong', undefined));

    assert.ok(
      unknown > known / 4,
      `unknown-account path took ${unknown.toFixed(1)}ms vs ${known.toFixed(1)}ms for a real compare — it is short-circuiting`,
    );
  });
});
