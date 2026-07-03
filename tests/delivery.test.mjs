/* functions/_lib/delivery.js — outcode-mode fee resolution + haversine.
   Radius mode geocodes over the network (postcodes.io) so it isn't unit-tested
   here; milesBetween (its pure core) is. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDelivery } from '../functions/_lib/delivery.js';
import { milesBetween } from '../functions/_lib/geocode.js';

const cfg = (delivery) => ({ fulfillment: { delivery }, business: { address: { postcode: 'YO1 1AA' } } });

test('outcode mode: per-outcode override, else default feePence', async () => {
  const c = cfg({ mode: 'outcode', feePence: 200, feeByOutcode: { YO2: 250 }, allowedOutcodes: ['YO1', 'YO2'], areaDescription: 'in York' });
  const yo2 = await resolveDelivery('YO2 3AB', c);
  assert.equal(yo2.ok, true);
  assert.equal(yo2.feePence, 250);
  assert.equal(yo2.postcode, 'YO2 3AB');

  const yo1 = await resolveDelivery('YO1 1AA', c);
  assert.equal(yo1.ok, true);
  assert.equal(yo1.feePence, 200);
});

test('outcode mode: postcode outside the allow-list is refused', async () => {
  const c = cfg({ mode: 'outcode', feePence: 200, allowedOutcodes: ['YO1'], areaDescription: 'in York' });
  const r = await resolveDelivery('LS1 1AA', c);
  assert.equal(r.ok, false);
});

test('outcode mode defaults when mode is unset', async () => {
  const c = cfg({ feePence: 300, allowedOutcodes: ['YO1'] });
  const r = await resolveDelivery('YO1 2BB', c);
  assert.equal(r.ok, true);
  assert.equal(r.feePence, 300);
});

test('milesBetween is ~0 for identical points and correct for a known pair', () => {
  const york = { lat: 53.9600, lng: -1.0873 };
  assert.ok(milesBetween(york, york) < 1e-6);
  const leeds = { lat: 53.8008, lng: -1.5491 };
  const d = milesBetween(york, leeds);
  assert.ok(d > 18 && d < 22, `expected ~20mi, got ${d}`);   // York↔Leeds ≈ 20mi crow-flies
});
