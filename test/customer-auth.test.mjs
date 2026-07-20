/* Customer auth + order-token + rate-limit tests (customer app groundwork).
   Run: node --test test/customer-auth.test.mjs   (same harness style as auth.test.mjs)

   The cross-type checks at the bottom are the security-sensitive ones: every
   token minted from SESSION_SECRET (staff session, customer session, customer
   reset link, order-status capability) must verify ONLY as its own kind. */

import * as auth from '../functions/_lib/auth.js';
import * as cust from '../functions/_lib/customer-auth.js';
import { makeOrderStatusToken, verifyOrderStatusToken } from '../functions/_lib/order-token.js';
import { rateLimit } from '../functions/_lib/rate-limit.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', name); } };
const reqWith = (h) => ({ headers: { get: (k) => h[k] ?? h[k.toLowerCase()] ?? null } });

// In-memory CUSTOMERS_KV so getCustomer() (used by session verification to
// enforce the password fingerprint) has a record to find.
const kvStore = new Map();
const CUSTOMERS_KV = {
  get: async (k) => (kvStore.has(k) ? kvStore.get(k) : null),
  put: async (k, v) => { kvStore.set(k, String(v)); },
  delete: async (k) => { kvStore.delete(k); },
};
const env = { SESSION_SECRET: 'test-secret-123', CUSTOMERS_KV };

const customer = {
  id: 'abc123def456',
  name: 'Test',
  contact: 'test@example.com',
  contactType: 'email',
  hash: 'f'.repeat(64),
  salt: '0'.repeat(32),
  iterations: 100000,
};
kvStore.set(`customer:${customer.contact}`, JSON.stringify(customer));

/* ── Customer session: cookie + Bearer ─────────────────────────────────── */
const session = await cust.makeCustomerSession(customer, env);

ok('cookie path resolves', (await cust.readCustomerSession('cu=' + session, env))?.contact === customer.contact);
ok('cookie among many resolves', (await cust.readCustomerSession('a=b; cu=' + session + '; c=d', env))?.contact === customer.contact);
ok('resolveCustomerSession cookie', (await cust.resolveCustomerSession(reqWith({ Cookie: 'cu=' + session }), env))?.contact === customer.contact);
ok('resolveCustomerSession bearer', (await cust.resolveCustomerSession(reqWith({ Authorization: 'Bearer ' + session }), env))?.contact === customer.contact);
ok('resolveCustomerSession bearer case-insensitive', (await cust.resolveCustomerSession(reqWith({ Authorization: 'bearer ' + session }), env))?.contact === customer.contact);
ok('no creds -> null', (await cust.resolveCustomerSession(reqWith({}), env)) === null);
ok('bad signature -> null', (await cust.resolveCustomerSession(reqWith({ Authorization: 'Bearer ' + session.slice(0, -4) + 'AAAA' }), env)) === null);
ok('wrong secret -> null', (await cust.resolveCustomerSession(reqWith({ Authorization: 'Bearer ' + session }), { ...env, SESSION_SECRET: 'other' })) === null);
ok('unknown customer -> null', await (async () => {
  const ghost = await cust.makeCustomerSession({ ...customer, contact: 'ghost@example.com' }, env);
  return (await cust.verifyCustomerToken(ghost, env)) === null;
})());

// Password change invalidates outstanding sessions (fingerprint mismatch).
kvStore.set(`customer:${customer.contact}`, JSON.stringify({ ...customer, hash: 'e'.repeat(64) }));
ok('password change kills old session', (await cust.verifyCustomerToken(session, env)) === null);
kvStore.set(`customer:${customer.contact}`, JSON.stringify(customer)); // restore

/* ── Reset tokens are their own kind ───────────────────────────────────── */
const reset = await cust.makeResetToken(customer, env);
ok('reset token verifies as reset', (await cust.verifyResetToken(reset, env))?.contact === customer.contact);
ok('reset token is NOT a session', (await cust.verifyCustomerToken(reset, env)) === null);
ok('session token is NOT a reset token', (await cust.verifyResetToken(session, env)) === null);

/* ── Order-status capability tokens ────────────────────────────────────── */
const orderTok = await makeOrderStatusToken('AB12CD3', env);
ok('order token verifies for its order', await verifyOrderStatusToken(orderTok, 'AB12CD3', env));
ok('order token rejects a different order', !(await verifyOrderStatusToken(orderTok, 'ZZ99XX1', env)));
ok('order token rejects tampering', !(await verifyOrderStatusToken(orderTok.slice(0, -4) + 'AAAA', 'AB12CD3', env)));
ok('order token needs the secret', !(await verifyOrderStatusToken(orderTok, 'AB12CD3', { SESSION_SECRET: 'other' })));

/* ── CROSS-TYPE: no token may act as another kind ──────────────────────── */
// The live escalation this closes: reset tokens (emailed to customers) used to
// pass staff resolveSession() as a Bearer — {c, fp, exp} has no `scope`.
ok('customer session must NOT be a staff session', (await auth.resolveSession(reqWith({ Authorization: 'Bearer ' + session }), env)) === null);
ok('reset token must NOT be a staff session', (await auth.resolveSession(reqWith({ Authorization: 'Bearer ' + reset }), env)) === null);
ok('order token must NOT be a staff session', (await auth.resolveSession(reqWith({ Authorization: 'Bearer ' + orderTok }), env)) === null);
const staffTok = await auth.makeSession(env);
ok('staff session must NOT be a customer session', (await cust.verifyCustomerToken(staffTok, env)) === null);
ok('staff session must NOT be an order token', !(await verifyOrderStatusToken(staffTok, 'AB12CD3', env)));
ok('customer session must NOT be an order token', !(await verifyOrderStatusToken(session, 'AB12CD3', env)));
// Staff sessions still work after the `c`-claim rejection was added:
ok('staff session still resolves as staff', (await auth.resolveSession(reqWith({ Authorization: 'Bearer ' + staffTok }), env)) !== null);

/* ── Rate limiter ──────────────────────────────────────────────────────── */
const rlStore = new Map();
const RL_KV = {
  get: async (k) => (rlStore.has(k) ? rlStore.get(k) : null),
  put: async (k, v) => { rlStore.set(k, String(v)); },
};
const rlEnv = { STAFF_LOGIN_KV: RL_KV };
const rlReq = { headers: { get: (k) => (k === 'cf-connecting-ip' ? '1.2.3.4' : null) } };
ok('under the limit -> null', (await rateLimit(rlEnv, 't', rlReq, 3)) === null);
await rateLimit(rlEnv, 't', rlReq, 3);
await rateLimit(rlEnv, 't', rlReq, 3);
const limited = await rateLimit(rlEnv, 't', rlReq, 3);
ok('over the limit -> 429 Response', limited && limited.status === 429);
ok('buckets are independent', (await rateLimit(rlEnv, 'other', rlReq, 3)) === null);
ok('no KV binding -> skipped', (await rateLimit({}, 't', rlReq, 1)) === null);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
