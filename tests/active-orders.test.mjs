/* functions/_lib/kv.js — listActiveOrders.

   This is the hottest read path in the platform: every till polls it, and what
   it returns IS the kitchen board. Two properties matter, and they pull against
   each other:

     1. Cost. Each order it returns costs a KV read on every poll of every till.
        Orders left in an open status used to accumulate for ever, so the per-
        poll cost grew without bound — the larger half of a $76/cycle bill.
     2. Correctness. An order it drops is an order the kitchen never cooks.

   So the age bound is tested from both sides: that stale orders stop being
   FETCHED (not merely filtered after the fact — a read you paid for is a read
   you paid for), and that nothing a shop still needs is lost, including the
   scheduled order placed days before the day it is wanted on. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listActiveOrders } from '../functions/_lib/kv.js';
import { makeKV } from './support/fake-kv.mjs';

const DAY = 24 * 60 * 60 * 1000;
// tests/fixtures/config.json sets scheduling.horizonDays = 2, so the window is
// 3 days. Anything older than that is outside it.
const WINDOW_DAYS = 3;

function order(id, status, agoMs, extra = {}) {
  const createdAt = new Date(Date.now() - agoMs).toISOString();
  return { id, status, createdAt, orderNumber: id, items: [], ...extra };
}

/* A KV that counts value reads, so a test can assert on what was actually
   FETCHED rather than only on what came back. */
function kvWith(orders) {
  const kv = makeKV();
  for (const o of orders) {
    kv._store.set(`orders:${o.id}`, {
      value: JSON.stringify(o),
      metadata: { status: o.status, createdAt: o.createdAt, fulfillment: o.fulfillment || 'collection' },
    });
  }
  let reads = 0;
  const get = kv.get.bind(kv);
  kv.get = async (...a) => { reads++; return get(...a); };
  return { env: { ORDERS_KV: kv }, reads: () => reads };
}

const ids = (list) => list.map((o) => o.id).sort();

test('a fresh order in every kitchen-visible status reaches the board', async () => {
  const statuses = ['pending_accept', 'accepted', 'ready', 'out_for_delivery'];
  const { env } = kvWith(statuses.map((s, i) => order(s, s, i * 1000)));
  const active = await listActiveOrders(env);
  assert.deepEqual(ids(active), statuses.slice().sort());
});

test('a completed or cancelled order is never fetched at all', async () => {
  const { env, reads } = kvWith([
    order('done', 'completed', 60_000),
    order('void', 'cancelled', 60_000),
    order('live', 'accepted', 60_000),
  ]);
  const active = await listActiveOrders(env);
  assert.deepEqual(ids(active), ['live']);
  // One read, for the one live order. The other two were excluded on metadata.
  assert.equal(reads(), 1, 'completed/cancelled orders must not cost a body read');
});

test('an order left open past the window stops being fetched', async () => {
  const { env, reads } = kvWith([
    order('today', 'accepted', 60_000),
    order('forgotten', 'accepted', (WINDOW_DAYS + 1) * DAY),
    order('ancient', 'ready', 400 * DAY),
  ]);
  const active = await listActiveOrders(env);
  assert.deepEqual(ids(active), ['today'], 'only the current order belongs on the live board');
  assert.equal(reads(), 1,
    'the whole point is not paying a read for an order the board will not show');
});

test('an order just inside the window is still shown', async () => {
  // Half a day inside the boundary — guards against an off-by-one that would
  // drop the previous night's late orders.
  const { env } = kvWith([order('yesterday', 'accepted', (WINDOW_DAYS - 0.5) * DAY)]);
  assert.deepEqual(ids(await listActiveOrders(env)), ['yesterday']);
});

test('a scheduled order placed days ahead survives to its slot', async () => {
  /* The regression this bound could most easily have caused. A customer orders
     on Monday for Wednesday: created Monday, sits in pending_accept, and must
     still be on the board on Wednesday. A flat 24-hour window would have binned
     it — which is why the window is derived from scheduling.horizonDays. */
  const slot = new Date(Date.now() + 1 * DAY).toISOString();
  const { env } = kvWith([order('preorder', 'pending_accept', 2 * DAY, { slot })]);
  assert.deepEqual(ids(await listActiveOrders(env)), ['preorder']);
});

test('an order with no createdAt metadata is kept, not hidden', async () => {
  /* Fail open. A read costs a fraction of a penny; an order missing from the
     kitchen board costs a customer. Old orders written before createdAt was in
     the metadata must not vanish. */
  const kv = makeKV();
  kv._store.set('orders:legacy', {
    value: JSON.stringify({ id: 'legacy', status: 'accepted', createdAt: null, items: [] }),
    metadata: { status: 'accepted' },            // no createdAt
  });
  const active = await listActiveOrders({ ORDERS_KV: kv });
  assert.deepEqual(ids(active), ['legacy']);
});

test('the board is newest-first', async () => {
  const { env } = kvWith([
    order('old', 'accepted', 3 * 60_000),
    order('new', 'accepted', 1 * 60_000),
    order('mid', 'accepted', 2 * 60_000),
  ]);
  const active = await listActiveOrders(env);
  assert.deepEqual(active.map((o) => o.id), ['new', 'mid', 'old']);
});

test('body status wins over stale key metadata', async () => {
  /* KV list metadata can briefly lag the order doc. An order completed a moment
     ago must not flash back onto the board because its metadata has not caught
     up — the body is re-checked for exactly this. */
  const kv = makeKV();
  const o = order('raced', 'completed', 60_000);
  kv._store.set('orders:raced', {
    value: JSON.stringify(o),
    metadata: { status: 'accepted', createdAt: o.createdAt },  // stale
  });
  assert.deepEqual(await listActiveOrders({ ORDERS_KV: kv }), []);
});
