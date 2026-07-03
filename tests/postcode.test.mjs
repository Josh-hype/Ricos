/* functions/_lib/postcode.js — normalisation + outcode allow-list + block-list. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePostcode, isOutcodeAllowed, validateDeliveryPostcode } from '../functions/_lib/postcode.js';

test('normalisePostcode splits outcode/incode and formats, or returns null', () => {
  assert.deepEqual(normalisePostcode('yo241az'), { outcode: 'YO24', incode: '1AZ', formatted: 'YO24 1AZ' });
  assert.deepEqual(normalisePostcode('SW1A 1AA'), { outcode: 'SW1A', incode: '1AA', formatted: 'SW1A 1AA' });
  assert.equal(normalisePostcode('not a postcode'), null);
  assert.equal(normalisePostcode(''), null);
  assert.equal(normalisePostcode(null), null);
});

test('isOutcodeAllowed is case-insensitive and guards a non-array allow-list', () => {
  assert.equal(isOutcodeAllowed('YO1', ['YO1', 'YO2']), true);
  assert.equal(isOutcodeAllowed('yo1', ['YO1']), true);
  assert.equal(isOutcodeAllowed('YO9', ['YO1']), false);
  assert.equal(isOutcodeAllowed('YO1', undefined), false);   // must not throw
});

test('validateDeliveryPostcode: allowed, disallowed, and block-list prefix', () => {
  const ok = validateDeliveryPostcode('YO1 1AA', ['YO1'], 'in York', []);
  assert.equal(ok.ok, true);
  assert.equal(ok.outcode, 'YO1');

  const out = validateDeliveryPostcode('YO9 9ZZ', ['YO1'], 'in York', []);
  assert.equal(out.ok, false);

  const blocked = validateDeliveryPostcode('YO23 3PS', ['YO23'], 'in York', ['YO233']);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.suggestCollection, true);

  const invalid = validateDeliveryPostcode('xyz', ['YO1']);
  assert.equal(invalid.ok, false);
});
