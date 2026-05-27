/* Global middleware: security headers + JSON error envelope.
   Runs on every Pages Function and every static asset request. */

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // payment=* so Apple Pay / Google Pay work. They render inside Stripe's
  // cross-origin iframes (and Google Pay nests further iframes), so a
  // scoped allowlist is fragile. The wildcard is safe here because our CSP
  // frame-src only permits js.stripe.com / hooks.stripe.com — no other
  // origin can load a payment iframe in the first place.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=*',
  'X-Frame-Options': 'DENY',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://api.stripe.com https://cloudflareinsights.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export const onRequest = async (context) => {
  // TEMP DEBUG (go-live): catch any downstream handler crash / missing response
  // and surface it as JSON instead of a bare 502. Revert once payments work.
  let res;
  try {
    res = await context.next();
  } catch (e) {
    console.error('middleware caught downstream error', e);
    return new Response(JSON.stringify({ error: 'MW DEBUG: ' + (e && e.message ? e.message : String(e)) }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!res) {
    return new Response(JSON.stringify({ error: 'MW DEBUG: downstream returned no Response' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', CSP);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};
