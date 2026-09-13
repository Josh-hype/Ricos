/* Mega Chippy's delivery pricing, against the config it actually ships.

   The shop prices by outcode and carries one owner-drawn polygon over the top:
   a pocket of south York charged £3.50 whatever outcode it falls in. Two
   things have to stay true and neither is obvious from reading the config:

     1. Inside the shape costs £3.50, and NOTHING else moved. The rest of the
        outcode the pocket sits in must still be its own price — that is the
        whole point of a carve-out, and it is the bit a careless edit breaks.
     2. The carve-out prices; it does not admit. allowedOutcodes and the 4-mile
        cap still decide whether the shop delivers at all.

   These read data/shops/mega-chippy/config.json directly rather than a
   fixture, so they fail if someone edits the shop's real prices. Geocoding is
   stubbed at fetch: functions/_lib/geocode.js caches per isolate, so every
   test uses its own postcode. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDelivery, pointInRing } from '../functions/_lib/delivery.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'data/shops/mega-chippy/config.json'), 'utf8'));
const d = config.fulfillment.delivery;
const zone = (d.feeOverrideZones || [])[0];

/* Gale Lane, Acomb — the shop. Only used to stand in for its geocode, so the
   distance cap behaves as it does in production. */
const SHOP = { lat: 53.9375, lng: -1.1247 };
const INSIDE = { lat: 53.9236, lng: -1.1023 };   // the polygon's centroid
const OUTSIDE = { lat: 53.9600, lng: -1.1000 };  // north of it, still near the shop

const withGeocode = (coords, fn) => async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pc = String(url).split('/').pop();
    const c = coords[pc];
    if (!c) return { ok: false };
    return { ok: true, json: async () => ({ status: 200, result: { latitude: c.lat, longitude: c.lng } }) };
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test('the shipped carve-out is one valid polygon priced at £3.50', () => {
  assert.ok(zone, 'mega-chippy must carry a feeOverrideZones entry');
  assert.equal(zone.feePence, 350);
  assert.ok(Array.isArray(zone.polygon) && zone.polygon.length >= 3);
  for (const [lat, lng] of zone.polygon) {
    assert.ok(Number.isFinite(lat) && Number.isFinite(lng), 'every vertex is a number');
    assert.ok(lat > 53.8 && lat < 54.1, `${lat} is in the York area`);
    assert.ok(lng > -1.3 && lng < -0.9, `${lng} is in the York area`);
  }
  assert.ok(pointInRing(INSIDE.lat, INSIDE.lng, zone.polygon), 'its own centroid is inside it');
  assert.ok(!pointInRing(OUTSIDE.lat, OUTSIDE.lng, zone.polygon), 'a point north of it is not');
});

test('inside the pocket costs £3.50, whichever outcode it is', withGeocode(
  { YO239AA: INSIDE, YO243AQ: SHOP }, async () => {
    const r = await resolveDelivery('YO23 9AA', config);
    assert.equal(r.ok, true);
    assert.equal(r.feePence, 350);
    assert.equal(r.zoneName, 'South York');
  }));

test('the same outcode OUTSIDE the pocket keeps its own price', withGeocode(
  { YO239BB: OUTSIDE, YO243AQ: SHOP }, async () => {
    const r = await resolveDelivery('YO23 9BB', config);
    assert.equal(r.ok, true);
    assert.equal(r.feePence, d.feeByOutcode.YO23, 'YO23 is still YO23 outside the shape');
    assert.equal(r.zoneName, undefined);
  }));

test('the shop’s own outcode outside the pocket is unchanged', withGeocode(
  { YO249CC: OUTSIDE, YO243AQ: SHOP }, async () => {
    const r = await resolveDelivery('YO24 9CC', config);
    assert.equal(r.ok, true);
    assert.equal(r.feePence, d.feeByOutcode.YO24);
  }));

test('an outcode the shop does not serve is still refused inside the pocket', withGeocode(
  { LS19DD: INSIDE, YO243AQ: SHOP }, async () => {
    const r = await resolveDelivery('LS1 9DD', config);
    assert.equal(r.ok, false, 'the allow-list decides, not the polygon');
  }));

test('the owner-agreed outcode prices are exactly as before', () => {
  /* The regression guard. If a future edit to the carve-out disturbs any of
     these, this is the test that says so. Figures are the ones recorded in the
     config's own _comment: YO24 £2, YO26 £2.50, YO23 £2.50, YO30 £3.50,
     YO1 £3.50, YO10 £6, YO31 £6. */
  assert.deepEqual(d.feeByOutcode, {
    YO24: 200, YO26: 250, YO23: 250, YO30: 350, YO1: 350, YO10: 600, YO31: 600,
  });
  assert.deepEqual(d.allowedOutcodes, ['YO24', 'YO26', 'YO23', 'YO30', 'YO1', 'YO10', 'YO31']);
  assert.equal(d.mode, 'outcode');
  assert.equal(d.minimumOrderPence, 1700);
  assert.equal(d.maxMiles, 4);
  assert.equal(d.roadFactor, 1.3);
  assert.equal(d.feePence, 600);
});
