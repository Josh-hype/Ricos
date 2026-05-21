/* Server-side proxy to getAddress.io.

   The browser used to call api.getaddress.io directly with a domain-restricted
   token, but consumer DNS filters and corporate firewalls silently block
   that host for some visitors. Proxying through this Pages Function makes
   the address lookup same-origin from the browser's point of view, so it
   works for anyone who can reach the rest of the site.

     GET /api/postcode-lookup?postcode=YO24+1AZ   -> list addresses on that postcode
     GET /api/postcode-lookup?id=<opaque-id>      -> resolve one suggestion to fields

   Response shape mirrors getAddress.io so the browser code can stay simple:
     list:    { suggestions: [{ id, address }, ...] }
     resolve: { line_1, line_2, line_3, line_4, town_or_city, locality, postcode } */

const ALLOWED_OUTCODES = /^YO\d{1,2}$/;

export const onRequestGet = async ({ request, env }) => {
  const key = (env.GETADDRESS_API_KEY || '').trim();
  if (!key) {
    return errJson('Address lookup not configured.', 503);
  }
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (id) return resolveById(id, key);

  const raw = (url.searchParams.get('postcode') || '').trim().toUpperCase();
  if (!raw) return errJson('Postcode is required.', 400);
  return listForPostcode(raw, key);
};

async function listForPostcode(raw, key) {
  const cleaned = raw.replace(/\s+/g, '');
  if (!/^YO\d{1,2}\d[A-Z]{2}$/.test(cleaned)) {
    return errJson('Only York (YO) postcodes are supported.', 400);
  }
  const outcode = cleaned.match(/^(YO\d{1,2}?)(?=\d[A-Z]{2}$)/)[1];
  if (!ALLOWED_OUTCODES.test(outcode)) {
    return errJson('Not a valid York postcode.', 400);
  }

  const apiUrl = `https://api.getaddress.io/autocomplete/${encodeURIComponent(raw)}` +
    `?api-key=${encodeURIComponent(key)}&all=true&top=20`;

  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'ricos-order/1.0' },
    });
  } catch (e) {
    return errJson(`Lookup network error: ${String(e).slice(0, 100)}`, 502);
  }

  const body = await safeText(upstream);
  if (upstream.status === 401 || upstream.status === 403) {
    return errJson(`Lookup auth ${upstream.status} [keyLen=${key.length} tail=...${key.slice(-4)}]: ${body.slice(0, 160)}`, 503);
  }
  if (upstream.status === 429) {
    return errJson('Daily address lookup limit reached.', 429);
  }
  if (upstream.status === 404) {
    return Response.json({ suggestions: [] }, { headers: cacheHeaders() });
  }
  if (!upstream.ok) {
    return errJson(`Lookup ${upstream.status}: ${body.slice(0, 160)}`, 502);
  }

  let data;
  try { data = JSON.parse(body); }
  catch { return errJson('Lookup returned invalid JSON.', 502); }

  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .map(s => ({ id: s.id || '', address: typeof s.address === 'string' ? s.address : '' }))
    .filter(s => s.id && s.address);

  return Response.json({ suggestions }, { headers: cacheHeaders() });
}

async function resolveById(id, key) {
  const apiUrl = `https://api.getaddress.io/get/${encodeURIComponent(id)}` +
    `?api-key=${encodeURIComponent(key)}`;

  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'ricos-order/1.0' },
    });
  } catch (e) {
    return errJson(`Resolve network error: ${String(e).slice(0, 100)}`, 502);
  }

  const body = await safeText(upstream);
  if (upstream.status === 401 || upstream.status === 403) {
    return errJson(`Resolve auth ${upstream.status}: ${body.slice(0, 160)}`, 503);
  }
  if (upstream.status === 429) {
    return errJson('Daily address lookup limit reached.', 429);
  }
  if (!upstream.ok) {
    return errJson(`Resolve ${upstream.status}: ${body.slice(0, 160)}`, 502);
  }

  let a;
  try { a = JSON.parse(body); }
  catch { return errJson('Resolve returned invalid JSON.', 502); }

  return Response.json({
    line_1: a.line_1 || '',
    line_2: a.line_2 || '',
    line_3: a.line_3 || '',
    line_4: a.line_4 || '',
    town_or_city: a.town_or_city || '',
    locality: a.locality || '',
    postcode: a.postcode || '',
  }, { headers: cacheHeaders() });
}

function cacheHeaders() {
  return {
    'Cache-Control': 'private, max-age=300',
    'Content-Type': 'application/json',
  };
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

function errJson(reason, status) {
  return new Response(JSON.stringify({ reason }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
