/* POST /api/staff/terminal/branding — show the shop's logo on the card reader's idle
   screen (instead of Stripe's). Reads this shop's /logo.png, uploads it to Stripe as a
   terminal splash image on the connected account, and points a Terminal Configuration's
   splash screen at it, set as the account default so the shop's readers adopt it. The
   reader applies it on its next reboot / idle refresh.

   The logo is read via the Pages ASSETS binding (serves the static file directly) — a
   Function fetching its own public URL can stall and 502. Every external call is also
   given a timeout so a stall surfaces as a readable error, never a bare 502. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { uploadTerminalSplash, createTerminalConfiguration } from '../../../_lib/stripe.js';

const VERSION = 'v3-assets'; // bump on each change — GET this endpoint to see what's deployed

// GET /api/staff/terminal/branding → which version is live (no auth, no work, can't hang).
export const onRequestGet = async () =>
  new Response(JSON.stringify({ ok: true, version: VERSION }), { headers: { 'Content-Type': 'application/json' } });

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'request') + ' timed out')), ms)),
  ]);
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const denied = await requirePermission(request, env, 'sell');
    if (denied) return denied;

    const config = getConfig();
    const acct = config.stripe?.connectedAccountId;
    if (!acct || acct === 'TBD') return err('Card payments are not configured for this shop.', 400);

    // Read the shop's logo via the static-asset binding (no self-origin round-trip).
    let blob, ctype;
    try {
      const logoUrl = new URL('/logo.png', request.url).toString();
      const r = (env.ASSETS && env.ASSETS.fetch)
        ? await withTimeout(env.ASSETS.fetch(new Request(logoUrl)), 12000, 'logo read')
        : await withTimeout(fetch(logoUrl), 12000, 'logo fetch');
      if (!r.ok) throw new Error('status ' + r.status);
      ctype = r.headers.get('content-type') || 'image/png';
      blob = new Blob([await r.arrayBuffer()], { type: ctype });
    } catch (e) {
      return err('Could not load the shop logo (/logo.png): ' + (e.message || 'failed'), 502);
    }

    let file;
    try {
      file = await withTimeout(uploadTerminalSplash(blob, 'reader-splash.png', acct, env), 20000, 'Stripe upload');
    } catch (e) {
      return err('Stripe rejected the logo image: ' + (e.message || 'upload failed'), 400);
    }

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
