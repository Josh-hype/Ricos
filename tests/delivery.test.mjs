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

/* ---- zones mode: the point-in-polygon test ----------------------------------
   resolveDelivery's zones branch geocodes over the network, so as with radius
   it isn't unit-tested here. pointInRing is where the actual logic is, and it
   is pure, so it gets tested properly. The concave cases matter most: a
   hand-drawn delivery map is never a convex blob — it follows a ring road and
   stops at a river — and a bounding-box shortcut would pass a square and fail
   every real shape. */
import { pointInRing } from '../functions/_lib/delivery.js';

const SQUARE = [[0, 0], [0, 10], [10, 10], [10, 0]];          // lat,lng
// A U: the notch is the gap between the two prongs, inside the bounding box
// but firmly outside the shape.
const U_SHAPE = [[0, 0], [10, 0], [10, 4], [3, 4], [3, 6], [10, 6], [10, 10], [0, 10]];

test('zones: a point inside a simple polygon is inside', () => {
  assert.equal(pointInRing(5, 5, SQUARE), true);
});

test('zones: a point outside a simple polygon is outside', () => {
  assert.equal(pointInRing(15, 5, SQUARE), false);
  assert.equal(pointInRing(5, -1, SQUARE), false);
});

test('zones: concave shape — the notch is OUTSIDE despite being in the bounding box', () => {
  assert.equal(pointInRing(6, 5, U_SHAPE), false, 'the gap between the prongs is not deliverable');
  assert.equal(pointInRing(1, 5, U_SHAPE), true, 'the base of the U is');
  assert.equal(pointInRing(6, 2, U_SHAPE), true, 'the left prong is');
  assert.equal(pointInRing(6, 8, U_SHAPE), true, 'the right prong is');
});

test('zones: closing the ring explicitly changes nothing', () => {
  const closed = [...SQUARE, [0, 0]];
  for (const [lat, lng] of [[5, 5], [15, 5], [0.001, 0.001]]) {
    assert.equal(pointInRing(lat, lng, closed), pointInRing(lat, lng, SQUARE));
  }
});

test('zones: a degenerate ring is never inside, and never throws', () => {
  assert.equal(pointInRing(5, 5, []), false);
  assert.equal(pointInRing(5, 5, [[0, 0], [1, 1]]), false);
  assert.equal(pointInRing(5, 5, null), false);
  assert.equal(pointInRing(5, 5, undefined), false);
});

test('zones: malformed vertices are skipped rather than crashing', () => {
  const dirty = [[0, 0], ['x', null], [0, 10], [10, 10], [10, 0]];
  assert.equal(typeof pointInRing(5, 5, dirty), 'boolean');
});

test('zones: realistic York shape — Acomb in, Huntington out', () => {
  // A rough lozenge over Acomb/west York. Not the shop's real zone; it exists
  // to prove real lat/lng magnitudes and sign work, since a ray-casting bug
  // often only shows up away from the origin.
  const acombish = [[53.945, -1.135], [53.965, -1.120], [53.960, -1.075], [53.938, -1.070], [53.930, -1.110]];
  assert.equal(pointInRing(53.949, -1.105, acombish), true,  'Acomb is inside');
  assert.equal(pointInRing(53.995, -1.050, acombish), false, 'Huntington is outside');
});
