/* GET /api/postcode-lookup?postcode=YO24+1AZ          -> list addresses
   GET /api/postcode-lookup?id=...                      -> resolve one address

   Two-step flow because that's how getAddress.io's modern API works:
   /autocomplete returns suggestions with opaque IDs, then /get/{id}
   returns the structured address fields. */

const ALLOWED_OUTCODES = /^YO\d{1,2}$/;

export const onRequestGet = async ({ request, env }) => {
  if (!env.GETADDRESS_API_KEY) {
    return errJson('Address lookup not configured. Please type the address manually.', 503);
  }
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (id) return resolveById(id, env);

  const raw = (url.searchParams.get('postcode') || '').trim().toUpperCase();
  if (!raw) return errJson('Postcode is required.', 400);
  return listForPostcode(raw, env);
};

async function listForPostcode(raw, env) {
  const cleaned = raw.replace(/\s+/g, '');
  if (!/^YO\d{1,2}\d[A-Z]{2}$/.test(cleaned)) {
    return errJson('Only York (YO) postcodes are supported.', 400);
  }
  const outcode = cleaned.match(/^(YO\d{1,2}?)(?=\d[A-Z]{2}$)/)[1];
  if (!ALLOWED_OUTCODES.test(outcode)) {
    return errJson('Not a valid York postcode.', 400);
  }

  // Trim aggressively — secrets occasionally have a trailing newline if
  // they were typed (vs pasted) into Cloudflare's secret field.
  const key = (env.GETADDRESS_API_KEY || '').trim();
  const keyLen = key.length;
  const keyTail = key.slice(-4);

  // Autocomplete on the postcode; ask for the full list (top=20) so we
  // get every address on that postcode, not just the top few suggestions.
  const apiUrl = `https://api.getAddress.io/autocomplete/${encodeURIComponent(raw)}` +
    `?api-key=${encodeURIComponent(key)}&all=true&top=20`;

  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ricos-order/1.0',
        'api-key': key,
        Authorization: `Bearer ${key}`,
      },
    });
  } catch (e) {
    return errJson(`Address lookup network error: ${String(e).slice(0, 100)}`, 502);
  }
  const body = await safeText(upstream);
  if (upstream.status === 401 || upstream.status === 403) {
    return errJson(`Lookup auth ${upstream.status} [keyLen=${keyLen} tail=...${keyTail}]: ${body.slice(0, 160)}`, 503);
  }
  if (upstream.status === 429) {
    return errJson('Daily address lookup limit reached. Please type the address manually.', 429);
  }
  if (upstream.status === 404) {
    return Response.json({ ok: true, addresses: [] }, { headers: cacheHeaders() });
  }
  if (!upstream.ok) {
    return errJson(`Lookup ${upstream.status}: ${body.slice(0, 160)}`, 502);
  }

  let data;
  try { data = JSON.parse(body); }
  catch { return errJson('Address lookup returned an invalid response.', 502); }

  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  const addresses = suggestions.map(s => ({
    id: s.id || s.url || '',
    formatted: typeof s.address === 'string' ? s.address : '',
  })).filter(a => a.id && a.formatted);

  return Response.json({ ok: true, addresses }, { headers: cacheHeaders() });
}

async function resolveById(id, env) {
  // getAddress.io ids contain a slash but the documented URL is /get/{id}
  // where {id} is the opaque string from the autocomplete response.
  const apiUrl = `https://api.getAddress.io/get/${encodeURIComponent(id)}` +
    `?api-key=${encodeURIComponent(env.GETADDRESS_API_KEY)}`;

  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'ricos-order/1.0' },
    });
  } catch (e) {
    return errJson(`Address resolve network error: ${String(e).slice(0, 100)}`, 502);
  }
  const body = await safeText(upstream);
  if (upstream.status === 401 || upstream.status === 403) {
    return errJson(`Resolve auth ${upstream.status}: ${body.slice(0, 160)}`, 503);
  }
  if (upstream.status === 429) {
    return errJson('Daily address lookup limit reached. Please type the address manually.', 429);
  }
  if (!upstream.ok) {
    return errJson(`Resolve ${upstream.status}: ${body.slice(0, 160)}`, 502);
  }

  let a;
  try { a = JSON.parse(body); }
  catch { return errJson('Address resolve returned an invalid response.', 502); }

  const line1 = [a.line_1, a.line_2].filter(Boolean).join(', ').trim();
  const line2 = [a.line_3, a.line_4].filter(Boolean).join(', ').trim();
  const city  = a.town_or_city || a.locality || 'York';
  const postcode = a.postcode || '';
  return Response.json({
    ok: true,
    address: { line1, line2, city, postcode },
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
  return new Response(JSON.stringify({ ok: false, reason }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
