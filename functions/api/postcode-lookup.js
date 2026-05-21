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

  const key = env.GETADDRESS_API_KEY;
  const keyLen = key.length;

  // Try a sequence of getAddress.io endpoint variations. The first one
  // that returns a 2xx wins. If they all 404, we report which was hit.
  const attempts = [
    // Modern v2 path with api-key in query
    `https://api.getaddress.io/find/${encodeURIComponent(cleaned)}?api-key=${encodeURIComponent(key)}&expand=true`,
    // Modern v2 path with space-formatted postcode
    `https://api.getaddress.io/find/${encodeURIComponent(raw)}?api-key=${encodeURIComponent(key)}&expand=true`,
    // Older v2 UK endpoint
    `https://api.getaddress.io/v2/uk/${encodeURIComponent(cleaned)}?api-key=${encodeURIComponent(key)}&expand=true`,
    // Capital-A host (DNS is case-insensitive but try anyway in case of cert mismatch)
    `https://api.getAddress.io/find/${encodeURIComponent(cleaned)}?api-key=${encodeURIComponent(key)}&expand=true`,
  ];

  const tried = [];
  let upstream = null;
  let upstreamBody = '';
  let winningUrl = '';
  for (const url of attempts) {
    let resp;
    try {
      resp = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ricos-order/1.0',
        },
      });
    } catch (e) {
      tried.push(`ERR ${url.replace(key, 'KEY')}`);
      continue;
    }
    const body = await safeText(resp);
    tried.push(`${resp.status} ${url.replace(key, 'KEY')}`);
    if (resp.ok) {
      upstream = resp;
      upstreamBody = body;
      winningUrl = url;
      break;
    }
    // If we get a "real" error like 401/429, stop trying — the key itself is bad.
    if (resp.status === 401 || resp.status === 403) {
      return errJson(`Lookup auth ${resp.status}: ${body.slice(0, 160)}`, 503);
    }
    if (resp.status === 429) {
      return errJson('Daily address lookup limit reached. Please type the address manually.', 429);
    }
  }

  if (!upstream) {
    return Response.json({
      ok: true,
      addresses: [],
      _debug: `all variants failed keyLen=${keyLen} tried=[${tried.join(' | ')}]`,
    }, { headers: cacheHeaders() });
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
