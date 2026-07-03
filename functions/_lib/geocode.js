/* Free postcode geocoding via postcodes.io (no API key) + straight-line
   (haversine) distance. Used by radius-based delivery pricing.

   Results are cached per-isolate so the shop origin and repeat postcodes
   aren't re-fetched. postcodes.io is called from the Cloudflare Functions
   runtime (which can reach external APIs); only successful lookups are
   cached so a transient failure can be retried. */

const cache = new Map();

export async function geocodePostcode(raw) {
  const pc = String(raw || '').toUpperCase().replace(/\s+/g, '');
  if (!pc) return null;
  if (cache.has(pc)) return cache.get(pc);
  let coords = null;
  try {
    // Bound the third-party lookup — it sits on the live checkout path (radius
    // delivery), so a hung postcodes.io must not stall the customer's order. On
    // timeout/abort we fall through to null and the caller shows a soft message.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    let res;
    try {
      res = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc), {
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const j = await res.json();
      if (j && j.status === 200 && j.result && typeof j.result.latitude === 'number') {
        coords = { lat: j.result.latitude, lng: j.result.longitude };
      }
    }
  } catch {
    /* network error -> null (caller shows a graceful message) */
  }
  if (coords) cache.set(pc, coords);
  return coords;
}

// Great-circle distance in miles between two {lat,lng} points.
export function milesBetween(a, b) {
  const R = 3958.7613; // earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
