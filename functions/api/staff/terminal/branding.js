/* POST /api/staff/terminal/branding — show the shop's logo on the card reader's idle
   screen (instead of Stripe's).

   The logo bytes come from the CLIENT (the browser reads its own /logo.png and posts it
   as base64) so the Function never fetches anything itself — a Pages Function reading its
   own site can stall and 502. If the client couldn't send one (e.g. the native app), we
   fall back to the Pages ASSETS binding, fully wrapped in a timeout. Either way we upload
   the image to Stripe and point an account-default Terminal Configuration's splash at it.

   GET this endpoint (no auth) to see which version is deployed. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { uploadTerminalSplash, createTerminalConfiguration } from '../../../_lib/stripe.js';

const VERSION = 'v4-clientlogo';

export const onRequestGet = async () =>
  new Response(JSON.stringify({ ok: true, version: VERSION }), { headers: { 'Content-Type': 'application/json' } });

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'request') + ' timed out')), ms)),
  ]);
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'image/png' });
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const denied = await requirePermission(request, env, 'sell');
    if (denied) return denied;

    let body = {};
    try { body = await request.json(); } catch { /* tolerate empty body */ }

    const config = getConfig();
    const acct = config.stripe?.connectedAccountId;
    if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

    // Logo bytes: prefer the client-sent image; otherwise read it server-side (timed out).
    let blob;
    if (body.logo) {
      try { blob = b64ToBlob(String(body.logo), body.contentType); }
      catch (e) { return err('Bad logo data: ' + (e.message || 'decode failed'), 400); }
    } else {
      try {
        const logoUrl = new URL('/logo.png', request.url).toString();
        const read = async () => {
          const r = (env.ASSETS && env.ASSETS.fetch) ? await env.ASSETS.fetch(new Request(logoUrl)) : await fetch(logoUrl);
          if (!r.ok) throw new Error('status ' + r.status);
          return { buf: await r.arrayBuffer(), type: r.headers.get('content-type') || 'image/png' };
        };
        const got = await withTimeout(read(), 12000, 'logo read');
        blob = new Blob([got.buf], { type: got.type });
      } catch (e) {
        return err('Could not load the shop logo: ' + (e.message || 'failed'), 502);
      }
    }

    let file;
    try { file = await withTimeout(uploadTerminalSplash(blob, 'reader-splash.png', acct, env), 20000, 'Stripe upload'); }
    catch (e) { return err('Stripe rejected the logo image: ' + (e.message || 'upload failed'), 400); }

    let configuration;
    try {
      configuration = await withTimeout(
        createTerminalConfiguration({ splashscreenFileId: file.id, isAccountDefault: true }, acct, env),
        15000, 'Stripe config',
      );
    } catch (e) {
      return err('Could not apply the reader branding: ' + (e.message || 'Stripe error'), 502);
    }

    return Response.json({ ok: true, version: VERSION, fileId: file.id, configurationId: configuration.id });
  } catch (e) {
    return err('Branding failed: ' + (e && e.message ? e.message : 'unknown error'), 500);
  }
};

function err(error, status) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
