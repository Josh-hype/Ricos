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

test('listSlots offers no slots on a one-off closed day', () => {
  const tz = config.ordering.timezone;
  const ymd = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86400000));
  // Close every day in the 2-day horizon → listSlots must return nothing.
  const closures = {};
  for (let d = 0; d <= 2; d++) closures[ymd(d)] = { title: 'Closed', message: 'Closed.' };
  const closed = { ...config, closures };
  assert.equal(listSlots(closed).length, 0);
  // Sanity: the same config without closures does offer slots.
  assert.ok(listSlots({ ...config, closures: {} }).length >= 0);
  // And a slot that WAS offered is gone once its day is closed.
  const open = listSlots({ ...config, closures: {} });
  if (open.length) {
    const firstDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(open[0]));
    const closedThatDay = listSlots({ ...config, closures: { [firstDay]: { title: 'x', message: 'x' } } });
    assert.ok(!closedThatDay.includes(open[0]), 'a closed day removes its slots');
  }
});

test('isSlotValid accepts a listed slot and rejects a bogus one', () => {
  const slots = listSlots(config);
  if (slots.length) assert.equal(isSlotValid(slots[0], config), true);
  assert.equal(isSlotValid('2020-01-01T00:00:00.000Z', config), false);  // in the past
  assert.equal(isSlotValid('not-a-date', config), false);
});

/* The closure bug these lock down: listSlots used to test a day's closure
   against the date of the day it was ITERATING, not the date each slot
   actually falls on. A window running past midnight — Friday 09:00-25:00 in
   this fixture — puts its last slots on Saturday, so closing Saturday left
   them on offer while /api/order, which reads closures through activeClosure,
   refused the order at checkout.

   The test above only caught it on a Friday, which is why it passed for
   months. These build themselves from whatever slots the config actually
   offers, so they hold on any day and at any hour. The horizon is widened to
   3 days for exactly that reason: with 2, a run just before local midnight
   has only one shop-local date left in it and there is nothing to compare. */
const localDate = (iso, tz) => new Intl.DateTimeFormat('en-CA',
  { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/* 09:00 to 02:00 the NEXT day, every day. The close time has to be past 24:00
   for this to test anything: lastOrderBeforeCloseMinutes takes 15 off the end,
   so a window closing at 24:00 stops at 23:45 and never emits a slot on the
   following date — which is the whole case under test. A first draft of these
   used 24:00 and passed against the broken code. */
const allHours = () => {
  const w = { closed: false, windows: [{ open: '09:00', close: '26:00' }] };
  return {
    ...config,
    ordering: { ...config.ordering, scheduling: { ...config.ordering.scheduling, horizonDays: 3 } },
    hours: { sunday: w, monday: w, tuesday: w, wednesday: w, thursday: w, friday: w, saturday: w },
    closures: {},
  };
};

const byLocalDate = (slots, tz) => {
  const m = new Map();
  for (const s of slots) m.set(localDate(s, tz), [...(m.get(localDate(s, tz)) || []), s]);
  return m;
};

test('closing a date removes exactly that date’s slots and no others', () => {
  const tz = config.ordering.timezone;
  const cfg = allHours();
  const groups = byLocalDate(listSlots(cfg), tz);
  assert.ok(groups.size >= 2, 'a 3-day horizon must span at least two shop-local dates');

  for (const [date, slots] of groups) {
    const after = listSlots({ ...cfg, closures: { [date]: { title: 'x', message: 'x' } } });
    for (const s of slots) assert.ok(!after.includes(s), `closing ${date} must drop its ${s}`);
    // A closure is one date, not a range: every other date is untouched.
    for (const [other, otherSlots] of groups) {
      if (other === date) continue;
      for (const s of otherSlots) assert.ok(after.includes(s), `closing ${date} must not touch ${other}'s ${s}`);
    }
  }
});

test('a slot past midnight is judged by ITS date, not by the window’s day', () => {
  /* The regression itself. The 00:00 slot on each date is generated while
     iterating the PREVIOUS date's window, so under the old code closing its
     own date left it on offer. */
  const tz = config.ordering.timezone;
  const cfg = allHours();
  const groups = byLocalDate(listSlots(cfg), tz);
  const dates = [...groups.keys()].sort();
  const later = dates[dates.length - 1];

  const earlierClosed = listSlots({ ...cfg, closures: { [dates[0]]: { title: 'x', message: 'x' } } });
  for (const s of groups.get(later)) {
    assert.ok(earlierClosed.includes(s), `${s} is on ${later}; closing ${dates[0]} must not drop it`);
  }
  const laterClosed = listSlots({ ...cfg, closures: { [later]: { title: 'x', message: 'x' } } });
  for (const s of groups.get(later)) {
    assert.ok(!laterClosed.includes(s), `${s} is on ${later}; closing ${later} must drop it`);
  }
});

test('the indefinite "*" closure still offers nothing at all', () => {
  assert.equal(listSlots({ ...allHours(), closures: { '*': { title: 'x', message: 'x' } } }).length, 0);
});

test('a dated closure alongside "*" still offers nothing', () => {
  const tz = config.ordering.timezone;
  const today = localDate(new Date().toISOString(), tz);
  assert.equal(listSlots({ ...allHours(),
    closures: { '*': { title: 'x', message: 'x' }, [today]: { title: 'y', message: 'y' } } }).length, 0);
});
