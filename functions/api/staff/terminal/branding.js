/* POST /api/staff/terminal/branding — put the shop's logo on the card reader's idle
   screen. The browser reads its own /logo.png and posts the bytes (base64) so the
   Function never self-fetches; falls back to the Pages ASSETS binding for the native app.

   GET ?step=logo|upload|full&key=rdiag — DIAGNOSTIC probe (temporary). Runs the named
   step server-side and returns JSON, so the exact failing step is identifiable by
   opening a URL. ?step=full also sets the branding if every step works. Remove once the
   POST flow is confirmed. GET with no step returns the deployed version. */

import { requirePermission } from '../../../_lib/permissions.js';
import { getConfig } from '../../../_lib/config.js';
import { uploadTerminalSplash, createTerminalConfiguration } from '../../../_lib/stripe.js';

const VERSION = 'v5-probe';
const PROBE_KEY = 'rdiag';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error((label || 'request') + ' timed out')), ms)),
  ]);
}
function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'image/png' });
}
async function readLogoServerSide(request, env) {
  const logoUrl = new URL('/logo.png', request.url).toString();
  const r = (env.ASSETS && env.ASSETS.fetch) ? await env.ASSETS.fetch(new Request(logoUrl)) : await fetch(logoUrl);
  if (!r.ok) throw new Error('logo status ' + r.status);
  return { buf: await r.arrayBuffer(), type: r.headers.get('content-type') || 'image/png' };
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const step = url.searchParams.get('step');
  if (!step) return json({ ok: true, version: VERSION });
  if (url.searchParams.get('key') !== PROBE_KEY) return json({ ok: false, error: 'add &key=' + PROBE_KEY }, 403);
  try {
    const acct = getConfig().stripe?.connectedAccountId;
    if (!acct || acct === 'TBD') return json({ ok: false, step, error: 'no connected account configured' });

    const got = await withTimeout(readLogoServerSide(request, env), 12000, 'logo read');
    const blob = new Blob([got.buf], { type: got.type });
    if (step === 'logo') {
      return json({ ok: true, step: 'logo', size: got.buf.byteLength, type: got.type, hasAssets: !!(env.ASSETS && env.ASSETS.fetch) });
    }

    const file = await withTimeout(uploadTerminalSplash(blob, 'reader-splash.png', acct, env), 20000, 'Stripe upload');
    if (step === 'upload') return json({ ok: true, step: 'upload', fileId: file.id });

    const cfg = await withTimeout(
      createTerminalConfiguration({ splashscreenFileId: file.id, isAccountDefault: true }, acct, env), 15000, 'Stripe config');
    return json({ ok: true, step: 'full', fileId: file.id, configurationId: cfg.id, note: 'branding set ✓' });
  } catch (e) {
    return json({ ok: false, step, error: e && e.message ? e.message : 'unknown' });
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const denied = await requirePermission(request, env, 'sell');
    if (denied) return denied;

    let body = {};
    try { body = await request.json(); } catch { /* tolerate empty body */ }

    const acct = getConfig().stripe?.connectedAccountId;
    if (!acct || acct === 'TBD') return json({ error: 'Card payments are not configured for this shop.' }, 400);

    let blob;
    if (body.logo) {
      try { blob = b64ToBlob(String(body.logo), body.contentType); }
      catch (e) { return json({ error: 'Bad logo data: ' + (e.message || 'decode failed') }, 400); }
    } else {
      try {
        const got = await withTimeout(readLogoServerSide(request, env), 12000, 'logo read');
        blob = new Blob([got.buf], { type: got.type });
      } catch (e) {
        return json({ error: 'Could not load the shop logo: ' + (e.message || 'failed') }, 502);
      }
    }

    let file;
    try { file = await withTimeout(uploadTerminalSplash(blob, 'reader-splash.png', acct, env), 20000, 'Stripe upload'); }
    catch (e) { return json({ error: 'Stripe rejected the logo image: ' + (e.message || 'upload failed') }, 400); }

    let configuration;
    try {
      configuration = await withTimeout(
        createTerminalConfiguration({ splashscreenFileId: file.id, isAccountDefault: true }, acct, env), 15000, 'Stripe config');
    } catch (e) {
      return json({ error: 'Could not apply the reader branding: ' + (e.message || 'Stripe error') }, 502);
    }

    return json({ ok: true, version: VERSION, fileId: file.id, configurationId: configuration.id });
  } catch (e) {
    return json({ error: 'Branding failed: ' + (e && e.message ? e.message : 'unknown error') }, 500);
  }
};
