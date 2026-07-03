/* Money ledger — pure functions in functions/_lib/kv.js:
   recordRefund / refundedSoFar / paymentIntentMatchesOrder.
   Run: node --import ./tests/support/register.mjs --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordRefund, refundedSoFar, paymentIntentMatchesOrder } from '../functions/_lib/kv.js';

function order(totalP = 1000) {
  return { totals: { totalP }, payment: {}, history: [] };
}

test('refundedSoFar reads new refundedTotalP, legacy single refund, or 0', () => {
  assert.equal(refundedSoFar({ payment: { refundedTotalP: 250 } }), 250);
  assert.equal(refundedSoFar({ payment: { refund: { state: 'succeeded', amountP: 400 } } }), 400);
  assert.equal(refundedSoFar({ payment: {} }), 0);
  assert.equal(refundedSoFar(undefined), 0);
});

test('recordRefund accumulates partials and flips state to refunded at the total', () => {
  const o = order(1000);
  recordRefund(o, { amountP: 300, reason: 'a', stripeId: 're_1' });
  assert.equal(o.payment.refundedTotalP, 300);
  assert.equal(o.payment.state, 'partly_refunded');
  recordRefund(o, { amountP: 700, reason: 'b', stripeId: 're_2' });
  assert.equal(o.payment.refundedTotalP, 1000);
  assert.equal(o.payment.state, 'refunded');
  assert.equal(o.payment.refunds.length, 2);
  assert.equal(o.history.filter(h => h.event === 'refund').length, 2);
});

test('recordRefund is idempotent on a repeated Stripe refund id', () => {
  const o = order(1000);
  recordRefund(o, { amountP: 300, stripeId: 're_dup' });
  recordRefund(o, { amountP: 300, stripeId: 're_dup' });   // replay / re-read race
  assert.equal(o.payment.refundedTotalP, 300);
  assert.equal(o.payment.refunds.length, 1);
});

test('paymentIntentMatchesOrder enforces id, currency and amount cover', () => {
  const o = order(1000);
  o.payment.intentId = 'pi_1';
  assert.equal(paymentIntentMatchesOrder({ id: 'pi_1', currency: 'gbp', amount_received: 1000 }, o), true);
  assert.equal(paymentIntentMatchesOrder({ id: 'pi_1', currency: 'gbp', amount_received: 1200 }, o), true);
  assert.equal(paymentIntentMatchesOrder({ id: 'pi_OTHER', currency: 'gbp', amount_received: 1000 }, o), false);
  assert.equal(paymentIntentMatchesOrder({ id: 'pi_1', currency: 'usd', amount_received: 1000 }, o), false);
  assert.equal(paymentIntentMatchesOrder({ id: 'pi_1', currency: 'gbp', amount_received: 999 }, o), false);
});

test('paymentIntentMatchesOrder falls back to pi.amount when amount_received absent', () => {
  const o = order(500);
  o.payment.intentId = 'pi_2';
  assert.equal(paymentIntentMatchesOrder({ id: 'pi_2', currency: 'gbp', amount: 500 }, o), true);
});
