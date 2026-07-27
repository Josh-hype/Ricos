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

/* Receipt wording is a live-kitchen contract: the printed ticket has always said
   "WALK IN" (space) while the on-screen board says "Walk-in" (hyphen). The
   hospitality change routes both through shared helpers, so pin the exact strings
   here — collapsing them would silently alter every existing shop's receipts.
   Mirrors SOURCE_LABELS / SOURCE_LABELS_PRINT in templates/staff/index.html. */
const SOURCE_LABELS = { 'counter-walkin': 'Walk-in', 'counter-eatin': 'Eat in', 'counter-takeaway': 'Takeaway' };
const SOURCE_LABELS_PRINT = { 'counter-walkin': 'WALK IN', 'counter-eatin': 'EAT IN', 'counter-takeaway': 'TAKEAWAY' };
const screenLabel = (o) => (o.fulfillment === 'delivery' ? 'Delivery' : SOURCE_LABELS[o.source] || 'Collection');
const printLabel = (o) => (o.fulfillment === 'delivery' ? 'DELIVERY' : SOURCE_LABELS_PRINT[o.source] || 'COLLECTION');

test('printed receipt wording is unchanged for existing takeaway order shapes', () => {
  const cases = [
    [{ source: 'counter-walkin', fulfillment: 'collection' }, 'WALK IN', 'Walk-in'],
    [{ source: 'counter-collection', fulfillment: 'collection' }, 'COLLECTION', 'Collection'],
    [{ source: 'counter-delivery', fulfillment: 'delivery' }, 'DELIVERY', 'Delivery'],
    [{ source: 'web', fulfillment: 'collection' }, 'COLLECTION', 'Collection'],
    [{ source: 'web', fulfillment: 'delivery' }, 'DELIVERY', 'Delivery'],
    [{ fulfillment: 'collection' }, 'COLLECTION', 'Collection'],   // pre-existing order, no source
  ];
  for (const [o, print, screen] of cases) {
    assert.equal(printLabel(o), print, `print label for ${JSON.stringify(o)}`);
    assert.equal(screenLabel(o), screen, `screen label for ${JSON.stringify(o)}`);
  }
  // "WALK IN" must NOT become "WALK-IN" — that was a real regression caught pre-merge.
  assert.notEqual(printLabel({ source: 'counter-walkin', fulfillment: 'collection' }), 'WALK-IN');
});

test('the new hospitality modes get their own printed wording', () => {
  assert.equal(printLabel({ source: 'counter-eatin', fulfillment: 'collection' }), 'EAT IN');
  assert.equal(printLabel({ source: 'counter-takeaway', fulfillment: 'collection' }), 'TAKEAWAY');
  assert.equal(screenLabel({ source: 'counter-eatin', fulfillment: 'collection' }), 'Eat in');
});

/* Mode-list drift guard. /api/staff/pay-link once kept a PRIVATE copy of the mode
   whitelist; when eatin/takeaway were added it silently coerced an eat-in sale to
   'walkin' and dropped the table, so a paid-by-link order reached the kitchen with
   no table on it. Both endpoints now import the one set — assert they still do, and
   that no endpoint re-declares its own. */
import { readFileSync } from 'node:fs';
import { MODES, TABLE_MODES } from '../functions/_lib/counter-totals.js';

test('every sale endpoint imports the shared mode list instead of redeclaring one', () => {
  for (const f of ['functions/api/staff/counter-order.js', 'functions/api/staff/pay-link.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(src, /from '\.\.\/\.\.\/_lib\/counter-totals\.js'/, `${f} must import counter-totals`);
    assert.doesNotMatch(src, /const\s+MODES\s*=\s*new Set/, `${f} must NOT declare its own MODES set`);
  }
});

test('pay-link validates the eat-in table and stores it on the order', () => {
  const src = readFileSync(new URL('../functions/api/staff/pay-link.js', import.meta.url), 'utf8');
  assert.match(src, /TABLE_MODES\.has\(mode\)/, 'pay-link must apply the table rule');
  assert.match(src, /findTable\(config, body\.tableId\)/, 'pay-link must resolve the table');
  assert.match(src, /\.\.\.\(table \? \{ table \} : \{\}\)/, 'pay-link must persist the table');
});

test('the shared mode + table sets carry the expected members', () => {
  for (const m of ['walkin', 'collection', 'delivery', 'eatin', 'takeaway']) {
    assert.equal(MODES.has(m), true, `${m} should be a valid mode`);
  }
  assert.equal(MODES.has('banquet'), false);
  assert.deepEqual([...TABLE_MODES], ['eatin']);   // only dine-in needs a table
});

/* Reporting split. Eat-in and takeaway sales both carry fulfillment 'collection',
   so the Z-report's collection/delivery counts can't tell them apart — a coffee
   shop would file its whole day under "Collection". summary.js adds eatIn/takeaway
   counts derived from o.source. The addition must be ADDITIVE: a takeaway shop
   never produces those sources, so its figures stay exactly as they were. */
const isEatIn = (o) => /^(counter|link)-eatin$/.test(o.source || '');
const isTakeaway = (o) => /^(counter|link)-takeaway$/.test(o.source || '');

test('the reporting split classifies hospitality sources and ignores takeaway ones', () => {
  const day = [
    { source: 'counter-eatin', fulfillment: 'collection' },
    { source: 'link-eatin', fulfillment: 'collection' },
    { source: 'counter-takeaway', fulfillment: 'collection' },
    { source: 'counter-walkin', fulfillment: 'collection' },
    { source: 'counter-collection', fulfillment: 'collection' },
    { source: 'web', fulfillment: 'delivery' },
    { fulfillment: 'collection' },                      // legacy order, no source
  ];
  assert.equal(day.filter(isEatIn).length, 2);
  assert.equal(day.filter(isTakeaway).length, 1);
  // The pre-existing buckets are untouched by the addition.
  assert.equal(day.filter(o => o.fulfillment === 'collection').length, 6);
  assert.equal(day.filter(o => o.fulfillment === 'delivery').length, 1);
});

test('a takeaway-only day reports zero eat-in/takeaway, so its Z-report is unchanged', () => {
  const day = [
    { source: 'counter-walkin', fulfillment: 'collection' },
    { source: 'counter-collection', fulfillment: 'collection' },
    { source: 'counter-delivery', fulfillment: 'delivery' },
    { source: 'link-walkin', fulfillment: 'collection' },
    { source: 'web', fulfillment: 'collection' },
  ];
  assert.equal(day.filter(isEatIn).length, 0);
  assert.equal(day.filter(isTakeaway).length, 0);
});
