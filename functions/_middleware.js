/* Global middleware: security headers + JSON error envelope.
   Runs on every Pages Function and every static asset request. */

import { getConfig } from './_lib/config.js';

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

// The Meta Pixel (opt-in per shop via config.marketing.metaPixelId) loads
// fbevents.js from connect.facebook.net and beacons events to www.facebook.com.
// Only widen the CSP for those origins when this shop actually runs a pixel —
// shops without one keep the tighter policy. (img-src already allows https:, so
// the <noscript> tracking pixel image works regardless.) Computed once at module
// load; the active config is static per deploy.
const metaPixelOn = /^\d{6,20}$/.test(String(getConfig().marketing?.metaPixelId || '').trim());
const CSP = [
  "default-src 'self'",
  `script-src 'self' https://js.stripe.com https://static.cloudflareinsights.com${metaPixelOn ? ' https://connect.facebook.net' : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://api.stripe.com https://cloudflareinsights.com${metaPixelOn ? ' https://www.facebook.com' : ''}`,
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export const onRequest = async (context) => {
  const res = await context.next();
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', CSP);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};
