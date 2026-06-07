/* GET /api/address-lookup?postcode=... — UK address finder for the order page
   AND the staff till. Proxies Ideal Postcodes (Royal Mail PAF + Ordnance Survey
   licensed data) so a customer or operator can pick their address from a list
   instead of typing it.

   The API key is read from the environment and stays SERVER-SIDE — it's never
   shipped to the browser. When no key is configured the endpoint returns
   { enabled:false } and both surfaces silently fall back to manual entry, so the
   feature ships to every shop but only lights up where a key is set. Any provider
   error (bad key, no balance, rate-limit, network) fails soft to manual entry —
   the lookup is a convenience, never a blocker on placing an order.

   COST: every successful (non-empty) result is cached per postcode in KV, so a
   given postcode is billed AT MOST ONCE. A shop delivers to a bounded set of
   postcodes, so after each has been seen once, ongoing lookup cost ≈ £0 — repeat
   orders to a known postcode are served free from cache. */

import { normalisePostcode } from '../_lib/postcode.js';

// Addresses are stable, and a shop's delivery area is a fixed set of postcodes,
// so a long TTL maximises cache hits (and minimises paid lookups).
const CACHE_TTL = 60 * 60 * 24 * 60; // 60 days

export const onRequestGet = async ({ request, env }) => {
  const headers = { 'Cache-Control': 'no-store' };
  const key = env.IDEALPOSTCODES_API_KEY || env.ADDRESS_LOOKUP_API_KEY || null;
  if (!key) {
    // Not configured for this shop — the UI hides the finder and uses manual entry.
    return Response.json({ ok: false, enabled: false, addresses: [] }, { headers });
  }

  const url = new URL(request.url);
  const p = normalisePostcode(url.searchParams.get('postcode') || '');
  if (!p) {
    return Response.json({ ok: false, enabled: true, addresses: [], reason: 'Enter a full UK postcode.' }, { headers });
  }

  // Per-postcode cache so a paid lookup is never repeated. Reuse an existing KV
  // binding (a dedicated ADDRESS_KV if added, else CUSTOMERS_KV); skip silently
  // if neither is bound (the feature still works, just without the saving).
  const cache = env.ADDRESS_KV || env.CUSTOMERS_KV || null;
  const cacheKey = `addr:${p.formatted}`;
  if (cache) {
    const hit = await cache.get(cacheKey, 'json').catch(() => null);
    if (hit && Array.isArray(hit.addresses) && hit.addresses.length) {
      return Response.json({ ok: true, enabled: true, cached: true, postcode: p.formatted, addresses: hit.addresses }, { headers });
    }
  }

  try {
    const api = `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(p.formatted)}?api_key=${encodeURIComponent(key)}`;
    const res = await fetch(api, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));

    // 404 / code 4040 = a valid postcode that simply has no addresses on file →
    // an empty list, not an error (the UI shows "type it in" rather than failing).
    if (res.status === 404 || body.code === 4040) {
      return Response.json({ ok: true, enabled: true, postcode: p.formatted, addresses: [] }, { headers });
    }
    if (!res.ok || !Array.isArray(body.result)) {
      // 401 bad key, 402 no balance, 429 rate-limited, 5xx, etc. — fail soft.
      return Response.json({ ok: false, enabled: true, addresses: [], reason: 'Address lookup is unavailable right now.' }, { headers });
    }

    const addresses = body.result.map((a) => ({
      line1: a.line_1 || '',
      line2: [a.line_2, a.line_3].filter(Boolean).join(', '),
      city: a.post_town || '',
      postcode: a.postcode || p.formatted,
      // Human-readable label for the picker. line_1 alone covers most addresses.
      label: [a.line_1, a.line_2, a.line_3].filter(Boolean).join(', ') || (a.line_1 || ''),
    })).filter((a) => a.line1 || a.label);

    // Cache only a real (non-empty) result, so we never re-bill a postcode we've
    // already resolved. Empty / error results aren't cached (so they can retry).
    if (cache && addresses.length) {
      await cache.put(cacheKey, JSON.stringify({ addresses }), { expirationTtl: CACHE_TTL }).catch(() => {});
    }

    return Response.json({ ok: true, enabled: true, postcode: p.formatted, addresses }, { headers });
  } catch (e) {
    return Response.json({ ok: false, enabled: true, addresses: [], reason: 'Address lookup failed.' }, { headers });
  }
};
