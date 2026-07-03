/* functions/_lib/stripe.js — verifyWebhook signature checking, incl. the
   multi-v1 (secret-rotation) case. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook } from '../functions/_lib/stripe.js';

const secret = 'whsec_test_secret';
const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
const sign = (t, s = secret) => createHmac('sha256', s).update(`${t}.${body}`).digest('hex');
const env = { STRIPE_WEBHOOK_SECRET: secret };

test('accepts a valid single-signature header', async () => {
  const t = Math.floor(Date.now() / 1000);
  const ev = await verifyWebhook(body, `t=${t},v1=${sign(t)}`, env);
  assert.ok(ev && ev.id === 'evt_1');
});

test('accepts when our signature is NOT the last v1 (the rotation case)', async () => {
  const t = Math.floor(Date.now() / 1000);
  // Old code kept only the last v1 and would reject this — our secret matches the first.
  assert.ok(await verifyWebhook(body, `t=${t},v1=${sign(t)},v1=deadbeef`, env));
  // …and the reverse ordering.
  assert.ok(await verifyWebhook(body, `t=${t},v1=deadbeef,v1=${sign(t)}`, env));
});

test('rejects a wrong signature', async () => {
  const t = Math.floor(Date.now() / 1000);
  assert.equal(await verifyWebhook(body, `t=${t},v1=deadbeef`, env), null);
  assert.equal(await verifyWebhook(body, `t=${t},v1=${sign(t, 'other_secret')}`, env), null);
});

test('rejects a stale timestamp (>5min) and a missing secret', async () => {
  const old = Math.floor(Date.now() / 1000) - 1000;
  assert.equal(await verifyWebhook(body, `t=${old},v1=${sign(old)}`, env), null);
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifyWebhook(body, `t=${now},v1=${sign(now)}`, {}), null);
});

test('rejects a malformed header', async () => {
  assert.equal(await verifyWebhook(body, 'garbage', env), null);
  assert.equal(await verifyWebhook(body, '', env), null);
});
