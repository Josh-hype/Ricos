/* functions/_lib/tables.js — dine-in table normalisation + lookup, and the
   hospitality sale modes (eat in / takeaway) in priceCounterSale. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTables, findTable, tablesFor } from '../functions/_lib/tables.js';
import { getConfig } from '../functions/_lib/config.js';
import { priceCounterSale, ANON_MODES } from '../functions/_lib/counter-totals.js';

const config = getConfig();

test('normalizeTables accepts plain labels', () => {
  const t = normalizeTables(['1', '2', '3']);
  assert.equal(t.length, 3);
  assert.deepEqual(t[0], { id: '1', label: '1', area: '' });
});

test('normalizeTables accepts objects with an area, and derives a stable id', () => {
  const t = normalizeTables([{ label: '1', area: 'Window' }, { label: '1', area: 'Patio' }]);
  assert.equal(t.length, 2);                 // same label in two areas ⇒ two tables
  assert.equal(t[0].id, 'window-1');
  assert.equal(t[1].id, 'patio-1');
  assert.equal(t[0].area, 'Window');
});

test('normalizeTables honours an explicit id', () => {
  const [t] = normalizeTables([{ id: 'vip', label: 'VIP booth' }]);
  assert.equal(t.id, 'vip');
  assert.equal(t.label, 'VIP booth');
});

test('normalizeTables drops blanks + duplicate ids rather than throwing', () => {
  const t = normalizeTables(['1', '', '1', null, { label: '' }, { nope: true }]);
  assert.equal(t.length, 1);
  assert.equal(t[0].id, '1');
});

test('normalizeTables tolerates a non-array (shop with no tables)', () => {
  assert.deepEqual(normalizeTables(undefined), []);
  assert.deepEqual(normalizeTables('nope'), []);
});

test('findTable only matches a configured table', () => {
  const cfg = { pos: { tables: [{ label: '4', area: 'Inside' }] } };
  assert.equal(findTable(cfg, 'inside-4').label, '4');
  assert.equal(findTable(cfg, 'inside-9'), null);   // unknown id can't reach an order
  assert.equal(findTable(cfg, ''), null);
  assert.equal(findTable(cfg, null), null);
});

test('tablesFor returns [] for a takeaway shop (no pos.tables)', () => {
  assert.deepEqual(tablesFor(config), []);
});

test('eat in / takeaway price like a walk-in counter sale', async () => {
  const walkin = await priceCounterSale({ items: [{ id: 'burger', qty: 1 }], mode: 'walkin' }, config);
  for (const mode of ['eatin', 'takeaway']) {
    const r = await priceCounterSale({ items: [{ id: 'burger', qty: 1 }], mode }, config);
    assert.equal(r.ok, true, `${mode} should price`);
    assert.equal(r.mode, mode);
    assert.equal(r.fulfillment, 'collection');       // neither is a delivery
    assert.equal(r.totals.serviceFeeP, 0);           // counter sale ⇒ no platform fee
    assert.equal(r.totals.discountP, 0);             // counter sale ⇒ no online promo
    assert.equal(r.totals.totalP, walkin.totals.totalP);
  }
});

test('an unknown mode still falls back to walkin (unchanged behaviour)', async () => {
  const r = await priceCounterSale({ items: [{ id: 'burger', qty: 1 }], mode: 'banquet' }, config);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'walkin');
});

test('ANON_MODES covers exactly the no-customer-details modes', () => {
  assert.equal(ANON_MODES.has('walkin'), true);
  assert.equal(ANON_MODES.has('eatin'), true);
  assert.equal(ANON_MODES.has('takeaway'), true);
  assert.equal(ANON_MODES.has('collection'), false);  // still needs name + phone
  assert.equal(ANON_MODES.has('delivery'), false);
});
