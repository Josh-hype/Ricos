/* functions/_lib/totals.js — items held out of percentage promos.

   A meal deal is already a discount: the shop has priced a bundle below the sum
   of its parts. Taking a welcome offer off it again sells it under what the
   parts cost, and the bigger the deal the worse the loss. So an item can carry
   noPromo, and the percentage is then taken on the rest of the basket only.

   The failure these lock down is not "the number is wrong" but "the two numbers
   disagree": the cart preview computes the discount from menu-visual.json and
   computeTotals computes it from menu.json. If those drift, the customer is
   quoted one price and charged another. build-shop.js fails the build on a
   mismatch; these tests fix the server half of the contract.

   The fixture menu carries "mealdeal" (£20, noPromo) alongside ordinary items,
   and the fixture config runs a standing 10% online discount. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../functions/_lib/config.js';
import { computeTotals } from '../functions/_lib/totals.js';

const config = getConfig();
const order = (items, opts = {}) =>
  computeTotals({ items, fulfillment: 'collection' }, config, opts);

test('a flagged item earns no discount at all', () => {
  const t = order([{ id: 'mealdeal', qty: 1 }]);
  assert.equal(t.ok, true);
  assert.equal(t.subtotalP, 2000);
  assert.equal(t.discountP, 0, 'a basket of nothing but deals is not discountable');
});

test('and no discount line is labelled when nothing was taken off', () => {
  const t = order([{ id: 'mealdeal', qty: 1 }]);
  assert.equal(t.discountLabel, null,
    'a "10% off online" label beside a £0.00 discount reads as a bug to the customer');
});

test('an unflagged item still gets the discount', () => {
  const t = order([{ id: 'fries', qty: 1 }]);
  assert.equal(t.subtotalP, 300);
  assert.equal(t.discountP, 30);
});

test('a mixed basket discounts only the part that is not a deal', () => {
  /* The case that actually happens: someone adds the family deal AND a couple
     of sides. The sides are full price, so they discount; the deal does not. */
  const t = order([{ id: 'mealdeal', qty: 1 }, { id: 'fries', qty: 2 }]);
  assert.equal(t.subtotalP, 2000 + 600);
  assert.equal(t.discountP, 60, '10% of the £6 of fries, not of the £26 basket');
  assert.equal(t.totalP, 2600 - 60 + config.serviceFeePence);
});

test('quantity is respected in the exempt half', () => {
  const t = order([{ id: 'mealdeal', qty: 3 }, { id: 'coke', qty: 1 }]);
  assert.equal(t.subtotalP, 6000 + 150);
  assert.equal(t.discountP, 15, 'three deals are still three deals');
});

test('the first-order welcome offer is held off deals too', () => {
  /* The one the shop asked about. It is the bigger offer — 15% and up — so it
     is the one that hurts most on a bundle. */
  const t = order([{ id: 'mealdeal', qty: 1 }, { id: 'fries', qty: 1 }],
    { firstOrderDiscount: { percent: 25, label: '25% off your first order' } });
  assert.equal(t.subtotalP, 2300);
  assert.equal(t.discountP, 75, '25% of the £3 side, not of the £23 basket');
  assert.equal(t.discountLabel, '25% off your first order');
});

test('a deals-only basket kills the welcome offer label as well', () => {
  const t = order([{ id: 'mealdeal', qty: 1 }],
    { firstOrderDiscount: { percent: 25, label: '25% off your first order' } });
  assert.equal(t.discountP, 0);
  assert.equal(t.discountLabel, null);
});

test('the minimum-spend gate still reads the WHOLE subtotal', () => {
  /* Deliberate: the threshold is the number the customer sees against the menu
     prices. A £26 basket that looks like it clears a £12 minimum must clear it,
     even though only £6 of it is discountable — otherwise the offer reads as
     broken from both sides of the counter. */
  const gated = {
    ...config,
    promo: { autoOnlineDiscount: { enabled: true, percent: 10, minSubtotalPence: 1200, label: '10% off over £12' } },
  };
  const t = computeTotals(
    { items: [{ id: 'mealdeal', qty: 1 }, { id: 'fries', qty: 2 }], fulfillment: 'collection' },
    gated);
  assert.equal(t.subtotalP, 2600);
  assert.equal(t.discountP, 60, 'gate cleared on £26, percentage taken on the £6');
});

test('a counter sale is unaffected — it opts out of promos entirely', () => {
  const t = order([{ id: 'mealdeal', qty: 1 }, { id: 'fries', qty: 1 }], { suppressPromo: true });
  assert.equal(t.discountP, 0);
  assert.equal(t.subtotalP, 2300);
});

test('an unflagged basket is charged exactly as before the flag existed', () => {
  /* The regression guard for every other shop: no item of theirs carries
     noPromo, so nothing about their pricing may move. */
  const t = order([{ id: 'burger', qty: 1, meal: true, mealChoices: ['fries'] }, { id: 'coke', qty: 2 }]);
  assert.equal(t.subtotalP, 1100 + 300);
  assert.equal(t.discountP, 140);
});
