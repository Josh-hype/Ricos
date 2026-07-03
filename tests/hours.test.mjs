/* functions/_lib/hours.js — closures, late-start, slot generation.
   The date-parameterised functions (deliveryLateStart/activeClosure) are tested
   deterministically; isOpenNow/listSlots use the real clock so we assert only
   their structural invariants. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../functions/_lib/config.js';
import { deliveryLateStart, activeClosure, listSlots, isSlotValid } from '../functions/_lib/hours.js';

const config = getConfig();

test('deliveryLateStart blocks a listed date before the cutoff, allows at/after', () => {
  // fixtures: lateStart { "2026-06-27": "16:30" }, London tz.
  const before = deliveryLateStart(config, new Date('2026-06-27T14:00:00+01:00'));
  assert.equal(before.ok, false);
  assert.equal(before.from, '16:30');
  const after = deliveryLateStart(config, new Date('2026-06-27T17:00:00+01:00'));
  assert.equal(after.ok, true);
});

test('deliveryLateStart is a no-op on an unlisted date', () => {
  assert.equal(deliveryLateStart(config, new Date('2026-07-01T10:00:00+01:00')).ok, true);
});

test('activeClosure matches only the listed shop-local date', () => {
  // fixtures: closures { "2026-06-29": {...} }
  const on = activeClosure(config, new Date('2026-06-29T12:00:00+01:00'));
  assert.ok(on && /Closed/.test(on.title));
  const off = activeClosure(config, new Date('2026-06-28T12:00:00+01:00'));
  assert.equal(off, null);
});

test('activeClosure returns null when no closures configured', () => {
  assert.equal(activeClosure({ ordering: { timezone: 'Europe/London' } }, new Date()), null);
});

test('listSlots returns ISO strings that are all in the future and quantised to slotMinutes', () => {
  const slots = listSlots(config);
  assert.ok(Array.isArray(slots));
  const now = Date.now();
  for (const iso of slots) {
    const t = new Date(iso);
    assert.ok(!Number.isNaN(t.getTime()), `valid date: ${iso}`);
    assert.ok(t.getTime() >= now, 'slot is in the future');
    assert.equal(t.getUTCMinutes() % 15, 0, 'aligned to 15-minute grid');
  }
  assert.equal(new Set(slots).size, slots.length, 'no duplicate slots');
});

test('isSlotValid accepts a listed slot and rejects a bogus one', () => {
  const slots = listSlots(config);
  if (slots.length) assert.equal(isSlotValid(slots[0], config), true);
  assert.equal(isSlotValid('2020-01-01T00:00:00.000Z', config), false);  // in the past
  assert.equal(isSlotValid('not-a-date', config), false);
});
