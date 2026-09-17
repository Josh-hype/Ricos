/* rememberContact — the address book behind the till's caller ID.
   Run: node --import ./tests/support/register.mjs --test tests/

   Both halves of the feature go through this one function (a website order in
   api/order.js, a phone order typed at the till in api/staff/counter-order.js),
   so what is asserted here is what caller ID can actually find. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberContact, normalisePhoneKey } from '../functions/_lib/customer.js';
import { getConfig } from '../functions/_lib/config.js';

// The fixture config the test loader serves — assert the gate is ON, or every
// "it stored X" test below would pass by storing nothing.
test('the test fixture has pos.customerLookup on (guards every case below)', () => {
  assert.equal(getConfig().pos?.customerLookup, true);
});

function fakeEnv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    CUSTOMERS_KV: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      put: async (k, v) => { store.set(k, v); },
    },
  };
}
const rec = (env, key) => JSON.parse(env.store.get(`customer:${key}`));

test('a website order creates a phone-keyed contact record with the address', async () => {
  const env = fakeEnv();
  const contact = await rememberContact({
    name: 'Josh', phone: '07832884768', source: 'web',
    address: { line1: '3 Lawrence Street', postcode: 'yo10 3bp' },
    at: '2026-09-17T22:00:00.000Z',
  }, env);

  assert.equal(contact, '+447832884768');
  const c = rec(env, '+447832884768');
  assert.equal(c.name, 'Josh');
  assert.equal(c.contactType, 'phone');
  assert.equal(c.source, 'web');
  assert.equal(c.phone, '+447832884768');
  assert.equal(c.lastOrderAt, '2026-09-17T22:00:00.000Z');
  assert.equal(c.addresses[0].line1, '3 Lawrence Street');
  assert.equal(c.addresses[0].postcode, 'YO10 3BP');   // upsertAddress canonicalises
  // A contact record is NOT an account: no credentials, ever.
  for (const f of ['salt', 'hash', 'iterations']) assert.equal(f in c, false);
});

test('the caller-ID lookup key matches what was stored, in every dialled form', async () => {
  // The FRITZ!Box reports 07832884768; the customer may have typed any of these.
  for (const typed of ['07832884768', '+447832884768', '07832 884768', '0044 7832 884768']) {
    const env = fakeEnv();
    await rememberContact({ name: 'A', phone: typed }, env);
    assert.equal(
      env.store.has(`customer:${normalisePhoneKey('07832884768')}`), true,
      `stored under the wrong key for input "${typed}"`,
    );
  }
});

test('a LANDLINE is remembered — normalisePhoneE164UK would have dropped it', async () => {
  // The case that makes this worth testing: caller ID delivers landlines, and
  // the SMS normaliser (mobiles only) returns null for one.
  const env = fakeEnv();
  const contact = await rememberContact({ name: 'Regular', phone: '01904 621622' }, env);
  assert.equal(contact, '+441904621622');
  assert.equal(rec(env, '+441904621622').name, 'Regular');
});

test('an existing name is never overwritten, but a missing one is filled in', async () => {
  const env = fakeEnv({
    'customer:+447700900123': JSON.stringify({
      id: 'x', contact: '+447700900123', name: 'Alexandra Smith', addresses: [],
    }),
  });
  await rememberContact({ name: 'alex', phone: '07700900123' }, env);
  assert.equal(rec(env, '+447700900123').name, 'Alexandra Smith');

  const blank = fakeEnv({
    'customer:+447700900123': JSON.stringify({
      id: 'x', contact: '+447700900123', name: '', addresses: [],
    }),
  });
  await rememberContact({ name: 'Alex', phone: '07700900123' }, blank);
  assert.equal(rec(blank, '+447700900123').name, 'Alex');
});

test('re-ordering to the same place does not duplicate the address', async () => {
  const env = fakeEnv();
  const addr = { line1: '3 Lawrence Street', postcode: 'YO10 3BP' };
  await rememberContact({ name: 'Josh', phone: '07832884768', address: addr }, env);
  await rememberContact({ name: 'Josh', phone: '07832884768', address: { ...addr, postcode: 'yo10  3bp' } }, env);
  assert.equal(rec(env, '+447832884768').addresses.length, 1);
});

test('an account record is enriched, never replaced', async () => {
  // A phone-keyed website account ordering by phone: same record, so the
  // address lands on the account and the credentials survive.
  const env = fakeEnv({
    'customer:+447700900123': JSON.stringify({
      id: 'acct', contact: '+447700900123', contactType: 'phone', name: 'Sam',
      salt: 's', hash: 'h', iterations: 1, promoOrdersUsed: 2, addresses: [],
    }),
  });
  await rememberContact({
    name: 'Sam', phone: '07700900123',
    address: { line1: '1 High Street', postcode: 'YO1 1AA' },
  }, env);
  const c = rec(env, '+447700900123');
  assert.equal(c.id, 'acct');
  assert.equal(c.hash, 'h');            // untouched
  assert.equal(c.promoOrdersUsed, 2);   // untouched
  assert.equal(c.addresses.length, 1);
});

test('skipContact stops the double write that would undo a promo increment', async () => {
  // api/order.js already wrote this record for a signed-in, phone-keyed
  // customer. A second read-modify-write here would work off a stale copy.
  const env = fakeEnv({
    'customer:+447700900123': JSON.stringify({
      id: 'acct', contact: '+447700900123', name: 'Sam', promoOrdersUsed: 3, addresses: [],
    }),
  });
  const r = await rememberContact({
    name: 'Sam', phone: '07700900123', skipContact: '+447700900123',
  }, env);
  assert.equal(r, null);
  assert.equal(rec(env, '+447700900123').promoOrdersUsed, 3);

  // A DIFFERENT contact (the email-keyed-account case) is still remembered.
  const r2 = await rememberContact({
    name: 'Sam', phone: '07700900123', skipContact: 'sam@example.com',
  }, env);
  assert.equal(r2, '+447700900123');
});

test('stores nothing when there is no usable UK number', async () => {
  for (const phone of ['', null, undefined, 'walk-in', '12345', '+33123456789']) {
    const env = fakeEnv();
    assert.equal(await rememberContact({ name: 'X', phone }, env), null);
    assert.equal(env.store.size, 0);
  }
});

test('never throws, and never blocks the order', async () => {
  // Best-effort by contract: it is awaited after the order is persisted, so a
  // KV failure must surface as "not remembered", never as a rejected promise.
  const broken = { CUSTOMERS_KV: { get: async () => { throw new Error('KV down'); }, put: async () => {} } };
  assert.equal(await rememberContact({ name: 'X', phone: '07700900123' }, broken), null);
  // And with no KV bound at all (a shop mid-setup).
  assert.equal(await rememberContact({ name: 'X', phone: '07700900123' }, {}), null);
  assert.equal(await rememberContact({ name: 'X', phone: '07700900123' }, undefined), null);
});
