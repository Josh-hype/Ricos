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

  const apiUrl = `https://api.getAddress.io/find/${encodeURIComponent(cleaned)}?api-key=${encodeURIComponent(env.GETADDRESS_API_KEY)}&expand=true&sort=true`;
  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'api-key': env.GETADDRESS_API_KEY,
      },
    });
  } catch {
    return errJson('Address lookup is temporarily unavailable.', 502);
  }

  if (upstream.status === 404) {
    return Response.json({ ok: true, addresses: [], _debug: 'upstream 404' }, { headers: cacheHeaders() });
  }
  if (upstream.status === 401 || upstream.status === 403) {
    const body = await safeText(upstream);
    return errJson(`Address lookup misconfigured (${upstream.status}). ${body.slice(0, 140)}`, 503);
  }
  if (upstream.status === 429) {
    return errJson('Daily address lookup limit reached. Please type the address manually.', 429);
  }
  if (!upstream.ok) {
    const body = await safeText(upstream);
    return errJson(`Address lookup failed (${upstream.status}). ${body.slice(0, 140)}`, 502);
  }

  let data;
  try { data = await upstream.json(); }
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
