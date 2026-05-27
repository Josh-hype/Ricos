/* Delivery validity + fee resolution, supporting two per-shop modes:

   - "outcode" (default): the existing model — postcode outcode must be in
     allowedOutcodes; fee is feeByOutcode[outcode] or the default feePence.
   - "radius": distance bands from the shop. The customer postcode is geocoded
     (postcodes.io, free) and the straight-line distance from the shop origin
     selects a band fee. Beyond the largest band = no delivery.

   Async because radius mode geocodes. Returns:
     { ok:true, postcode, feePence, distanceMiles? }
     { ok:false, reason, suggestCollection? }

   This is the single source of truth for the delivery fee, used by both
   /api/delivery-quote (live client quote) and /api/order (authoritative). */

import { normalisePostcode, validateDeliveryPostcode } from './postcode.js';
import { geocodePostcode, milesBetween } from './geocode.js';

export async function resolveDelivery(rawPostcode, config) {
  const d = config.fulfillment.delivery;
  const mode = d.mode || 'outcode';

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

    const miles = milesBetween(origin, dest);
    const bands = (r.bands || []).slice().sort((a, b) => a.maxMiles - b.maxMiles);
    const band = bands.find((b) => miles <= b.maxMiles + 1e-9);
    if (!band) {
      const max = r.maxMiles || (bands.length ? bands[bands.length - 1].maxMiles : 0);
      return {
        ok: false,
        reason: `Sorry, ${np.formatted} is outside our delivery area (within ${max} miles). You can still collect.`,
        suggestCollection: true,
      };
    }
    return {
      ok: true,
      postcode: np.formatted,
      feePence: band.feePence,
      distanceMiles: Math.round(miles * 10) / 10,
    };
  }

  // Default: outcode allow-list.
  const v = validateDeliveryPostcode(rawPostcode, d.allowedOutcodes, d.areaDescription);
  if (!v.ok) return v;
  const override = d.feeByOutcode?.[v.outcode];
  const feePence = Number.isFinite(override) ? override : d.feePence;
  return { ok: true, postcode: v.postcode, feePence };
}
