/* A negative option delta — "No chips" takes £2.50 off a burger that comes with
   chips. Run: node --import ./tests/support/register.mjs --test tests/

   Real money leaving the till, and three separate layers could silently swallow
   it. Each of these asserts one of them, because the failure mode in every case
   is the customer being SHOWN -£2.50 and CHARGED the full price:

     computeTotals   sums deltas with no clamp, so it works — but a line must
                     never be able to go negative and eat the rest of the basket
     validateUnified rejected any price below zero, which would have refused
                     EVERY back-office menu save while such a choice existed
     both UIs        printed "+£-2.50" from `'+£' + (d/100).toFixed(2)` */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals } from '../functions/_lib/totals.js';
import { getConfig } from '../functions/_lib/config.js';
import {
  unifyStatic, validateUnified, deriveServerMenu, deriveVisualMenu,
} from '../functions/_lib/menu-store.js';

const SERVER = [{
  id: 'burgers', name: 'Burgers',
  items: [{
    id: 'beef-burger', name: 'Beef Burger', priceP: 600,
    modifiers: [
      { id: 'chips', label: 'Chips', priceDeltaP: 0 },
      { id: 'chips-cheese', label: 'CHIPS WITH CHEESE', priceDeltaP: 150 },
      { id: 'no-chips', label: 'No chips', priceDeltaP: -250 },
    ],
  }],
}];
const VISUAL = [{
  id: 'burgers', name: 'Burgers',
  items: [{
    id: 'beef-burger', name: 'Beef Burger', price: 6,
    options: [{
      id: 'chips', label: 'Chips', select: 'single', required: true,
      choices: [
        { id: 'chips', label: 'Chips', price: 0, default: true },
        { id: 'chips-cheese', label: 'CHIPS WITH CHEESE', price: 1.5 },
        { id: 'no-chips', label: 'No chips', price: -2.5 },
      ],
    }],
  }],
}];

const sub = (modifiers, qty = 1) => {
  const t = computeTotals(
    { items: [{ id: 'beef-burger', qty, modifiers }], fulfillment: 'collection' },
    getConfig(), { menu: SERVER });
  assert.equal(t.ok, true, t.reason);
  return t.subtotalP;
};

test('the deduction actually comes off', () => {
  assert.equal(sub(['chips']), 600);
  assert.equal(sub(['chips-cheese']), 750);
  assert.equal(sub(['no-chips']), 350);          // £6.00 - £2.50
});

test('quantity multiplies the discounted line, not the base', () => {
  assert.equal(sub(['no-chips'], 3), 1050);      // 3 x £3.50
});

test('a crafted request cannot stack the deduction', () => {
  // modIds is de-duplicated, so repeating it is worth nothing.
  assert.equal(sub(['no-chips', 'no-chips', 'no-chips', 'no-chips']), 350);
});

test('a line can never go negative and eat the rest of the basket', () => {
  // A cheap item carrying a deduction bigger than its price. Without the floor
  // in computeTotals this line would be -£1.50 and would quietly subtract from
  // the other items' revenue.
  const menu = [{
    id: 'x', name: 'X',
    items: [
      { id: 'cheap', name: 'Pitta', priceP: 100, modifiers: [{ id: 'off', label: 'Off', priceDeltaP: -250 }] },
      { id: 'normal', name: 'Normal', priceP: 1000 },
    ],
  }];
  const t = computeTotals({
    items: [{ id: 'cheap', qty: 1, modifiers: ['off'] }, { id: 'normal', qty: 1 }],
    fulfillment: 'collection',
  }, getConfig(), { menu });
  assert.equal(t.ok, true, t.reason);
  assert.equal(t.subtotalP, 1000, 'the negative line must floor at £0, not reduce the other line');
});

test('the back office can still SAVE a menu containing a negative choice', () => {
  // The blocker: validateUnified used one validator for item prices and choice
  // deltas, and it rejected anything below zero. One "No chips" choice would
  // have made every menu edit fail — on a screen showing an error about an
  // option the owner may not even have been looking at.
  const v = validateUnified(unifyStatic(SERVER, VISUAL));
  assert.equal(v.ok, true, 'save refused: ' + JSON.stringify(v.errors));

  const choice = (menu, key) => menu
    .flatMap((c) => c.items).find((i) => i.id === 'beef-burger')[key];
  const mod = choice(deriveServerMenu(v.doc), 'modifiers').find((m) => m.id === 'no-chips');
  assert.equal(mod.priceDeltaP, -250, 'the deduction was clamped on the way through the editor');
  const vis = choice(deriveVisualMenu(v.doc), 'options')[0].choices.find((c) => c.id === 'no-chips');
  assert.equal(vis.price, -2.5);
  // ...and the item's own price is still not allowed to be negative.
  const bad = validateUnified({
    categories: [{ id: 'c', name: 'C', items: [{ id: 'i', name: 'I', priceP: -100 }] }],
  });
  assert.equal(bad.ok, false, 'a negative ITEM price must still be rejected');
});

test('what the two surfaces charge cannot diverge', () => {
  // The visual price is display-only; menu.json is what the customer pays. The
  // build fails on a mismatch in the static files — this is the same check for a
  // doc that has been through the editor.
  const doc = validateUnified(unifyStatic(SERVER, VISUAL)).doc;
  const srv = deriveServerMenu(doc).flatMap((c) => c.items)[0].modifiers;
  const vis = deriveVisualMenu(doc).flatMap((c) => c.items)[0].options[0].choices;
  for (const c of vis) {
    const m = srv.find((x) => x.id === c.id);
    assert.equal(Math.round(c.price * 100), m.priceDeltaP,
      `${c.label}: shown £${c.price} but charged ${m.priceDeltaP}p`);
  }
});
