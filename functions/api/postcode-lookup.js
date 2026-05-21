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

  const keyLen = (env.GETADDRESS_API_KEY || '').length;
  // getAddress.io API keys are usually domain-restricted. Send a Referer
  // header pointing at our caller so their allow-list can recognise us.
  const callerOrigin = new URL(request.url).origin;
  // Cleaned postcode (no space) is the format their docs show.
  const path = `/find/${encodeURIComponent(cleaned)}`;
  const apiUrl = `https://api.getaddress.io${path}?expand=true&sort=true`;
  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'api-key': env.GETADDRESS_API_KEY,
        Authorization: `api-key ${env.GETADDRESS_API_KEY}`,
        Referer: `${callerOrigin}/order`,
        Origin: callerOrigin,
        'User-Agent': 'ricos-order/1.0',
      },
    });
  } catch (e) {
    return errJson(`Address lookup network error: ${String(e).slice(0, 100)}`, 502);
  }

  const upstreamBody = await safeText(upstream);

  if (upstream.status === 404) {
    return Response.json({
      ok: true,
      addresses: [],
      _debug: `upstream 404 host=api.getaddress.io path=${path} keyLen=${keyLen} body="${upstreamBody.slice(0, 200)}"`,
    }, { headers: cacheHeaders() });
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return errJson(`Lookup auth ${upstream.status}: ${upstreamBody.slice(0, 160)}`, 503);
  }
  if (upstream.status === 429) {
    return errJson('Daily address lookup limit reached. Please type the address manually.', 429);
  }
  if (!upstream.ok) {
    return errJson(`Lookup ${upstream.status}: ${upstreamBody.slice(0, 160)}`, 502);
  }

  let data;
  try { data = JSON.parse(upstreamBody); }
  catch { return errJson('Address lookup returned an invalid response.', 502); }

  const list = Array.isArray(data.addresses) ? data.addresses : [];

  // Handle BOTH response shapes: expand=true returns objects, otherwise strings.
  const formatted = list.map(raw => {
    if (typeof raw === 'string') {
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
      const city = parts[parts.length - 1] || 'York';
      const street = parts.slice(0, -1).join(', ');
      return {
        line1: street || parts[0] || '',
        line2: '',
        city,
        postcode: cleaned.replace(/(.{3})$/, ' $1'),
        formatted: parts.join(', '),
      };
    }
    const line1 = [raw.line_1, raw.line_2].filter(Boolean).join(', ').trim();
    const line2 = [raw.line_3, raw.line_4].filter(Boolean).join(', ').trim();
    const city  = raw.town_or_city || raw.locality || 'York';
    const pcOut = cleaned.replace(/(.{3})$/, ' $1');
    const display = [line1, line2, city, pcOut].filter(Boolean).join(', ');
    return { line1, line2, city, postcode: pcOut, formatted: display };
  });

  return Response.json({
    ok: true,
    addresses: formatted,
    _debug: formatted.length === 0
      ? `upstream 200 but empty: keys=${Object.keys(data).join(',')}`
      : undefined,
  }, { headers: cacheHeaders() });
};

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

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
