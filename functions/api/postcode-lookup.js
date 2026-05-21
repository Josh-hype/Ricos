/* Server-side proxy to getAddress.io's /find endpoint.

   Browser hits same-origin /api/postcode-lookup?postcode=YO24+1AZ, this
   function calls getAddress.io with the master API key and returns the
   list of structured addresses on that postcode. Proxying avoids the
   CORS/DNS-filter issues we hit when calling api.getaddress.io directly
   from the browser.

   Response shape:
     { addresses: [{ line_1, line_2, line_3, line_4, town_or_city, locality }, ...] } */

const ALLOWED_OUTCODES = /^YO\d{1,2}$/;

export const onRequestGet = async ({ request, env }) => {
  const key = (env.GETADDRESS_API_KEY || '').trim();
  if (!key) return errJson('Address lookup not configured.', 503);

  const url = new URL(request.url);
  const raw = (url.searchParams.get('postcode') || '').trim().toUpperCase();
  if (!raw) return errJson('Postcode is required.', 400);

  const cleaned = raw.replace(/\s+/g, '');
  if (!/^YO\d{1,2}\d[A-Z]{2}$/.test(cleaned)) {
    return errJson('Only York (YO) postcodes are supported.', 400);
  }
  const outcode = cleaned.match(/^(YO\d{1,2}?)(?=\d[A-Z]{2}$)/)[1];
  if (!ALLOWED_OUTCODES.test(outcode)) {
    return errJson('Not a valid York postcode.', 400);
  }

  // expand=true gives us structured fields (line_1..line_4, town_or_city,
  // locality) instead of just concatenated strings.
  const apiUrl = `https://api.getaddress.io/find/${encodeURIComponent(cleaned)}` +
    `?api-key=${encodeURIComponent(key)}&expand=true`;

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
    return Response.json({ addresses: [] }, { headers: cacheHeaders() });
  }
  if (!upstream.ok) {
    return errJson(`Lookup ${upstream.status}: ${body.slice(0, 160)}`, 502);
  }

  let data;
  try { data = JSON.parse(body); }
  catch { return errJson('Lookup returned invalid JSON.', 502); }

  const rawAddresses = Array.isArray(data.addresses) ? data.addresses : [];
  const addresses = rawAddresses.map(parseAddress).filter(a => a.line_1 || a.line_2);

  return Response.json({ addresses }, { headers: cacheHeaders() });
};

// /find returns objects when expand=true is honoured, but on the basic
// tier (and historically) it returns an array of comma-separated strings
// in the order: line_1, line_2, line_3, line_4, locality, town_or_city,
// county. Handle both.
function parseAddress(a) {
  if (typeof a === 'string') {
    const parts = a.split(',').map(p => p.trim());
    return {
      line_1: parts[0] || '',
      line_2: parts[1] || '',
      line_3: parts[2] || '',
      line_4: parts[3] || '',
      locality: parts[4] || '',
      town_or_city: parts[5] || '',
    };
  }
  return {
    line_1: a.line_1 || '',
    line_2: a.line_2 || '',
    line_3: a.line_3 || '',
    line_4: a.line_4 || '',
    town_or_city: a.town_or_city || '',
    locality: a.locality || '',
  };
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
