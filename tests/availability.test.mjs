/* functions/_lib/availability.js — item 86-list with the fake KV.
   Uses the injected fixtures config (businessDayStartHour 0) via londonDay. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKV } from './support/fake-kv.mjs';
import { getOffMap, getOffIds, setOff, setOn } from '../functions/_lib/availability.js';

const KEY = 'item-availability';

test('setOff(manual) marks an item off; setOn removes it', async () => {
  const env = { ORDERS_KV: makeKV() };
  await setOff(env, 'burger', 'manual', 'Test Burger');
  let map = await getOffMap(env);
  assert.ok(map.burger);
  assert.equal(map.burger.mode, 'manual');
  assert.equal(map.burger.untilDay, null);
  const ids = await getOffIds(env);
  assert.ok(ids.has('burger'));
  await setOn(env, 'burger');
  map = await getOffMap(env);
  assert.equal(map.burger, undefined);
});

test("setOff('tomorrow') sets an untilDay in the future and survives a read today", async () => {
  const env = { ORDERS_KV: makeKV() };
  await setOff(env, 'coke', 'tomorrow', 'Coke');
  const map = await getOffMap(env);
  assert.ok(map.coke);
  assert.equal(map.coke.mode, 'tomorrow');
  assert.match(map.coke.untilDay, /^\d{4}-\d{2}-\d{2}$/);
});

test("an expired 'tomorrow' entry is pruned lazily on read", async () => {
  const env = { ORDERS_KV: makeKV({ [KEY]: { stale: { mode: 'tomorrow', untilDay: '2000-01-01', since: 'x', name: 'Old' } } }) };
  const map = await getOffMap(env);
  assert.equal(map.stale, undefined);          // today >= 2000-01-01 → dropped
});

test('missing ORDERS_KV degrades to empty, never throws', async () => {
  const map = await getOffMap({});
  assert.deepEqual(map, {});
  assert.equal((await setOff({}, 'x', 'manual')), null);
});
