/* Delivery validity + fee resolution, supporting three per-shop modes:

   - "outcode" (default): the existing model — postcode outcode must be in
     allowedOutcodes; fee is feeByOutcode[outcode] or the default feePence.
   - "radius": distance bands from the shop. The customer postcode is geocoded
     (postcodes.io, free) and the distance from the shop origin selects a band
     fee. By default that's straight-line (crow-flies) miles, but a per-shop
     radius.roadFactor (e.g. 1.3) scales it up to approximate real driving
     distance, since a road route is rarely a straight line. Beyond the largest
     band = no delivery.
   - "zones": arbitrary map polygons, each with its own fee. The customer
     postcode is geocoded and tested against each polygon in order; the first
     one that contains it sets the fee, and no match means no delivery.

   Why zones exists: shops arrive already running a delivery map drawn by hand
   on their previous provider, and those shapes are not rings. Acomb Pizza &
   Kebab's are a good example — the free zone covers Acomb, two different
   directions both charge £1.50 at different distances, and the dearest zone
   reaches north-east well past where the free zone reaches south. A radius
   can approximate that but will always take streets the shop refuses and
   refuse streets it takes; outcodes can't even express it, because YO26 spans
   two of their zones. Polygons reproduce it exactly.

   Async because radius mode geocodes. Returns:
     { ok:true, postcode, feePence, distanceMiles? }
     { ok:false, reason, suggestCollection? }

   This is the single source of truth for the delivery fee, used by both
   /api/delivery-quote (live client quote) and /api/order (authoritative). */

import { normalisePostcode, validateDeliveryPostcode } from './postcode.js';
import { geocodePostcode, milesBetween } from './geocode.js';

/* Is a point inside a polygon? Ray casting: count how many edges a ray fired
   east from the point crosses — odd means inside. Handles concave shapes and
   the shapes drawn round a road or a river, which is exactly what a hand-drawn
   delivery map is. No dependency; this is the whole algorithm.

   `ring` is [[lat, lng], ...]. It does not need its last point to repeat the
   first — the modulo closes it. Points that land exactly ON an edge are
   decided by floating-point luck; that is acceptable here because a postcode
   is a centroid, not a doorstep, and the shop can nudge a boundary. */
export function pointInRing(lat, lng, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = Number(ring[i][0]), xi = Number(ring[i][1]);
    const yj = Number(ring[j][0]), xj = Number(ring[j][1]);
    if (!Number.isFinite(yi) || !Number.isFinite(xi) || !Number.isFinite(yj) || !Number.isFinite(xj)) continue;
    // Does this edge straddle the point's latitude, and is the crossing east of it?
    const straddles = (yi > lat) !== (yj > lat);
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export async function resolveDelivery(rawPostcode, config) {
  const d = config.fulfillment.delivery;
  const mode = d.mode || 'outcode';

  if (mode === 'zones') {
    const np = normalisePostcode(rawPostcode);
    if (!np) return { ok: false, reason: 'Please enter a valid UK postcode.' };

    const dest = await geocodePostcode(np.formatted);
    if (!dest) {
      return { ok: false, reason: "We couldn't check that postcode just now — please try again, or call the shop." };
    }

    // First match wins, so the list is ordered cheapest/innermost first by
    // convention — overlapping zones are normal on a hand-drawn map and this is
    // what decides them. Zones missing a polygon or a fee are skipped rather
    // than treated as free.
    const zones = (d.zones || []).filter(
      (z) => Array.isArray(z.polygon) && z.polygon.length >= 3 && Number.isFinite(Number(z.feePence)),
    );
    const hit = zones.find((z) => pointInRing(dest.lat, dest.lng, z.polygon));
    if (!hit) {
      return {
        ok: false,
        reason: `Sorry, ${np.formatted} is outside our delivery area. You can still collect.`,
        suggestCollection: true,
      };
    }
    return {
      ok: true,
      postcode: np.formatted,
      feePence: Number(hit.feePence),
      zoneName: hit.name || undefined,
    };
  }

  if (mode === 'radius') {
    const r = d.radius || {};
    const np = normalisePostcode(rawPostcode);
    if (!np) return { ok: false, reason: 'Please enter a valid UK postcode.' };

    const dest = await geocodePostcode(np.formatted);
    if (!dest) {
      return { ok: false, reason: "We couldn't check that postcode just now — please try again, or call the shop." };
    }

    // Origin: explicit coords if configured, else the shop's own postcode.
    const origin = (r.origin && typeof r.origin.lat === 'number')
      ? r.origin
      : await geocodePostcode(config.business?.address?.postcode);
    if (!origin) {
      return { ok: false, reason: "Delivery isn't available right now — please choose collection or call the shop." };
    }

    // Estimate driving distance: straight-line × a road/circuity factor (a real
    // route between two points is rarely a straight line). roadFactor defaults to
    // 1 (pure straight-line, so other shops are unaffected); set it per shop
    // (~1.3 for typical UK roads) to approximate actual driving miles. The bands'
    // maxMiles are then read as driving miles, matching what a customer sees on
    // a sat-nav rather than crow-flies.
    const factor = Number(r.roadFactor) > 0 ? Number(r.roadFactor) : 1;
    const miles = milesBetween(origin, dest) * factor;
    const bands = (r.bands || [])
      .filter((b) => Number.isFinite(Number(b.maxMiles)) && Number.isFinite(Number(b.feePence)))
      .sort((a, b) => Number(a.maxMiles) - Number(b.maxMiles));
    const band = bands.find((b) => miles <= Number(b.maxMiles) + 1e-9);
    if (!band) {
      const max = r.maxMiles || (bands.length ? Number(bands[bands.length - 1].maxMiles) : 0);
      return {
        ok: false,
        reason: `Sorry, ${np.formatted} is outside our delivery area (within ${max} miles). You can still collect.`,
        suggestCollection: true,
      };
    }
    return {
      ok: true,
      postcode: np.formatted,
      feePence: Number(band.feePence),
      distanceMiles: Math.round(miles * 10) / 10,
    };
  }

  // Default: outcode allow-list, minus any blocked too-far prefixes.
  const v = validateDeliveryPostcode(rawPostcode, d.allowedOutcodes, d.areaDescription, d.blockedPrefixes);
  if (!v.ok) return v;
  const override = d.feeByOutcode?.[v.outcode];
  const feePence = Number.isFinite(override) ? override : d.feePence;

  // Optional hard distance cap ON TOP of outcode pricing. Some outcodes sprawl
  // well past the delivery radius (e.g. YO26 reaches 6–7 miles), so even a priced,
  // allowed outcode is refused beyond maxMiles ROAD miles (straight-line × roadFactor).
  // Only runs when d.maxMiles is set; fail-open if geocoding is momentarily down —
  // the outcode allow-list is still the primary gate.
  const maxMiles = Number(d.maxMiles) > 0 ? Number(d.maxMiles) : 0;
  if (maxMiles) {
    const dest = await geocodePostcode(v.postcode);
    const origin = (d.origin && typeof d.origin.lat === 'number')
      ? d.origin
      : await geocodePostcode(config.business?.address?.postcode);
    if (dest && origin) {
      const factor = Number(d.roadFactor) > 0 ? Number(d.roadFactor) : 1;
      const miles = milesBetween(origin, dest) * factor;
      if (miles > maxMiles + 1e-9) {
        return {
          ok: false,
          reason: `Sorry, ${v.postcode} is outside our delivery area (within ${maxMiles} miles). You can still collect.`,
          suggestCollection: true,
        };
      }
      return { ok: true, postcode: v.postcode, feePence, distanceMiles: Math.round(miles * 10) / 10 };
    }
  }

  return { ok: true, postcode: v.postcode, feePence };
}
