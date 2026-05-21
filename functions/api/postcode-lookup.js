/* GET /api/postcode-lookup?postcode=YO241AZ
   Proxies the lookup to getAddress.io so the API key stays server-side.
   Returns: { ok: true, addresses: [{ line1, line2, city, postcode, formatted }] }
   or:      { ok: false, reason: string } */

const ALLOWED_OUTCODES = /^YO\d{1,2}$/;

export const onRequestGet = async ({ request, env }) => {
  if (!env.GETADDRESS_API_KEY) {
    return errJson('Address lookup not configured. Please type the address manually.', 503);
  }

  const url = new URL(request.url);
  const raw = (url.searchParams.get('postcode') || '').trim().toUpperCase();
  if (!raw) return errJson('Postcode is required.', 400);

  const cleaned = raw.replace(/\s+/g, '');
  if (!/^YO\d{1,2}\d[A-Z]{2}$/.test(cleaned)) {
    return errJson('Only York (YO) postcodes are supported.', 400);
  }

  const outcode = cleaned.match(/^(YO\d{1,2})/)[1];
  if (!ALLOWED_OUTCODES.test(outcode)) {
    return errJson('Not a valid York postcode.', 400);
  }

  const apiUrl = `https://api.getAddress.io/find/${encodeURIComponent(cleaned)}?api-key=${env.GETADDRESS_API_KEY}&expand=true&sort=true`;
  let upstream;
  try {
    upstream = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  } catch {
    return errJson('Address lookup is temporarily unavailable.', 502);
  }

  if (upstream.status === 404) {
    return Response.json({ ok: true, addresses: [] }, { headers: cacheHeaders() });
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return errJson('Address lookup misconfigured. Please type the address manually.', 503);
  }
  if (upstream.status === 429) {
    return errJson('Too many lookups today. Please type the address manually.', 429);
  }
  if (!upstream.ok) {
    return errJson('Address lookup failed. Please type the address manually.', 502);
  }

  let data;
  try { data = await upstream.json(); }
  catch { return errJson('Address lookup returned an invalid response.', 502); }

  const list = Array.isArray(data.addresses) ? data.addresses : [];
  const formatted = list.map(a => {
    const line1 = [a.line_1, a.line_2].filter(Boolean).join(', ').trim();
    const line2 = [a.line_3, a.line_4].filter(Boolean).join(', ').trim();
    const city  = a.town_or_city || 'York';
    const display = [line1, line2, city, raw].filter(Boolean).join(', ');
    return { line1, line2, city, postcode: raw, formatted: display };
  });

  return Response.json({ ok: true, addresses: formatted }, { headers: cacheHeaders() });
};

function cacheHeaders() {
  return {
    'Cache-Control': 'private, max-age=300',
    'Content-Type': 'application/json',
  };
}

function errJson(reason, status) {
  return new Response(JSON.stringify({ ok: false, reason }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
