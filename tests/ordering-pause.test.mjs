/* functions/_lib/ordering-pause.js — the runtime "pause online ordering" toggle. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKV } from './support/fake-kv.mjs';
import { getOrderingPause, setOrderingPause } from '../functions/_lib/ordering-pause.js';

const KEY = 'setting:ordering-paused';

test('default: not paused', async () => {
  assert.deepEqual(await getOrderingPause({ ORDERS_KV: makeKV() }), { paused: false });
});

test('pause records who + when; resume clears it', async () => {
  const env = { ORDERS_KV: makeKV() };
  const p = await setOrderingPause(env, true, 'Songul');
  assert.equal(p.paused, true);
  const g = await getOrderingPause(env);
  assert.equal(g.paused, true);
  assert.equal(g.by, 'Songul');
  assert.ok(g.since);
  await setOrderingPause(env, false);
  assert.equal((await getOrderingPause(env)).paused, false);
});

test('a pause set on a PREVIOUS trading day auto-resumes (reads as open)', async () => {
  const env = { ORDERS_KV: makeKV({ [KEY]: JSON.stringify({ day: '2000-01-01', at: 'x', by: 'y' }) }) };
  assert.equal((await getOrderingPause(env)).paused, false);
});

test('missing ORDERS_KV is safe (never throws, reads open)', async () => {
  assert.equal((await getOrderingPause({})).paused, false);
  assert.deepEqual(await setOrderingPause({}, true, 'x'), { paused: false });
});

test('a corrupt stored value reads as open, not an error', async () => {
  const env = { ORDERS_KV: makeKV({ [KEY]: 'not json' }) };
  assert.equal((await getOrderingPause(env)).paused, false);
});
