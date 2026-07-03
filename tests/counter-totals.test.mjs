/* functions/_lib/counter-totals.js — priceCounterSale + cardFeeP. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../functions/_lib/config.js';
import { priceCounterSale, cardFeeP } from '../functions/_lib/counter-totals.js';

const config = getConfig();

test('priceCounterSale suppresses promo + service fee (walk-in)', async () => {
  const r = await priceCounterSale({ items: [{ id: 'burger', qty: 1 }], mode: 'walkin' }, config);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'walkin');
  assert.equal(r.fulfillment, 'collection');
  assert.equal(r.totals.discountP, 0);
  assert.equal(r.totals.serviceFeeP, 0);
  assert.equal(r.totals.totalP, 800);          // plain menu price, no fee/promo
});

test('priceCounterSale rejects an empty cart', async () => {
  const r = await priceCounterSale({ items: [], mode: 'walkin' }, config);
  assert.equal(r.ok, false);
});

test('priceCounterSale delivery requires an address', async () => {
  // YO2 9AB: outcode YO2 is allowed (250p) and not block-listed, so resolveDelivery
  // passes and we reach the missing-line1 check.
  const r = await priceCounterSale({ items: [{ id: 'burger', qty: 1 }], mode: 'delivery', address: { postcode: 'YO2 9AB' } }, config);
  assert.equal(r.ok, false);
  assert.match(r.error, /address/i);
});

test('cardFeeP: default flat 10p; flat override; bps+flat combine', () => {
  assert.equal(cardFeeP(1000, config), 10);                                   // fixtures set no card fee → default 10p flat
  assert.equal(cardFeeP(1000, { payments: { cardPlatformFeeP: 20 } }), 20);   // flat override, no bps
  // bps set but flat unset → fixedP defaults to 10; pct = round(1000*150/10000)=15 → 25.
  assert.equal(cardFeeP(1000, { payments: { cardFeeBps: 150 } }), 25);
  // explicit flat 0 + bps → just the bps slice.
  assert.equal(cardFeeP(1000, { payments: { cardFeeBps: 150, cardPlatformFeeP: 0 } }), 15);
});
