/* Pricing authority — functions/_lib/totals.js.
   These lock the CURRENT behaviour (the fixtures menu/config are injected by
   tests/support/loader.mjs). Run: node --import ./tests/support/register.mjs --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../functions/_lib/config.js';
import { computeTotals } from '../functions/_lib/totals.js';

const config = getConfig();

test('collection order: base + meal add + flat + size-priced + whenMeal modifier, with promo + service fee', () => {
  const t = computeTotals({
    items: [{ id: 'burger', qty: 1, meal: true, modifiers: ['extra', 'cheese', 'lg', 'topping'], mealChoices: ['fries'] }],
    fulfillment: 'collection',
  }, config);
  assert.equal(t.ok, true);
  // 800 base + 300 meal + 200 extra + 100 cheese(whenMeal) + 0 lg + 150 topping@lg = 1550
  assert.equal(t.subtotalP, 1550);
  assert.equal(t.discountP, 155);                 // 10% of 1550
  assert.equal(t.serviceFeeP, 100);
  assert.equal(t.serviceFeePlatformP, 50);
  assert.equal(t.serviceFeeShopP, 50);
  assert.equal(t.deliveryFeeP, 0);
  assert.equal(t.totalP, 1550 - 155 + 100);       // 1495
  // Every applied modifier's label is recorded, including the zero-price size 'Large'.
  assert.deepEqual(t.lines[0].modifiers, ['Extra patty', 'Cheese on chips', 'Large', 'Topping']);
  assert.deepEqual(t.lines[0].mealChoices, ['Fries']);
});

test('whenMeal modifier is ignored (no charge, not recorded) on a non-meal line', () => {
  const t = computeTotals({
    items: [{ id: 'burger', qty: 1, meal: false, modifiers: ['cheese'] }],
    fulfillment: 'collection',
  }, config);
  assert.equal(t.subtotalP, 800);                 // cheese (whenMeal) skipped
  assert.deepEqual(t.lines[0].modifiers, []);
});

test('size-priced modifier falls back to flat priceDeltaP when no size selected', () => {
  const t = computeTotals({
    items: [{ id: 'burger', qty: 1, modifiers: ['topping'] }],
    fulfillment: 'collection',
  }, config);
  assert.equal(t.subtotalP, 900);                 // 800 + flat topping 100 (no 'lg')
});

test('first-order discount (opts) overrides the standing online discount and uses its label', () => {
  const t = computeTotals({
    items: [{ id: 'burger', qty: 1, meal: true, modifiers: ['extra', 'cheese', 'lg', 'topping'], mealChoices: ['fries'] }],
    fulfillment: 'collection',
  }, config, { firstOrderDiscount: { percent: 15, label: '15% off — first 2 orders' } });
  assert.equal(t.ok, true);
  assert.equal(t.subtotalP, 1550);
  assert.equal(t.discountP, 233);                 // 15% of 1550 (not the 10% auto discount = 155)
  assert.equal(t.discountLabel, '15% off — first 2 orders');
  assert.equal(t.totalP, 1550 - 233 + 100);       // 1417
});

test('suppressPromo also suppresses the first-order discount (counter sale)', () => {
  const t = computeTotals({
    items: [{ id: 'burger', qty: 1, meal: true, modifiers: ['extra', 'cheese', 'lg', 'topping'], mealChoices: ['fries'] }],
    fulfillment: 'collection',
  }, config, { firstOrderDiscount: { percent: 15, label: 'x' }, suppressPromo: true });
  assert.equal(t.discountP, 0);
  assert.equal(t.discountLabel, null);
});

test('first-order percent is clamped to 0..100', () => {
  const over = computeTotals({ items: [{ id: 'coke', qty: 1 }], fulfillment: 'collection' }, config, { firstOrderDiscount: { percent: 999 } });
  assert.equal(over.discountP, over.subtotalP);    // 100% cap — never exceeds subtotal
  const neg = computeTotals({ items: [{ id: 'coke', qty: 1 }], fulfillment: 'collection' }, config, { firstOrderDiscount: { percent: -20 } });
  assert.equal(neg.discountP, 0);
});

test('quantity is floored and clamped to 1..20', () => {
  const frac = computeTotals({ items: [{ id: 'coke', qty: 2.9 }], fulfillment: 'collection' }, config);
  assert.equal(frac.lines[0].qty, 2);             // floor, not round
  assert.equal(frac.lines[0].lineTotalP, 300);    // 150 * 2 — integer pence
  const hi = computeTotals({ items: [{ id: 'coke', qty: 999 }], fulfillment: 'collection' }, config);
  assert.equal(hi.lines[0].qty, 20);
  const lo = computeTotals({ items: [{ id: 'coke', qty: 0 }], fulfillment: 'collection' }, config);
  assert.equal(lo.lines[0].qty, 1);
});

test('unknown item id is rejected', () => {
  const t = computeTotals({ items: [{ id: 'nope', qty: 1 }], fulfillment: 'collection' }, config);
  assert.equal(t.ok, false);
  assert.match(t.reason, /Unknown item/);
});

test('empty cart is rejected even though the service fee is positive', () => {
  const t = computeTotals({ items: [], fulfillment: 'collection' }, config);
  assert.equal(t.ok, false);
  assert.match(t.reason, /empty/i);
});

test('posOnly item is blocked online but allowed when opts.allowPosOnly', () => {
  const blocked = computeTotals({ items: [{ id: 'student', qty: 1 }], fulfillment: 'collection' }, config);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /not available online/);
  const allowed = computeTotals({ items: [{ id: 'student', qty: 1 }], fulfillment: 'collection' }, config, { allowPosOnly: true });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.subtotalP, 500);
});

test('custom line rejected unless opts.allowCustom, then priced from staff-entered pence', () => {
  const blocked = computeTotals({ items: [{ custom: true, name: 'X', priceP: 999, qty: 1 }], fulfillment: 'collection' }, config);
  assert.equal(blocked.ok, false);
  const allowed = computeTotals({ items: [{ custom: true, name: 'X', priceP: 999, qty: 2 }], fulfillment: 'collection' }, config, { allowCustom: true });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.lines[0].lineTotalP, 1998);
});

test('delivery fee: passed-in fee wins; NaN/negative falls back to outcode lookup', () => {
  const passed = computeTotals({ items: [{ id: 'burger', qty: 2 }], fulfillment: 'delivery', deliveryAddress: { postcode: 'YO2 3AB' } }, config, { deliveryFeeP: 250 });
  assert.equal(passed.deliveryFeeP, 250);
  const badFallback = computeTotals({ items: [{ id: 'burger', qty: 2 }], fulfillment: 'delivery', deliveryAddress: { postcode: 'YO2 3AB' } }, config, { deliveryFeeP: NaN });
  assert.equal(badFallback.deliveryFeeP, 250);    // feeByOutcode.YO2
  const defaultFee = computeTotals({ items: [{ id: 'burger', qty: 2 }], fulfillment: 'delivery', deliveryAddress: { postcode: 'YO1 1AA' } }, config, { deliveryFeeP: -5 });
  assert.equal(defaultFee.deliveryFeeP, 200);     // default feePence (YO1 has no override)
});

test('delivery below minimum (net of discount) is rejected', () => {
  const t = computeTotals({ items: [{ id: 'coke', qty: 1 }], fulfillment: 'delivery', deliveryAddress: { postcode: 'YO1 1AA' } }, config, { deliveryFeeP: 200 });
  assert.equal(t.ok, false);                       // 150 - 15 = 135 < 1200
  assert.match(t.reason, /[Mm]inimum/);
});

test('counter opts suppress promo and service fee', () => {
  const t = computeTotals({ items: [{ id: 'burger', qty: 1 }], fulfillment: 'collection' }, config, { suppressPromo: true, suppressServiceFee: true });
  assert.equal(t.discountP, 0);
  assert.equal(t.serviceFeeP, 0);
  assert.equal(t.totalP, 800);
});

test('meal choice outside its allowed group is not recorded', () => {
  // 'coke' is in category 'drinks', not the meal's 'sides' group → ignored.
  const t = computeTotals({ items: [{ id: 'burger', qty: 1, meal: true, modifiers: [], mealChoices: ['coke'] }], fulfillment: 'collection' }, config);
  assert.deepEqual(t.lines[0].mealChoices, []);
});

test('notes and spice are captured and length-capped', () => {
  const t = computeTotals({ items: [{ id: 'coke', qty: 1, notes: ' hi '.repeat(60), spice: 'x'.repeat(60) }], fulfillment: 'collection' }, config);
  assert.ok(t.lines[0].notes.length <= 140);
  assert.equal(t.lines[0].spice.length, 40);
});

test('control characters are stripped from notes, spice and custom names', () => {
  const hasCtl = (s) => [...(s || '')].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  const ctl = String.fromCharCode(0) + String.fromCharCode(27) + String.fromCharCode(29) + String.fromCharCode(127); // NUL ESC GS DEL
  const t = computeTotals({
    items: [{ id: 'coke', qty: 1, notes: 'no' + ctl + 'onions', spice: ctl + 'hot' }],
    fulfillment: 'collection',
  }, config);
  assert.ok(!hasCtl(t.lines[0].notes), 'notes stripped');
  assert.ok(!hasCtl(t.lines[0].spice), 'spice stripped');
  const c = computeTotals({
    items: [{ custom: true, name: 'Special' + ctl + 'item', priceP: 500, qty: 1 }],
    fulfillment: 'collection',
  }, config, { allowCustom: true });
  assert.ok(!hasCtl(c.lines[0].name), 'custom name stripped');
});

/* ---- autoOnlineDiscount minimum spend (promo.autoOnlineDiscount.minSubtotalPence) ----
   Acomb Pizza & Kebab runs "10% off online orders over £12", so the standing
   discount had to grow an optional floor. The fixture config has no
   minSubtotalPence, so these build one on top of it — which also proves the
   default (absent ⇒ no floor) is what every other shop still gets, since the
   tests above pass unchanged. */
const withMin = (minSubtotalPence) => ({
  ...config,
  promo: { ...config.promo, autoOnlineDiscount: { ...config.promo.autoOnlineDiscount, minSubtotalPence } },
});
const subtotalOf = (qty, cfg) =>
  computeTotals({ items: [{ id: 'burger', qty }], fulfillment: 'collection' }, cfg);

test('minSubtotalPence: the discount is withheld below the floor and applied at it', () => {
  // burger is 800p, so qty 1 = 800 (below a 1200 floor) and qty 2 = 1600 (above).
  const below = subtotalOf(1, withMin(1200));
  assert.equal(below.subtotalP, 800);
  assert.equal(below.discountP, 0);
  assert.equal(below.discountLabel, null, 'no label when nothing was discounted');

  const above = subtotalOf(2, withMin(1200));
  assert.equal(above.subtotalP, 1600);
  assert.equal(above.discountP, 160);
});

test('minSubtotalPence is inclusive: a subtotal exactly on the floor qualifies', () => {
  // Exactly 1600 against a 1600 floor — the boundary a ">" would silently fail,
  // and the one a customer hits when they build a basket to the advertised
  // number on the nose.
  const t = subtotalOf(2, withMin(1600));
  assert.equal(t.subtotalP, 1600);
  assert.equal(t.discountP, 160);
});

test('minSubtotalPence is tested on the subtotal, not the total (fees do not lift a basket over)', () => {
  // Floor 850 against an 800 subtotal: below on the subtotal, ABOVE once the
  // 100p service fee is added. The customer is promised a discount against the
  // menu prices, so the fee must not drag a sub-floor basket into the offer.
  const t = subtotalOf(1, withMin(850));
  assert.equal(t.subtotalP, 800);
  assert.ok(t.subtotalP + t.serviceFeeP > 850, 'the fee alone would clear the floor');
  assert.equal(t.discountP, 0);
});

test('minSubtotalPence absent or zero keeps the discount unconditional', () => {
  for (const cfg of [config, withMin(0)]) {
    const t = subtotalOf(1, cfg);
    assert.equal(t.subtotalP, 800);
    assert.equal(t.discountP, 80);
  }
});

test('a counter sale never gets the discount, floor or no floor', () => {
  const t = computeTotals({ items: [{ id: 'burger', qty: 4 }], fulfillment: 'collection' },
    withMin(1200), { suppressPromo: true });
  assert.equal(t.subtotalP, 3200);
  assert.equal(t.discountP, 0);
});
